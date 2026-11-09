
-- JTBazar admin delivery batches and delivery fee controls.
-- Snapshot of the database migration applied to the shared Supabase project.

alter table public.store_settings add column if not exists free_delivery_enabled boolean not null default false, add column if not exists additional_delivery_fee numeric(12,2) not null default 0;
alter table public.store_settings drop constraint if exists store_settings_additional_delivery_fee_check;
alter table public.store_settings add constraint store_settings_additional_delivery_fee_check check (additional_delivery_fee >= 0);
alter table public.order_items add column if not exists delivery_status text not null default 'pending';
alter table public.order_items drop constraint if exists order_items_delivery_status_check;
alter table public.order_items add constraint order_items_delivery_status_check check (delivery_status in ('pending','ready','delivered'));

create table if not exists public.delivery_batches (
 id uuid primary key default gen_random_uuid(),
 batch_number text not null unique default ('DL-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 customer_id uuid references auth.users(id) on delete set null,
 customer_phone text not null,
 status text not null default 'scheduled' check (status in ('scheduled','in_transit','delivered','cancelled')),
 delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
 fee_adjustment_reason text,
 expected_delivery_date date,
 delivery_window_start time,
 delivery_window_end time,
 delivery_note text,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint delivery_batches_window_valid check ((expected_delivery_date is null and delivery_window_start is null and delivery_window_end is null) or (expected_delivery_date is not null and delivery_window_start is not null and delivery_window_end is not null and delivery_window_end > delivery_window_start))
);
create table if not exists public.delivery_batch_orders (
 batch_id uuid not null references public.delivery_batches(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade,
 fee_allocated numeric(12,2) not null default 0 check (fee_allocated >= 0),
 created_at timestamptz not null default now(),
 primary key(batch_id,order_id)
);
create index if not exists delivery_batch_orders_order_id_idx on public.delivery_batch_orders(order_id);
create table if not exists public.delivery_batch_items (
 batch_id uuid not null references public.delivery_batches(id) on delete cascade,
 order_item_id uuid not null references public.order_items(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(batch_id,order_item_id),
 unique(order_item_id)
);
alter table public.delivery_batches enable row level security;
alter table public.delivery_batch_orders enable row level security;
alter table public.delivery_batch_items enable row level security;
drop policy if exists "Admins can manage delivery batches" on public.delivery_batches;
create policy "Admins can manage delivery batches" on public.delivery_batches for all to authenticated using ((select private.has_role('admin'::public.app_role))) with check ((select private.has_role('admin'::public.app_role)));
drop policy if exists "Admins can manage delivery batch orders" on public.delivery_batch_orders;
create policy "Admins can manage delivery batch orders" on public.delivery_batch_orders for all to authenticated using ((select private.has_role('admin'::public.app_role))) with check ((select private.has_role('admin'::public.app_role)));
drop policy if exists "Admins can manage delivery batch items" on public.delivery_batch_items;
create policy "Admins can manage delivery batch items" on public.delivery_batch_items for all to authenticated using ((select private.has_role('admin'::public.app_role))) with check ((select private.has_role('admin'::public.app_role)));

CREATE OR REPLACE FUNCTION private.normalize_pk_phone(p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when pg_catalog.regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') like '92%'
      then '0' || pg_catalog.substr(pg_catalog.regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),3)
    else pg_catalog.regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')
  end
$function$


CREATE OR REPLACE FUNCTION public.admin_confirm_orders_with_delivery_batch(p_order_ids uuid[], p_ready_item_ids uuid[], p_expected_delivery_date date, p_delivery_window_start time without time zone, p_delivery_window_end time without time zone, p_delivery_note text DEFAULT NULL::text, p_delivery_fee_override numeric DEFAULT NULL::numeric, p_fee_adjustment_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_anchor public.orders;v_order public.orders;v_settings public.store_settings;v_batch public.delivery_batches;
  v_batch_id uuid;v_default_fee numeric(12,2);v_fee numeric(12,2);v_id uuid;v_phone text;
  v_count integer;v_existing_count integer;v_existing_batch_id uuid;v_is_first boolean;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception using errcode='42501',message='JTBazar authenticator verification is required.'; end if;
  if not private.has_role('admin'::public.app_role) then raise exception using errcode='42501',message='Administrator access required.'; end if;
  if p_order_ids is null or cardinality(p_order_ids)<1 or cardinality(p_order_ids)>20 then raise exception using errcode='22023',message='Select between one and twenty orders.'; end if;
  if p_expected_delivery_date is null or p_delivery_window_start is null or p_delivery_window_end is null or p_delivery_window_end<=p_delivery_window_start then raise exception using errcode='22023',message='A valid delivery date and time window are required.'; end if;
  if (select count(distinct x) from unnest(p_order_ids) x)<>cardinality(p_order_ids) then raise exception using errcode='22023',message='Duplicate orders are not allowed.'; end if;
  select * into v_anchor from public.orders where id=p_order_ids[1] for update;
  if not found or v_anchor.order_status<>'pending'::public.order_status then raise exception using errcode='22023',message='The primary order must still be pending confirmation.'; end if;
  v_phone:=private.normalize_pk_phone(v_anchor.customer_phone);
  select * into v_settings from public.store_settings where id='default';
  v_default_fee:=case when coalesce(v_settings.free_delivery_enabled,false) then 0 else v_settings.delivery_fee end;
  select count(distinct dbo.batch_id),min(dbo.batch_id::text)::uuid into v_existing_count,v_existing_batch_id
  from public.delivery_batch_orders dbo join public.delivery_batches db on db.id=dbo.batch_id
  where dbo.order_id=any(p_order_ids) and db.status='scheduled';
  if v_existing_count>1 then raise exception using errcode='22023',message='Selected orders belong to different active delivery batches. Please select orders from one batch only.'; end if;
  if v_existing_count=1 then
    select * into v_batch from public.delivery_batches where id=v_existing_batch_id for update;
    v_batch_id:=v_existing_batch_id;v_fee:=v_batch.delivery_fee;
    if p_delivery_fee_override is not null and p_delivery_fee_override<>v_fee then raise exception using errcode='22023',message='This customer already has an active delivery batch. Its delivery fee is already set; adjust the existing batch separately.'; end if;
  else
    v_fee:=coalesce(p_delivery_fee_override,v_default_fee);
    if v_fee<0 then raise exception using errcode='22023',message='Delivery fee cannot be negative.'; end if;
    if v_fee<>v_default_fee and nullif(btrim(coalesce(p_fee_adjustment_reason,'')),'') is null then raise exception using errcode='22023',message='A reason is required when changing the standard delivery fee.'; end if;
    insert into public.delivery_batches(customer_id,customer_phone,delivery_fee,fee_adjustment_reason,expected_delivery_date,delivery_window_start,delivery_window_end,delivery_note,created_by)
    values(v_anchor.customer_id,v_anchor.customer_phone,v_fee,nullif(btrim(p_fee_adjustment_reason),''),p_expected_delivery_date,p_delivery_window_start,p_delivery_window_end,nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),auth.uid()) returning id into v_batch_id;
  end if;
  select count(*) into v_count from public.orders where id=any(p_order_ids) and order_status in ('pending'::public.order_status,'confirmed'::public.order_status,'processing'::public.order_status);
  if v_count<>cardinality(p_order_ids) then raise exception using errcode='22023',message='Every selected order must be active and eligible for delivery.'; end if;
  if exists(select 1 from public.orders o where o.id=any(p_order_ids) and not ((v_anchor.customer_id is not null and o.customer_id=v_anchor.customer_id) or (private.normalize_pk_phone(o.customer_phone)=v_phone and length(v_phone)>=10))) then raise exception using errcode='22023',message='Selected orders must belong to the same customer.'; end if;
  if v_existing_count=1 then update public.delivery_batches set expected_delivery_date=p_expected_delivery_date,delivery_window_start=p_delivery_window_start,delivery_window_end=p_delivery_window_end,delivery_note=nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),updated_at=now() where id=v_batch_id; end if;
  for v_id in select unnest(p_order_ids) loop
    select * into v_order from public.orders where id=v_id for update;
    if not exists(select 1 from public.delivery_batch_orders where batch_id=v_batch_id and order_id=v_id) then
      v_is_first:=(v_existing_count=0 and v_id=p_order_ids[1]);
      update public.orders set delivery_fee=case when v_is_first then v_fee else 0 end,total=subtotal+case when v_is_first then v_fee else 0 end-discount_amount where id=v_id;
      insert into public.delivery_batch_orders(batch_id,order_id,fee_allocated) values(v_batch_id,v_id,case when v_is_first then v_fee else 0 end);
    end if;
    update public.orders set expected_delivery_date=p_expected_delivery_date,delivery_window_start=p_delivery_window_start,delivery_window_end=p_delivery_window_end,
      delivery_note=nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),delivery_timing_confirmed_at=now(),delivery_timing_confirmed_by=auth.uid(),
      confirmation_status='confirmed',confirmed_at=case when order_status='pending'::public.order_status then now() else confirmed_at end,
      confirmed_by=case when order_status='pending'::public.order_status then auth.uid() else confirmed_by end,
      confirmation_note='Delivery grouped in batch '||(select batch_number from public.delivery_batches where id=v_batch_id),
      order_status=case when order_status='pending'::public.order_status then 'confirmed'::public.order_status else order_status end,updated_at=now() where id=v_id;
  end loop;
  if coalesce(cardinality(p_ready_item_ids),0)>0 then
    if exists(select 1 from public.order_items oi where oi.id=any(p_ready_item_ids) and (oi.order_id<>all(p_order_ids) or oi.delivery_status<>'pending' or exists(select 1 from public.delivery_batch_items bi where bi.order_item_id=oi.id))) then raise exception using errcode='22023',message='Only pending, unassigned items from the selected orders can be added to this delivery.'; end if;
    insert into public.delivery_batch_items(batch_id,order_item_id) select v_batch_id,oi.id from public.order_items oi where oi.id=any(p_ready_item_ids);
    update public.order_items set delivery_status='ready' where id=any(p_ready_item_ids);
  end if;
  insert into public.admin_audit_logs(actor_id,action,entity,entity_id,details)
  values(auth.uid(),'UPDATE','delivery_batches',v_batch_id,jsonb_build_object('batch_id',v_batch_id,'order_ids',p_order_ids,'ready_item_ids',coalesce(p_ready_item_ids,'{}'::uuid[]),'delivery_fee',v_fee,'default_fee',v_default_fee,'fee_adjustment_reason',p_fee_adjustment_reason,'reused_existing_batch',v_existing_count=1));
  return v_batch_id;
end;
$function$


CREATE OR REPLACE FUNCTION public.admin_create_followup_delivery_batch(p_order_id uuid, p_item_ids uuid[], p_expected_delivery_date date, p_delivery_window_start time without time zone, p_delivery_window_end time without time zone, p_delivery_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_order public.orders;v_batch_id uuid;v_fee numeric(12,2);
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception using errcode='42501',message='JTBazar authenticator verification is required.'; end if;
  if not private.has_role('admin'::public.app_role) then raise exception using errcode='42501',message='Administrator access required.'; end if;
  if p_item_ids is null or cardinality(p_item_ids)<1 then raise exception using errcode='22023',message='Select at least one pending item.'; end if;
  if p_expected_delivery_date is null or p_delivery_window_start is null or p_delivery_window_end is null or p_delivery_window_end<=p_delivery_window_start then raise exception using errcode='22023',message='A valid delivery date and time window are required.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.order_status='cancelled'::public.order_status then raise exception using errcode='22023',message='Active order not found.'; end if;
  if exists(select 1 from public.order_items oi where oi.id=any(p_item_ids) and (oi.order_id<>p_order_id or oi.delivery_status='delivered' or exists(select 1 from public.delivery_batch_items bi where bi.order_item_id=oi.id))) then raise exception using errcode='22023',message='Selected items are not eligible for another delivery.'; end if;
  if (select count(*) from public.order_items where id=any(p_item_ids) and order_id=p_order_id)<>cardinality(p_item_ids) then raise exception using errcode='22023',message='One or more selected items were not found.'; end if;
  select additional_delivery_fee into v_fee from public.store_settings where id='default';v_fee:=coalesce(v_fee,0);
  insert into public.delivery_batches(customer_id,customer_phone,delivery_fee,expected_delivery_date,delivery_window_start,delivery_window_end,delivery_note,created_by)
  values(v_order.customer_id,v_order.customer_phone,v_fee,p_expected_delivery_date,p_delivery_window_start,p_delivery_window_end,nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),auth.uid()) returning id into v_batch_id;
  insert into public.delivery_batch_orders(batch_id,order_id,fee_allocated) values(v_batch_id,p_order_id,v_fee);
  insert into public.delivery_batch_items(batch_id,order_item_id) select v_batch_id,unnest(p_item_ids);
  update public.order_items set delivery_status='ready' where id=any(p_item_ids);
  update public.orders set
    delivery_fee=delivery_fee+v_fee,total=total+v_fee,
    expected_delivery_date=p_expected_delivery_date,delivery_window_start=p_delivery_window_start,delivery_window_end=p_delivery_window_end,
    delivery_note=nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),delivery_timing_confirmed_at=now(),delivery_timing_confirmed_by=auth.uid(),updated_at=now()
  where id=p_order_id;
  insert into public.admin_audit_logs(actor_id,action,entity,entity_id,details)
  values(auth.uid(),'INSERT','delivery_batches',v_batch_id,jsonb_build_object('order_id',p_order_id,'item_ids',p_item_ids,'additional_delivery_fee',v_fee));
  return v_batch_id;
