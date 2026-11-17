-- Phase 2 driver delivery: failure reasons, customer OTP verification, COD collection and reconciliation.
-- This migration is additive; it preserves existing orders and assignments.

alter table public.driver_assignments
  add column if not exists failed_reason text,
  add column if not exists failed_note text,
  add column if not exists delivery_proof_path text,
  add column if not exists delivery_otp_hash text,
  add column if not exists delivery_otp_expires_at timestamptz,
  add column if not exists delivery_otp_verified_at timestamptz,
  add column if not exists cod_collected_amount numeric(12,2),
  add column if not exists cod_collected_at timestamptz,
  add column if not exists cash_reconciled_amount numeric(12,2),
  add column if not exists cash_reconciled_at timestamptz,
  add column if not exists cash_reconciled_by uuid references auth.users(id);

alter table public.driver_assignments drop constraint if exists driver_assignments_status_check;
alter table public.driver_assignments add constraint driver_assignments_status_check
  check (status = any (array['assigned','picked_up','delivered','cancelled','failed']));

alter table public.driver_delivery_events drop constraint if exists driver_delivery_events_event_type_check;
alter table public.driver_delivery_events add constraint driver_delivery_events_event_type_check
  check (event_type = any (array['picked_up','delivered','failed','otp_verified','proof_uploaded','cod_collected','cash_reconciled']));

alter table public.driver_assignments
  add constraint driver_assignments_failed_reason_check
  check (failed_reason is null or failed_reason = any(array['customer_unavailable','address_issue','customer_refused','delivery_failed'])),
  add constraint driver_assignments_cod_amount_check
  check (cod_collected_amount is null or cod_collected_amount >= 0),
  add constraint driver_assignments_reconciled_amount_check
  check (cash_reconciled_amount is null or cash_reconciled_amount >= 0);

