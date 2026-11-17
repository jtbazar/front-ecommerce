-- Harden Phase 2 delivery OTP and retain cash reconciliation notes.
alter table public.driver_assignments
  add column if not exists delivery_otp_attempts integer not null default 0,
  add column if not exists cash_reconciliation_note text;
alter table public.driver_assignments
  add constraint driver_assignments_otp_attempts_check check (delivery_otp_attempts between 0 and 5);

create or replace function public.customer_generate_delivery_otp(p_order_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_assignment_id uuid; v_status text; v_code text; v_bytes bytea; v_num bigint;
begin
  select a.id,a.status into v_assignment_id,v_status from public.driver_assignments a
    join public.orders o on o.id=a.order_id where a.order_id=p_order_id and o.customer_id=auth.uid() for update of a;
  if v_assignment_id is null then raise exception 'Delivery not found for this customer' using errcode='42501'; end if;
  if v_status <> 'picked_up' then raise exception 'OTP is available once the driver has picked up the parcel' using errcode='22023'; end if;
  v_bytes := extensions.gen_random_bytes(4);
  v_num := (get_byte(v_bytes,0)::bigint * 16777216 + get_byte(v_bytes,1)::bigint * 65536 + get_byte(v_bytes,2)::bigint * 256 + get_byte(v_bytes,3)::bigint) % 1000000;
  v_code := lpad(v_num::text,6,'0');
  update public.driver_assignments set delivery_otp_hash=encode(extensions.digest(v_code,'sha256'),'hex'),
    delivery_otp_expires_at=now()+interval '30 minutes',delivery_otp_verified_at=null,delivery_otp_attempts=0 where id=v_assignment_id;
  return v_code;
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
    into v_order_id,v_hash,v_expiry,v_status,v_attempts from public.driver_assignments a
    where a.id=p_assignment_id and a.driver_user_id=auth.uid() for update;
  if v_order_id is null then raise exception 'Assigned delivery not found' using errcode='42501'; end if;
  if v_status <> 'picked_up' then raise exception 'Parcel must be picked up before OTP verification' using errcode='22023'; end if;
  if v_attempts >= 5 then raise exception 'OTP attempts limit reached. Ask customer to generate a new code.' using errcode='22023'; end if;
  if p_code !~ '^[0-9]{6}$' or v_hash is null or v_expiry is null or v_expiry < now()
     or v_hash <> encode(extensions.digest(p_code,'sha256'),'hex') then
    update public.driver_assignments set delivery_otp_attempts=least(delivery_otp_attempts+1,5) where id=p_assignment_id;
    raise exception 'Invalid or expired delivery OTP' using errcode='22023';
  end if;
  update public.driver_assignments set delivery_otp_verified_at=now() where id=p_assignment_id;
  insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
    values(p_assignment_id,v_order_id,auth.uid(),'otp_verified');
  return true;
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
  if p_note is not null and char_length(p_note)>1000 then raise exception 'Reconciliation note is too long' using errcode='22023'; end if;
  update public.driver_assignments set cash_reconciled_amount=p_amount,cash_reconciled_at=now(),
    cash_reconciled_by=auth.uid(),cash_reconciliation_note=nullif(btrim(p_note),'') where id=p_assignment_id;
  insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
    values(p_assignment_id,v_order_id,v_driver,'cash_reconciled');
end;
$$;