end;
$function$


CREATE OR REPLACE FUNCTION public.admin_find_customer_delivery_orders(p_order_id uuid)
 RETURNS TABLE(id uuid, order_number text, customer_name text, customer_phone text, subtotal numeric, delivery_fee numeric, total numeric, order_status order_status, created_at timestamp with time zone, expected_delivery_date date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_order public.orders;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception using errcode='42501',message='JTBazar authenticator verification is required.'; end if;
  if not private.has_role('admin'::public.app_role) then raise exception using errcode='42501',message='Administrator access required.'; end if;
  select * into v_order from public.orders where orders.id=p_order_id;
  if not found then raise exception using errcode='22023',message='Order not found.'; end if;
  return query select o.id,o.order_number,o.customer_name,o.customer_phone,o.subtotal,o.delivery_fee,o.total,o.order_status,o.created_at,o.expected_delivery_date
  from public.orders o where o.id<>p_order_id and o.order_status in ('pending'::public.order_status,'confirmed'::public.order_status,'processing'::public.order_status)
    and ((v_order.customer_id is not null and o.customer_id=v_order.customer_id)
      or (private.normalize_pk_phone(o.customer_phone)=private.normalize_pk_phone(v_order.customer_phone) and length(private.normalize_pk_phone(v_order.customer_phone))>=10))
    and not exists(select 1 from public.delivery_batch_orders dbo join public.delivery_batches db on db.id=dbo.batch_id where dbo.order_id=o.id and db.status in ('delivered','cancelled','in_transit'))
  order by o.created_at desc limit 50;
end;
$function$


CREATE OR REPLACE FUNCTION public.admin_mark_delivery_batch_delivered(p_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception using errcode='42501',message='JTBazar authenticator verification is required.'; end if;
  if not private.has_role('admin'::public.app_role) then raise exception using errcode='42501',message='Administrator access required.'; end if;
  update public.delivery_batches set status='delivered',updated_at=now() where id=p_batch_id and status<>'cancelled';
  if not found then raise exception using errcode='22023',message='Delivery batch not found or cancelled.'; end if;
  update public.order_items oi set delivery_status='delivered' from public.delivery_batch_items bi where bi.batch_id=p_batch_id and bi.order_item_id=oi.id;
  insert into public.admin_audit_logs(actor_id,action,entity,entity_id,details)
  values(auth.uid(),'UPDATE','delivery_batches',p_batch_id,jsonb_build_object('status','delivered','note','Item delivery recorded; order-level COD collection remains a separate admin action.'));
end;
$function$


CREATE OR REPLACE FUNCTION public.admin_update_store_settings(p_settings jsonb)
 RETURNS store_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result_row public.store_settings;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception using errcode='42501',message='JTBazar authenticator verification is required.';
  end if;
  if not private.has_role('admin'::public.app_role) then
    raise exception using errcode='42501',message='Administrator access is required.';
  end if;
  if p_settings is null or pg_catalog.jsonb_typeof(p_settings)<>'object' then
    raise exception using errcode='22023',message='Store settings must be an object.';
  end if;
  update public.store_settings s set
    store_name=coalesce(nullif(pg_catalog.btrim(p_settings->>'store_name'),''),s.store_name),
    support_email=case when p_settings ? 'support_email' then nullif(pg_catalog.btrim(p_settings->>'support_email'),'') else s.support_email end,
    support_phone=case when p_settings ? 'support_phone' then nullif(pg_catalog.btrim(p_settings->>'support_phone'),'') else s.support_phone end,
    support_whatsapp=case when p_settings ? 'support_whatsapp' then nullif(pg_catalog.btrim(p_settings->>'support_whatsapp'),'') else s.support_whatsapp end,
    delivery_fee=case when p_settings ? 'delivery_fee' then (p_settings->>'delivery_fee')::numeric else s.delivery_fee end,
    free_delivery_enabled=case when p_settings ? 'free_delivery_enabled' then (p_settings->>'free_delivery_enabled')::boolean else s.free_delivery_enabled end,
    additional_delivery_fee=case when p_settings ? 'additional_delivery_fee' then (p_settings->>'additional_delivery_fee')::numeric else s.additional_delivery_fee end,
    cod_enabled=case when p_settings ? 'cod_enabled' then (p_settings->>'cod_enabled')::boolean else s.cod_enabled end,
    return_window_days=case when p_settings ? 'return_window_days' then (p_settings->>'return_window_days')::integer else s.return_window_days end
  where s.id='default' returning * into result_row;
  if not found then raise exception using errcode='22023',message='Store settings were not found.'; end if;
  if result_row.delivery_fee<0 or result_row.additional_delivery_fee<0 or result_row.return_window_days<0 then
    raise exception using errcode='22023',message='Fees and return window must be zero or greater.';
  end if;
  return result_row;
end;
$function$


revoke all on function public.admin_find_customer_delivery_orders(uuid) from public,anon;
revoke all on function public.admin_confirm_orders_with_delivery_batch(uuid[],uuid[],date,time,time,text,numeric,text) from public,anon;
revoke all on function public.admin_create_followup_delivery_batch(uuid,uuid[],date,time,time,text) from public,anon;
revoke all on function public.admin_mark_delivery_batch_delivered(uuid) from public,anon;
grant execute on function public.admin_find_customer_delivery_orders(uuid) to authenticated;
grant execute on function public.admin_confirm_orders_with_delivery_batch(uuid[],uuid[],date,time,time,text,numeric,text) to authenticated;
grant execute on function public.admin_create_followup_delivery_batch(uuid,uuid[],date,time,time,text) to authenticated;
grant execute on function public.admin_mark_delivery_batch_delivered(uuid) to authenticated;


-- Checkout reads the same admin-managed free-delivery flag; the database remains authoritative.
CREATE OR REPLACE FUNCTION public.place_order(p_customer_name text, p_customer_phone text, p_customer_email text, p_shipping_address jsonb, p_items jsonb, p_idempotency_key text, p_customer_note text DEFAULT NULL::text, p_delivery_lat numeric DEFAULT NULL::numeric, p_delivery_lng numeric DEFAULT NULL::numeric, p_delivery_location_name text DEFAULT NULL::text, p_delivery_location_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  line record;
  product_lock_id uuid;
  product_row public.products%ROWTYPE;
  seller_row public.seller_profiles%ROWTYPE;
  inventory_row public.product_inventory%ROWTYPE;
  v_buyer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_item_quantity integer;
  v_item_price numeric(12, 2);
  v_variant_sku text;
  v_variant_snapshot jsonb;
  v_subtotal numeric(16, 2) := 0;
  v_delivery_fee numeric(16, 2) := 250;
  v_cod_enabled boolean := true;
  v_free_delivery_enabled boolean := false;
  v_seller record;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' AND (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' AND (private.has_role('admin'::public.app_role) OR private.has_verified_totp_factor()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JTBazar authenticator verification is required.';
  END IF;
  v_buyer_id := (SELECT auth.uid());
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in before placing an order.';
  END IF;

  IF p_customer_name IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_customer_name)) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A valid customer name is required.';
  END IF;
  IF p_customer_phone IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_customer_phone)) NOT BETWEEN 7 AND 32 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A valid customer phone number is required.';
  END IF;
  IF p_customer_email IS NOT NULL AND pg_catalog.btrim(p_customer_email) <> ''
     AND p_customer_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A valid customer email is required.';
  END IF;
  IF p_shipping_address IS NULL OR pg_catalog.jsonb_typeof(p_shipping_address) <> 'object'
     OR NULLIF(pg_catalog.btrim(p_shipping_address ->> 'address_line_1'), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_shipping_address ->> 'city'), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A complete shipping address is required.';
  END IF;
  IF pg_catalog.octet_length(p_shipping_address::text) > 20000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The shipping address is too long.';
  END IF;
  IF p_idempotency_key IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A valid checkout key is required.';
  END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR pg_catalog.jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Between one and fifty order lines are required.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_items) AS input_line(product_id uuid, variant_id uuid, quantity integer)
    WHERE input_line.product_id IS NULL
       OR input_line.quantity IS NULL
       OR input_line.quantity NOT BETWEEN 1 AND 99
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Order lines require a product and a quantity between one and ninety-nine.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_items) AS input_line(product_id uuid, variant_id uuid, quantity integer)
    GROUP BY input_line.product_id, input_line.variant_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Duplicate order lines are not accepted.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_buyer_id::text || ':' || pg_catalog.btrim(p_idempotency_key), 0)
  );

  SELECT o.id INTO v_order_id
  FROM public.orders AS o
  WHERE o.customer_id = v_buyer_id
    AND o.idempotency_key = pg_catalog.btrim(p_idempotency_key);

  IF v_order_id IS NOT NULL THEN
    RETURN QUERY
    SELECT o.id, o.order_number, o.subtotal, o.delivery_fee, o.total
    FROM public.orders AS o
    WHERE o.id = v_order_id;
    RETURN;
  END IF;

  SELECT s.delivery_fee, s.cod_enabled, s.free_delivery_enabled
  INTO v_delivery_fee, v_cod_enabled, v_free_delivery_enabled
  FROM public.store_settings AS s
  WHERE s.id = 'default';

  IF NOT FOUND THEN
    v_delivery_fee := 250;
    v_cod_enabled := true;
    v_free_delivery_enabled := false;
  END IF;
  IF v_free_delivery_enabled THEN
    v_delivery_fee := 0;
  END IF;
  IF NOT v_cod_enabled THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Cash on delivery is currently unavailable.';
  END IF;

  FOR product_lock_id IN
    SELECT DISTINCT input_line.product_id
    FROM pg_catalog.jsonb_to_recordset(p_items) AS input_line(product_id uuid, variant_id uuid, quantity integer)
    ORDER BY input_line.product_id
  LOOP
    PERFORM 1 FROM public.products AS p WHERE p.id = product_lock_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An order product was not found.';
    END IF;
  END LOOP;

  FOR line IN
    SELECT *
    FROM pg_catalog.jsonb_to_recordset(p_items) AS input_line(product_id uuid, variant_id uuid, quantity integer)
  LOOP
    SELECT * INTO product_row FROM public.products AS p WHERE p.id = line.product_id;

    IF product_row.publication_status <> 'published'::public.publication_status THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An order product is no longer published.';
    END IF;
    IF product_row.moderation_status <> 'approved' OR product_row.stock_verification_status = 'paused' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An order product is not currently available.';
    END IF;
    IF product_row.currency <> 'PKR' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The product currency does not match the store currency.';
    END IF;

    IF product_row.seller_id IS NOT NULL THEN
      SELECT * INTO seller_row FROM public.seller_profiles AS s WHERE s.id = product_row.seller_id;
      IF NOT FOUND OR seller_row.status <> 'approved' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An order product seller is not currently approved.';
      END IF;
    END IF;

    IF line.variant_id IS NOT NULL THEN
      PERFORM 1 FROM public.product_variants AS v
      WHERE v.id = line.variant_id AND v.product_id = product_row.id AND v.is_active
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A selected product variant is unavailable.';
      END IF;
      v_item_price := NULL;
      v_variant_snapshot := NULL;
      v_variant_sku := NULL;
      SELECT COALESCE(v.price_override, product_row.price),
             pg_catalog.jsonb_build_object('label', v.option_label, 'value', v.option_value, 'attributes', v.attributes),
             v.sku
      INTO v_item_price, v_variant_snapshot, v_variant_sku
      FROM public.product_variants AS v
      WHERE v.id = line.variant_id AND v.product_id = product_row.id AND v.is_active;
      IF v_item_price IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A selected product variant is unavailable.';
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.product_variants AS v
        WHERE v.product_id = product_row.id AND v.is_active
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A product variant must be selected.';
      END IF;
      v_item_price := product_row.price;
      v_variant_snapshot := '{}'::jsonb;
      v_variant_sku := NULL;
    END IF;

    v_item_quantity := line.quantity;

    IF product_row.track_inventory THEN
      SELECT * INTO inventory_row
      FROM public.product_inventory AS i
      WHERE i.product_id = product_row.id
        AND i.variant_id IS NOT DISTINCT FROM line.variant_id
      FOR UPDATE;
      IF NOT FOUND OR inventory_row.quantity < v_item_quantity THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Insufficient product availability.';
      END IF;
    END IF;

    v_subtotal := v_subtotal + (v_item_price * v_item_quantity);
  END LOOP;

  INSERT INTO public.orders (
    customer_id, customer_name, customer_phone, customer_email,
    shipping_address_snapshot, customer_note, currency, subtotal,
    delivery_fee, payment_method, payment_status, order_status,
    delivery_lat, delivery_lng, delivery_location_name, delivery_location_captured_at,
    idempotency_key
  ) VALUES (
    v_buyer_id,
    pg_catalog.btrim(p_customer_name),
    pg_catalog.btrim(p_customer_phone),
    NULLIF(pg_catalog.btrim(COALESCE(p_customer_email, '')), ''),
    p_shipping_address,
    NULLIF(pg_catalog.btrim(COALESCE(p_customer_note, '')), ''),
    'PKR',
    v_subtotal,
    v_delivery_fee,
    'cod'::public.payment_method,
    'pending'::public.payment_status,
    'pending'::public.order_status,
    p_delivery_lat,
    p_delivery_lng,
    NULLIF(pg_catalog.btrim(COALESCE(p_delivery_location_name, '')), ''),
    p_delivery_location_captured_at,
    pg_catalog.btrim(p_idempotency_key)
  )
  RETURNING id, orders.order_number INTO v_order_id, v_order_number;

  PERFORM pg_catalog.set_config('paperloom.inventory_movement_type', 'sale', true);
  PERFORM pg_catalog.set_config('paperloom.inventory_reference_id', v_order_id::text, true);

  FOR line IN
    SELECT *
    FROM pg_catalog.jsonb_to_recordset(p_items) AS input_line(product_id uuid, variant_id uuid, quantity integer)
  LOOP
    SELECT * INTO product_row FROM public.products AS p WHERE p.id = line.product_id;

    IF line.variant_id IS NOT NULL THEN
      SELECT COALESCE(v.price_override, product_row.price),
             pg_catalog.jsonb_build_object('label', v.option_label, 'value', v.option_value, 'attributes', v.attributes),
             v.sku
      INTO v_item_price, v_variant_snapshot, v_variant_sku
      FROM public.product_variants AS v
      WHERE v.id = line.variant_id AND v.product_id = product_row.id AND v.is_active;
    ELSE
      v_item_price := product_row.price;
      v_variant_snapshot := '{}'::jsonb;
      v_variant_sku := NULL;
    END IF;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, seller_id, seller_name_snapshot,
      product_name_snapshot, sku_snapshot, variant_snapshot, product_snapshot,
      quantity, unit_price
    ) VALUES (
      v_order_id,
      product_row.id,
      line.variant_id,
      product_row.seller_id,
      (SELECT s.shop_name FROM public.seller_profiles AS s WHERE s.id = product_row.seller_id),
      product_row.name,
      COALESCE(v_variant_sku, product_row.sku),
      v_variant_snapshot,
      pg_catalog.jsonb_build_object(
        'slug', product_row.slug,
        'short_description', product_row.short_description,
        'currency', product_row.currency
      ),
      line.quantity,
      v_item_price
    );

    IF product_row.track_inventory THEN
      UPDATE public.product_inventory AS i
      SET quantity = i.quantity - line.quantity
      WHERE i.product_id = product_row.id
        AND i.variant_id IS NOT DISTINCT FROM line.variant_id;
    END IF;
  END LOOP;

  INSERT INTO public.notifications (user_id, kind, title, body, related_order_id)
  VALUES (
    v_buyer_id,
    'order',
    'Order ' || v_order_number || ' received',
    'We received your cash-on-delivery order. Track its status from your account.',
    v_order_id
  );

  FOR v_seller IN
    SELECT DISTINCT s.user_id, s.shop_name
    FROM public.order_items AS oi
    JOIN public.seller_profiles AS s ON s.id = oi.seller_id
    WHERE oi.order_id = v_order_id
  LOOP
    INSERT INTO public.notifications (user_id, kind, title, body, related_order_id)
    VALUES (
      v_seller.user_id,
      'order',
      'New order for ' || v_seller.shop_name,
      'A buyer placed order ' || v_order_number || '. Review the items in your seller dashboard.',
      v_order_id
    );
  END LOOP;

  RETURN QUERY
  SELECT v_order_id, v_order_number, v_subtotal, v_delivery_fee, (v_subtotal + v_delivery_fee);
