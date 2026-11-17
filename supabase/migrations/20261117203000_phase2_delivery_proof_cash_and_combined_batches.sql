-- Complete Phase 2 delivery controls: proof, OTP-gated completion, COD review and same-customer batch assignment.

alter table public.driver_assignments
  add column if not exists delivery_batch_id uuid references public.delivery_batches(id) on delete set null;

create index if not exists driver_assignments_delivery_batch_idx
  on public.driver_assignments(delivery_batch_id) where delivery_batch_id is not null;

create or replace function public.driver_set_delivery_proof_path(p_assignment_id uuid,p_storage_path text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_status text; v_uid text;
begin
  v_uid := auth.uid()::text;
  if not coalesce((select a.enabled from public.customer_driver_access a where a.user_id=auth.uid()),false)
     or not exists(select 1 from public.driver_applications d where d.user_id=auth.uid() and d.status='approved') then
    raise exception 'Approved active driver access required' using errcode='42501';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || v_uid || '/delivery_proofs/[A-Za-z0-9_.-]+$') then
    raise exception 'Delivery proof must be uploaded to your own private driver folder' using errcode='22023';
  end if;
  select a.order_id,a.status into v_order_id,v_status from public.driver_assignments a
   where a.id=p_assignment_id and a.driver_user_id=auth.uid() for update;
  if v_order_id is null then raise exception 'Assigned delivery not found' using errcode='42501'; end if;
  if v_status <> 'picked_up' then raise exception 'Proof can only be added after parcel pickup' using errcode='22023'; end if;
  update public.driver_assignments set delivery_proof_path=p_storage_path where id=p_assignment_id;
  insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
    values(p_assignment_id,v_order_id,auth.uid(),'proof_uploaded');
end;
$$;