create or replace function public.driver_mark_delivery_failed(p_assignment_id uuid,p_reason text,p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_status text;
begin
  if not coalesce((select a.enabled from public.customer_driver_access a where a.user_id=auth.uid()),false)
     or not exists(select 1 from public.driver_applications d where d.user_id=auth.uid() and d.status='approved') then
    raise exception 'Approved active driver access required' using errcode='42501';
  end if;
  if p_reason not in ('customer_unavailable','address_issue','customer_refused','delivery_failed') then
    raise exception 'Select a valid delivery failure reason' using errcode='22023';
  end if;
  if p_note is not null and char_length(p_note)>1000 then raise exception 'Failure note is too long' using errcode='22023'; end if;
  select a.order_id,a.status into v_order_id,v_status from public.driver_assignments a
    where a.id=p_assignment_id and a.driver_user_id=auth.uid() for update;
  if v_order_id is null then raise exception 'Assigned delivery not found' using errcode='42501'; end if;
  if v_status not in ('assigned','picked_up') then raise exception 'This delivery cannot be marked failed' using errcode='22023'; end if;
  update public.driver_assignments set status='failed',failed_reason=p_reason,failed_note=nullif(btrim(p_note),'') where id=p_assignment_id;
  insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
    values(p_assignment_id,v_order_id,auth.uid(),'failed');
end;
$$;

create or replace function public.customer_generate_delivery_otp(p_order_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_assignment_id uuid; v_status text; v_code text;
begin
  select a.id,a.status into v_assignment_id,v_status from public.driver_assignments a
    join public.orders o on o.id=a.order_id where a.order_id=p_order_id and o.customer_id=auth.uid() for update of a;
  if v_assignment_id is null then raise exception 'Delivery not found for this customer' using errcode='42501'; end if;
  if v_status <> 'picked_up' then raise exception 'OTP is available once the driver has picked up the parcel' using errcode='22023'; end if;
  v_code := lpad((floor(random()*1000000))::bigint::text,6,'0');
  update public.driver_assignments set delivery_otp_hash=encode(extensions.digest(v_code,'sha256'),'hex'),
    delivery_otp_expires_at=now()+interval '30 minutes',delivery_otp_verified_at=null where id=v_assignment_id;
  return v_code;
end;
$$;

create or replace function public.driver_verify_delivery_otp(p_assignment_id uuid,p_code text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_hash text; v_expiry timestamptz; v_status text;
begin
  if not coalesce((select a.enabled from public.customer_driver_access a where a.user_id=auth.uid()),false)
     or not exists(select 1 from public.driver_applications d where d.user_id=auth.uid() and d.status='approved') then
    raise exception 'Approved active driver access required' using errcode='42501';
  end if;
  select a.order_id,a.delivery_otp_hash,a.delivery_otp_expires_at,a.status into v_order_id,v_hash,v_expiry,v_status
    from public.driver_assignments a where a.id=p_assignment_id and a.driver_user_id=auth.uid() for update;
  if v_order_id is null then raise exception 'Assigned delivery not found' using errcode='42501'; end if;
  if v_status <> 'picked_up' then raise exception 'Parcel must be picked up before OTP verification' using errcode='22023'; end if;
  if p_code !~ '^[0-9]{6}$' or v_hash is null or v_expiry is null or v_expiry < now()
     or v_hash <> encode(extensions.digest(p_code,'sha256'),'hex') then
    raise exception 'Invalid or expired delivery OTP' using errcode='22023';
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
declare v_order_id uuid; v_status text; v_method public.payment_method; v_total numeric;
begin
  if not coalesce((select a.enabled from public.customer_driver_access a where a.user_id=auth.uid()),false)
     or not exists(select 1 from public.driver_applications d where d.user_id=auth.uid() and d.status='approved') then
    raise exception 'Approved active driver access required' using errcode='42501';
  end if;
  select a.order_id,a.status,o.payment_method,o.total into v_order_id,v_status,v_method,v_total
    from public.driver_assignments a join public.orders o on o.id=a.order_id
    where a.id=p_assignment_id and a.driver_user_id=auth.uid() for update of a;
  if v_order_id is null then raise exception 'Assigned delivery not found' using errcode='42501'; end if;
  if v_method <> 'cod' then raise exception 'Cash collection is only available for COD orders' using errcode='22023'; end if;
  if v_status <> 'delivered' then raise exception 'Record COD after delivery is completed' using errcode='22023'; end if;
  if p_amount is null or p_amount < 0 or p_amount > v_total then raise exception 'Collected amount must be between zero and the order total' using errcode='22023'; end if;
  update public.driver_assignments set cod_collected_amount=p_amount,cod_collected_at=now() where id=p_assignment_id;
  insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
    values(p_assignment_id,v_order_id,auth.uid(),'cod_collected');
end;
$$;

create or replace function public.admin_reconcile_driver_cash(p_assignment_id uuid,p_amount numeric,p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_collected numeric; v_status text;
begin
  if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
  select a.order_id,a.cod_collected_amount,a.status into v_order_id,v_collected,v_status
    from public.driver_assignments a where a.id=p_assignment_id for update;
  if v_order_id is null then raise exception 'Driver assignment not found' using errcode='P0002'; end if;
  if v_status <> 'delivered' or v_collected is null then raise exception 'Driver COD collection must be recorded before reconciliation' using errcode='22023'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Reconciled amount cannot be negative' using errcode='22023'; end if;
  update public.driver_assignments set cash_reconciled_amount=p_amount,cash_reconciled_at=now(),cash_reconciled_by=auth.uid()
    where id=p_assignment_id;
  insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
    select p_assignment_id,v_order_id,a.driver_user_id,'cash_reconciled' from public.driver_assignments a where a.id=p_assignment_id;
end;
$$;

revoke all on function public.driver_mark_delivery_failed(uuid,text,text) from public,anon;
grant execute on function public.driver_mark_delivery_failed(uuid,text,text) to authenticated;
revoke all on function public.customer_generate_delivery_otp(uuid) from public,anon;
grant execute on function public.customer_generate_delivery_otp(uuid) to authenticated;
revoke all on function public.driver_verify_delivery_otp(uuid,text) from public,anon;
grant execute on function public.driver_verify_delivery_otp(uuid,text) to authenticated;
revoke all on function public.driver_record_cod_collection(uuid,numeric) from public,anon;
grant execute on function public.driver_record_cod_collection(uuid,numeric) to authenticated;
revoke all on function public.admin_reconcile_driver_cash(uuid,numeric,text) from public,anon;
grant execute on function public.admin_reconcile_driver_cash(uuid,numeric,text) to authenticated;
