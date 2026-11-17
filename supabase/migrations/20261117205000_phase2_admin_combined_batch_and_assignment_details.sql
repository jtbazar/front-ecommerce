create or replace function public.admin_create_combined_driver_batch(p_order_ids uuid[])
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_batch_id uuid; v_customer_id uuid; v_phone text; v_fee numeric(12,2); v_count integer;
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_order_ids is null or cardinality(p_order_ids)<2 or cardinality(p_order_ids)>20 then
   raise exception 'Select between two and twenty orders to combine' using errcode='22023';
 end if;
 if (select count(distinct x) from unnest(p_order_ids) x)<>cardinality(p_order_ids) then
   raise exception 'Duplicate orders are not allowed' using errcode='22023';
 end if;
 select min(o.customer_id),min(o.customer_phone),sum(o.delivery_fee),count(*)
   into v_customer_id,v_phone,v_fee,v_count
 from public.orders o where o.id=any(p_order_ids) and o.order_status='confirmed'::public.order_status;
 if v_count<>cardinality(p_order_ids) or v_customer_id is null then
   raise exception 'Every selected order must be confirmed and belong to a registered customer' using errcode='22023';
 end if;
 if exists(select 1 from public.orders o where o.id=any(p_order_ids) and o.customer_id is distinct from v_customer_id) then
   raise exception 'All orders must belong to the same customer' using errcode='22023';
 end if;
 if (select count(distinct o.shipping_address_snapshot) from public.orders o where o.id=any(p_order_ids))<>1 then
   raise exception 'All selected orders must have exactly the same delivery address' using errcode='22023';
 end if;
 if exists(select 1 from public.driver_assignments a where a.order_id=any(p_order_ids) and a.status in ('assigned','picked_up')) then
   raise exception 'One or more orders already have an active driver assignment' using errcode='23505';
 end if;
 if exists(select 1 from public.delivery_batch_orders bo join public.delivery_batches b on b.id=bo.batch_id
   where bo.order_id=any(p_order_ids) and b.status='scheduled') then
   raise exception 'One or more orders already belong to a scheduled delivery batch' using errcode='23505';
 end if;
 insert into public.delivery_batches(customer_id,customer_phone,delivery_fee,status,created_by)
 values(v_customer_id,v_phone,coalesce(v_fee,0),'scheduled',auth.uid()) returning id into v_batch_id;
 insert into public.delivery_batch_orders(batch_id,order_id,fee_allocated)
 select v_batch_id,o.id,o.delivery_fee from public.orders o where o.id=any(p_order_ids);
 insert into public.admin_audit_logs(actor_id,action,entity,entity_id,details)
 values(auth.uid(),'INSERT','delivery_batches',v_batch_id,jsonb_build_object('order_ids',p_order_ids,'customer_id',v_customer_id,'delivery_fee_preserved',coalesce(v_fee,0),'combined_driver_route',true));
 return v_batch_id;
end;
$$;

create or replace function public.admin_list_driver_assignments_v2()
returns table(assignment_id uuid,order_id uuid,order_number text,customer_name text,driver_user_id uuid,driver_name text,
 driver_phone text,assignment_status text,assigned_at timestamptz,picked_up_at timestamptz,delivered_at timestamptz,
 driver_company_name text,failed_reason text,failed_note text,delivery_proof_path text,cod_collected_amount numeric,
 cash_reconciled_amount numeric,delivery_batch_number text)
language plpgsql stable security definer set search_path = ''
as $$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query
 select a.id,a.order_id,o.order_number::text,o.customer_name::text,a.driver_user_id,
   coalesce(d.full_name::text,''),coalesce(d.phone::text,''),a.status::text,a.assigned_at,a.picked_up_at,a.delivered_at,
   d.company_name::text,a.failed_reason,a.failed_note,a.delivery_proof_path,a.cod_collected_amount,a.cash_reconciled_amount,b.batch_number
 from public.driver_assignments a join public.orders o on o.id=a.order_id
 left join public.driver_applications d on d.user_id=a.driver_user_id
 left join public.delivery_batches b on b.id=a.delivery_batch_id
 order by a.assigned_at desc limit 300;
end;
$$;
revoke all on function public.admin_create_combined_driver_batch(uuid[]) from public,anon;
grant execute on function public.admin_create_combined_driver_batch(uuid[]) to authenticated;
revoke all on function public.admin_list_driver_assignments_v2() from public,anon;
grant execute on function public.admin_list_driver_assignments_v2() to authenticated;