create or replace function public.driver_update_delivery_status(p_assignment_id uuid,p_action text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_status text; v_order_status public.order_status; v_otp_verified timestamptz; v_proof text;
begin
  if not coalesce((select a.enabled from public.customer_driver_access a where a.user_id=auth.uid()),false)
     or not exists(select 1 from public.driver_applications d where d.user_id=auth.uid() and d.status='approved') then
    raise exception 'Approved active driver access required' using errcode='42501';
  end if;
  if p_action not in ('picked_up','delivered') then raise exception 'Invalid delivery action' using errcode='22023'; end if;
  select a.order_id,a.status,o.order_status,a.delivery_otp_verified_at,a.delivery_proof_path
    into v_order_id,v_status,v_order_status,v_otp_verified,v_proof
  from public.driver_assignments a join public.orders o on o.id=a.order_id
  where a.id=p_assignment_id and a.driver_user_id=auth.uid() for update of a;
  if v_order_id is null then raise exception 'Assigned delivery not found' using errcode='42501'; end if;
  if v_order_status='cancelled'::public.order_status then raise exception 'Cancelled orders cannot be delivered' using errcode='22023'; end if;
  if v_status in ('delivered','cancelled','failed') then raise exception 'Delivery is already closed' using errcode='22023'; end if;
  if p_action='picked_up' then
    if v_status <> 'assigned' then raise exception 'Only assigned deliveries can be picked up' using errcode='22023'; end if;
    update public.driver_assignments set status='picked_up',picked_up_at=coalesce(picked_up_at,now()) where id=p_assignment_id;
    insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
      values(p_assignment_id,v_order_id,auth.uid(),'picked_up');
  else
    if v_status <> 'picked_up' then raise exception 'Parcel must be picked up before delivery' using errcode='22023'; end if;
    if v_otp_verified is null then raise exception 'Customer delivery OTP must be verified first' using errcode='22023'; end if;
    if nullif(v_proof,'') is null then raise exception 'Delivery photo proof is required before completion' using errcode='22023'; end if;
    update public.driver_assignments set status='delivered',delivered_at=now() where id=p_assignment_id;
    update public.orders set order_status='delivered'::public.order_status,delivered_at=now(),updated_at=now() where id=v_order_id;
    insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
      values(p_assignment_id,v_order_id,auth.uid(),'delivered');
  end if;
end;
$$;

create or replace function public.driver_verify_delivery_otp(p_assignment_id uuid,p_code text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_hash text; v_expiry timestamptz; v_status text; v_attempts integer;
begin
  if not coalesce((select a.enabled from public.customer_driver_access a where a.user_id=auth.uid()),false)
     or not exists(select 1 from public.driver_applications d where d.user_id=auth.uid() and d.status='approved') then
    raise exception 'Approved active driver access required' using errcode='42501';
  end if;
  select a.order_id,a.delivery_otp_hash,a.delivery_otp_expires_at,a.status,a.delivery_otp_attempts
    into v_order_id,v_hash,v_expiry,v_status,v_attempts
  from public.driver_assignments a where a.id=p_assignment_id and a.driver_user_id=auth.uid() for update;
  if v_order_id is null then raise exception 'Assigned delivery not found' using errcode='42501'; end if;
  if v_status <> 'picked_up' then raise exception 'Parcel must be picked up before OTP verification' using errcode='22023'; end if;
  if v_attempts >= 5 then raise exception 'OTP attempts limit reached. Ask customer to generate a new code.' using errcode='22023'; end if;
  if p_code !~ '^[0-9]{6}$' or v_hash is null or v_expiry is null or v_expiry < now()
     or v_hash <> encode(extensions.digest(p_code,'sha256'),'hex') then
    update public.driver_assignments set delivery_otp_attempts=least(delivery_otp_attempts+1,5) where id=p_assignment_id;
    return false;
  end if;
  update public.driver_assignments set delivery_otp_verified_at=now() where id=p_assignment_id;
  insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
    values(p_assignment_id,v_order_id,auth.uid(),'otp_verified');
  return true;
end;
$$;

create or replace function public.driver_record_cod_collection(p_assignment_id uuid,p_amount numeric)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_status text; v_method public.payment_method; v_total numeric; v_verified timestamptz; v_proof text;
begin
  if not coalesce((select a.enabled from public.customer_driver_access a where a.user_id=auth.uid()),false)
     or not exists(select 1 from public.driver_applications d where d.user_id=auth.uid() and d.status='approved') then
    raise exception 'Approved active driver access required' using errcode='42501';
  end if;
  select a.order_id,a.status,o.payment_method,o.total,a.delivery_otp_verified_at,a.delivery_proof_path
    into v_order_id,v_status,v_method,v_total,v_verified,v_proof
  from public.driver_assignments a join public.orders o on o.id=a.order_id
  where a.id=p_assignment_id and a.driver_user_id=auth.uid() for update of a;
  if v_order_id is null then raise exception 'Assigned delivery not found' using errcode='42501'; end if;
  if v_method <> 'cod' then raise exception 'Cash collection is only available for COD orders' using errcode='22023'; end if;
  if v_status <> 'delivered' or v_verified is null or nullif(v_proof,'') is null then
    raise exception 'Verified delivery and photo proof are required before COD collection' using errcode='22023';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > v_total then raise exception 'Collected amount must be between zero and the order total' using errcode='22023'; end if;
  update public.driver_assignments set cod_collected_amount=p_amount,cod_collected_at=now() where id=p_assignment_id;
  insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
    values(p_assignment_id,v_order_id,auth.uid(),'cod_collected');
end;
$$;

create or replace function public.admin_reconcile_driver_cash(p_assignment_id uuid,p_amount numeric,p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_collected numeric; v_status text; v_driver uuid;
begin
  if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
  select a.order_id,a.cod_collected_amount,a.status,a.driver_user_id into v_order_id,v_collected,v_status,v_driver
    from public.driver_assignments a where a.id=p_assignment_id for update;
  if v_order_id is null then raise exception 'Driver assignment not found' using errcode='P0002'; end if;
  if v_status <> 'delivered' or v_collected is null then raise exception 'Driver COD collection must be recorded before reconciliation' using errcode='22023'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Reconciled amount cannot be negative' using errcode='22023'; end if;
  if p_amount <> v_collected and nullif(btrim(coalesce(p_note,'')),'') is null then
    raise exception 'Add a note when the cash amount does not match the driver collection' using errcode='22023';
  end if;
  if p_note is not null and char_length(p_note)>1000 then raise exception 'Reconciliation note is too long' using errcode='22023'; end if;
  update public.driver_assignments set cash_reconciled_amount=p_amount,cash_reconciled_at=now(),
    cash_reconciled_by=auth.uid(),cash_reconciliation_note=nullif(btrim(p_note),'') where id=p_assignment_id;
  insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
    values(p_assignment_id,v_order_id,v_driver,'cash_reconciled');
end;
$$;

create or replace function public.admin_list_driver_cash_reconciliation()
returns table(assignment_id uuid,order_id uuid,order_number text,customer_name text,driver_user_id uuid,driver_name text,
  payment_method text,order_total numeric,collected_amount numeric,reconciled_amount numeric,reconciled_at timestamptz,
  reconciliation_note text,delivered_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query
 select a.id,o.id,o.order_number::text,o.customer_name::text,a.driver_user_id,coalesce(d.full_name::text,'Driver'),
   o.payment_method::text,o.total,a.cod_collected_amount,a.cash_reconciled_amount,a.cash_reconciled_at,
   a.cash_reconciliation_note,a.delivered_at
 from public.driver_assignments a join public.orders o on o.id=a.order_id
 left join public.driver_applications d on d.user_id=a.driver_user_id
 where a.status='delivered' and o.payment_method='cod'::public.payment_method
   and a.cod_collected_amount is not null
 order by (a.cash_reconciled_at is null) desc,a.delivered_at desc limit 500;
end;
$$;

create or replace function public.admin_list_assignable_delivery_batches()
returns table(batch_id uuid,batch_number text,customer_id uuid,customer_name text,customer_phone text,order_count bigint,delivery_fee numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query
 select b.id,b.batch_number,b.customer_id,coalesce(min(o.customer_name),'Customer')::text,
   coalesce(b.customer_phone,''),count(*)::bigint,b.delivery_fee
 from public.delivery_batches b join public.delivery_batch_orders bo on bo.batch_id=b.id
 join public.orders o on o.id=bo.order_id
 where b.customer_id is not null
 group by b.id,b.batch_number,b.customer_id,b.customer_phone,b.delivery_fee
 having bool_and(o.order_status='confirmed'::public.order_status)
   and count(distinct o.shipping_address_snapshot)=1
   and bool_and(not exists(select 1 from public.driver_assignments a where a.order_id=o.id and a.status in ('assigned','picked_up')))
 order by max(b.created_at) desc limit 200;
end;
$$;

create or replace function public.admin_assign_driver_to_delivery_batch(p_batch_id uuid,p_driver_user_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer:=0; v_order record; v_customer uuid;
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 if not exists(select 1 from public.customer_driver_access a join public.driver_applications d on d.user_id=a.user_id
   where a.user_id=p_driver_user_id and a.enabled=true and d.status='approved') then
   raise exception 'Driver is not approved or driver access is disabled' using errcode='42501';
 end if;
 select customer_id into v_customer from public.delivery_batches where id=p_batch_id;
 if v_customer is null then raise exception 'Delivery batch not found or has no customer' using errcode='P0002'; end if;
 if not exists(select 1 from public.delivery_batch_orders bo where bo.batch_id=p_batch_id) then
   raise exception 'This delivery batch has no orders' using errcode='22023';
 end if;
 if exists(select 1 from public.delivery_batch_orders bo join public.orders o on o.id=bo.order_id
   where bo.batch_id=p_batch_id and (o.customer_id is distinct from v_customer or o.order_status <> 'confirmed'::public.order_status)) then
   raise exception 'All batch orders must belong to the same customer and be confirmed' using errcode='22023';
 end if;
 if (select count(distinct o.shipping_address_snapshot) from public.delivery_batch_orders bo join public.orders o on o.id=bo.order_id where bo.batch_id=p_batch_id) <> 1 then
   raise exception 'Orders in one driver batch must have the same delivery address' using errcode='22023';
 end if;
 if exists(select 1 from public.delivery_batch_orders bo join public.driver_assignments a on a.order_id=bo.order_id
   where bo.batch_id=p_batch_id and a.status in ('assigned','picked_up')) then
   raise exception 'One or more orders already have an active driver assignment' using errcode='23505';
 end if;
 for v_order in select o.id from public.delivery_batch_orders bo join public.orders o on o.id=bo.order_id where bo.batch_id=p_batch_id loop
   insert into public.driver_assignments(order_id,driver_user_id,assigned_by,delivery_batch_id,status,assigned_at,picked_up_at,delivered_at,
      failed_reason,failed_note,delivery_proof_path,delivery_otp_hash,delivery_otp_expires_at,delivery_otp_verified_at,
      delivery_otp_attempts,cod_collected_amount,cod_collected_at,cash_reconciled_amount,cash_reconciled_at,cash_reconciled_by,cash_reconciliation_note)
   values(v_order.id,p_driver_user_id,auth.uid(),p_batch_id,'assigned',now(),null,null,null,null,null,null,null,null,0,null,null,null,null,null,null)
   on conflict (order_id) do update set driver_user_id=excluded.driver_user_id,assigned_by=excluded.assigned_by,
     delivery_batch_id=excluded.delivery_batch_id,status='assigned',assigned_at=now(),picked_up_at=null,delivered_at=null,
     failed_reason=null,failed_note=null,delivery_proof_path=null,delivery_otp_hash=null,delivery_otp_expires_at=null,
     delivery_otp_verified_at=null,delivery_otp_attempts=0,cod_collected_amount=null,cod_collected_at=null,
     cash_reconciled_amount=null,cash_reconciled_at=null,cash_reconciled_by=null,cash_reconciliation_note=null;
   v_count:=v_count+1;
 end loop;
 return v_count;
end;
$$;

create or replace function public.driver_list_assigned_orders_v2()
returns table(assignment_id uuid,order_id uuid,order_number text,order_status public.order_status,customer_name text,
 customer_phone text,delivery_address jsonb,delivery_lat numeric,delivery_lng numeric,delivery_location_name text,
 assigned_at timestamptz,assignment_status text,items jsonb,delivery_batch_id uuid,delivery_batch_number text,
 delivery_proof_path text,otp_verified boolean,cod_collected_amount numeric,payment_method text,order_total numeric,failed_reason text)
language plpgsql stable security definer set search_path = ''
as $$
begin
 if not coalesce((select x.enabled from public.customer_driver_access x where x.user_id=auth.uid()),false)
   or not exists(select 1 from public.driver_applications d where d.user_id=auth.uid() and d.status='approved') then
   raise exception 'Approved active driver access required' using errcode='42501';
 end if;
 return query
 select a.id,o.id,o.order_number,o.order_status,o.customer_name,o.customer_phone,
   case when a.status in ('delivered','cancelled') then null::jsonb else o.shipping_address_snapshot end,
   case when a.status in ('delivered','cancelled') then null::numeric else o.delivery_lat end,
   case when a.status in ('delivered','cancelled') then null::numeric else o.delivery_lng end,
   case when a.status in ('delivered','cancelled') then null::text else o.delivery_location_name end,
   a.assigned_at,a.status,
   coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',i.quantity,'variant',i.variant_snapshot) order by i.created_at)
     from public.order_items i where i.order_id=o.id),'[]'::jsonb),
   a.delivery_batch_id,b.batch_number,a.delivery_proof_path,(a.delivery_otp_verified_at is not null),
   a.cod_collected_amount,o.payment_method::text,o.total,a.failed_reason
 from public.driver_assignments a join public.orders o on o.id=a.order_id
 left join public.delivery_batches b on b.id=a.delivery_batch_id
 where a.driver_user_id=auth.uid()
 order by case when a.status in ('delivered','cancelled','failed') then 1 else 0 end,a.assigned_at desc;
end;
$$;

revoke all on function public.driver_set_delivery_proof_path(uuid,text) from public,anon;
grant execute on function public.driver_set_delivery_proof_path(uuid,text) to authenticated;
revoke all on function public.admin_list_driver_cash_reconciliation() from public,anon;
grant execute on function public.admin_list_driver_cash_reconciliation() to authenticated;
revoke all on function public.admin_list_assignable_delivery_batches() from public,anon;
grant execute on function public.admin_list_assignable_delivery_batches() to authenticated;
revoke all on function public.admin_assign_driver_to_delivery_batch(uuid,uuid) from public,anon;
grant execute on function public.admin_assign_driver_to_delivery_batch(uuid,uuid) to authenticated;
revoke all on function public.driver_list_assigned_orders_v2() from public,anon;
grant execute on function public.driver_list_assigned_orders_v2() to authenticated;