END;
$function$
;


-- Final guard: an empty batch cannot be marked delivered.
CREATE OR REPLACE FUNCTION public.admin_mark_delivery_batch_delivered(p_batch_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception using errcode='42501',message='JTBazar authenticator verification is required.'; end if;
  if not private.has_role('admin'::public.app_role) then raise exception using errcode='42501',message='Administrator access required.'; end if;
  if not exists(select 1 from public.delivery_batch_items where batch_id=p_batch_id) then raise exception using errcode='22023',message='This delivery batch has no products assigned yet.'; end if;
  update public.delivery_batches set status='delivered',updated_at=now() where id=p_batch_id and status<>'cancelled';
  if not found then raise exception using errcode='22023',message='Delivery batch not found or cancelled.'; end if;
  update public.order_items oi set delivery_status='delivered' from public.delivery_batch_items bi where bi.batch_id=p_batch_id and bi.order_item_id=oi.id;
  insert into public.admin_audit_logs(actor_id,action,entity,entity_id,details)
  values(auth.uid(),'UPDATE','delivery_batches',p_batch_id,jsonb_build_object('status','delivered','note','Item delivery recorded; order-level COD collection remains a separate admin action.'));
end;
$function$
;


-- Final follow-up behavior: fill an empty first-delivery batch before creating a later shipment.
CREATE OR REPLACE FUNCTION public.admin_create_followup_delivery_batch(p_order_id uuid, p_item_ids uuid[], p_expected_delivery_date date, p_delivery_window_start time without time zone, p_delivery_window_end time without time zone, p_delivery_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_order public.orders;v_batch_id uuid;v_fee numeric(12,2);v_reuse_empty_batch boolean:=false;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception using errcode='42501',message='JTBazar authenticator verification is required.'; end if;
  if not private.has_role('admin'::public.app_role) then raise exception using errcode='42501',message='Administrator access required.'; end if;
  if p_item_ids is null or cardinality(p_item_ids)<1 then raise exception using errcode='22023',message='Select at least one pending item.'; end if;
  if p_expected_delivery_date is null or p_delivery_window_start is null or p_delivery_window_end is null or p_delivery_window_end<=p_delivery_window_start then raise exception using errcode='22023',message='A valid delivery date and time window are required.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.order_status='cancelled'::public.order_status then raise exception using errcode='22023',message='Active order not found.'; end if;
  if exists(select 1 from public.order_items oi where oi.id=any(p_item_ids) and (oi.order_id<>p_order_id or oi.delivery_status='delivered' or exists(select 1 from public.delivery_batch_items bi where bi.order_item_id=oi.id))) then raise exception using errcode='22023',message='Selected items are not eligible for another delivery.'; end if;
  if (select count(*) from public.order_items where id=any(p_item_ids) and order_id=p_order_id)<>cardinality(p_item_ids) then raise exception using errcode='22023',message='One or more selected items were not found.'; end if;

  select dbo.batch_id into v_batch_id
  from public.delivery_batch_orders dbo join public.delivery_batches db on db.id=dbo.batch_id
  where dbo.order_id=p_order_id and db.status='scheduled'
    and not exists(select 1 from public.delivery_batch_items bi where bi.batch_id=db.id)
  order by db.created_at asc limit 1 for update of db;
  v_reuse_empty_batch:=v_batch_id is not null;

  if v_reuse_empty_batch then
    v_fee:=0;
    update public.delivery_batches set expected_delivery_date=p_expected_delivery_date,delivery_window_start=p_delivery_window_start,delivery_window_end=p_delivery_window_end,delivery_note=nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),updated_at=now() where id=v_batch_id;
  else
    select additional_delivery_fee into v_fee from public.store_settings where id='default';v_fee:=coalesce(v_fee,0);
    insert into public.delivery_batches(customer_id,customer_phone,delivery_fee,expected_delivery_date,delivery_window_start,delivery_window_end,delivery_note,created_by)
    values(v_order.customer_id,v_order.customer_phone,v_fee,p_expected_delivery_date,p_delivery_window_start,p_delivery_window_end,nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),auth.uid()) returning id into v_batch_id;
    insert into public.delivery_batch_orders(batch_id,order_id,fee_allocated) values(v_batch_id,p_order_id,v_fee);
  end if;

  insert into public.delivery_batch_items(batch_id,order_item_id) select v_batch_id,unnest(p_item_ids);
  update public.order_items set delivery_status='ready' where id=any(p_item_ids);
  if not v_reuse_empty_batch and v_fee>0 then update public.orders set delivery_fee=delivery_fee+v_fee,total=total+v_fee,updated_at=now() where id=p_order_id; end if;
  update public.orders set expected_delivery_date=p_expected_delivery_date,delivery_window_start=p_delivery_window_start,delivery_window_end=p_delivery_window_end,
    delivery_note=nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),delivery_timing_confirmed_at=now(),delivery_timing_confirmed_by=auth.uid(),updated_at=now()
  where id=p_order_id;
  insert into public.admin_audit_logs(actor_id,action,entity,entity_id,details)
  values(auth.uid(),case when v_reuse_empty_batch then 'UPDATE' else 'INSERT' end,'delivery_batches',v_batch_id,
    jsonb_build_object('order_id',p_order_id,'item_ids',p_item_ids,'additional_delivery_fee',v_fee,'reused_empty_first_delivery_batch',v_reuse_empty_batch));
  return v_batch_id;
end;
$function$
;
