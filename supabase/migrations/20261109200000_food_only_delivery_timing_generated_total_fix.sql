-- Food-only delivery scheduling and generated order total safety.
-- Non-food orders do not receive a delivery date/time window.
-- orders.total is generated; update delivery_fee only and let PostgreSQL recalculate total.

CREATE OR REPLACE FUNCTION public.admin_confirm_orders_with_delivery_batch(p_order_ids uuid[], p_ready_item_ids uuid[], p_expected_delivery_date date, p_delivery_window_start time without time zone, p_delivery_window_end time without time zone, p_delivery_note text DEFAULT NULL::text, p_delivery_fee_override numeric DEFAULT NULL::numeric, p_fee_adjustment_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_anchor public.orders;v_order public.orders;v_settings public.store_settings;v_batch public.delivery_batches;
  v_batch_id uuid;v_default_fee numeric(12,2);v_fee numeric(12,2);v_id uuid;v_phone text;
  v_count integer;v_existing_count integer;v_existing_batch_id uuid;v_is_first boolean;v_has_food boolean:=false;v_order_has_food boolean:=false;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2' then raise exception using errcode='42501',message='JTBazar authenticator verification is required.'; end if;
  if not private.has_role('admin'::public.app_role) then raise exception using errcode='42501',message='Administrator access required.'; end if;
  if p_order_ids is null or cardinality(p_order_ids)<1 or cardinality(p_order_ids)>20 then raise exception using errcode='22023',message='Select between one and twenty orders.'; end if;
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
    values(v_anchor.customer_id,v_anchor.customer_phone,v_fee,nullif(btrim(p_fee_adjustment_reason),''),case when v_has_food then p_expected_delivery_date else null end,case when v_has_food then p_delivery_window_start else null end,case when v_has_food then p_delivery_window_end else null end,nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),auth.uid()) returning id into v_batch_id;
  end if;
  select count(*) into v_count from public.orders where id=any(p_order_ids) and order_status in ('pending'::public.order_status,'confirmed'::public.order_status,'processing'::public.order_status);
  if v_count<>cardinality(p_order_ids) then raise exception using errcode='22023',message='Every selected order must be active and eligible for delivery.'; end if;
  select exists(
    select 1 from public.order_items oi
    join public.products p on p.id=oi.product_id
    left join public.categories c on c.id=p.category_id
    where oi.order_id=any(p_order_ids)
      and (coalesce(c.name,'') ilike '%food%' or coalesce(c.name,'') ilike '%grocery%' or p.food_product_type is not null)
  ) into v_has_food;
  if v_existing_count=1 then
    select v_has_food or exists(
      select 1 from public.delivery_batch_orders dbo
      join public.order_items oi on oi.order_id=dbo.order_id
      join public.products p on p.id=oi.product_id
      left join public.categories c on c.id=p.category_id
      where dbo.batch_id=v_existing_batch_id
        and (coalesce(c.name,'') ilike '%food%' or coalesce(c.name,'') ilike '%grocery%' or p.food_product_type is not null)
    ) into v_has_food;
  end if;
  if v_has_food and (p_expected_delivery_date is null or p_delivery_window_start is null or p_delivery_window_end is null or p_delivery_window_end<=p_delivery_window_start) then
    raise exception using errcode='22023',message='Food orders require a valid delivery date and time window.';
  end if;
  if exists(select 1 from public.orders o where o.id=any(p_order_ids) and not ((v_anchor.customer_id is not null and o.customer_id=v_anchor.customer_id) or (private.normalize_pk_phone(o.customer_phone)=v_phone and length(v_phone)>=10))) then raise exception using errcode='22023',message='Selected orders must belong to the same customer.'; end if;
  if v_existing_count=1 then
    update public.delivery_batches set expected_delivery_date=case when v_has_food then p_expected_delivery_date else null end,delivery_window_start=case when v_has_food then p_delivery_window_start else null end,delivery_window_end=case when v_has_food then p_delivery_window_end else null end,delivery_note=nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),updated_at=now() where id=v_batch_id;
    update public.orders o set expected_delivery_date=case when exists(select 1 from public.order_items oi join public.products p on p.id=oi.product_id left join public.categories c on c.id=p.category_id where oi.order_id=o.id and (coalesce(c.name,'') ilike '%food%' or coalesce(c.name,'') ilike '%grocery%' or p.food_product_type is not null)) then p_expected_delivery_date else null end,
      delivery_window_start=case when exists(select 1 from public.order_items oi join public.products p on p.id=oi.product_id left join public.categories c on c.id=p.category_id where oi.order_id=o.id and (coalesce(c.name,'') ilike '%food%' or coalesce(c.name,'') ilike '%grocery%' or p.food_product_type is not null)) then p_delivery_window_start else null end,
      delivery_window_end=case when exists(select 1 from public.order_items oi join public.products p on p.id=oi.product_id left join public.categories c on c.id=p.category_id where oi.order_id=o.id and (coalesce(c.name,'') ilike '%food%' or coalesce(c.name,'') ilike '%grocery%' or p.food_product_type is not null)) then p_delivery_window_end else null end,
      delivery_note=nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),delivery_timing_confirmed_at=case when exists(select 1 from public.order_items oi join public.products p on p.id=oi.product_id left join public.categories c on c.id=p.category_id where oi.order_id=o.id and (coalesce(c.name,'') ilike '%food%' or coalesce(c.name,'') ilike '%grocery%' or p.food_product_type is not null)) then now() else null end,
      delivery_timing_confirmed_by=case when exists(select 1 from public.order_items oi join public.products p on p.id=oi.product_id left join public.categories c on c.id=p.category_id where oi.order_id=o.id and (coalesce(c.name,'') ilike '%food%' or coalesce(c.name,'') ilike '%grocery%' or p.food_product_type is not null)) then auth.uid() else null end,updated_at=now()
    where o.id in (select order_id from public.delivery_batch_orders where batch_id=v_batch_id);
  end if;
  for v_id in select unnest(p_order_ids) loop
    select * into v_order from public.orders where id=v_id for update;
    if not exists(select 1 from public.delivery_batch_orders where batch_id=v_batch_id and order_id=v_id) then
      v_is_first:=(v_existing_count=0 and v_id=p_order_ids[1]);
      update public.orders set delivery_fee=case when v_is_first then v_fee else 0 end where id=v_id;
      insert into public.delivery_batch_orders(batch_id,order_id,fee_allocated) values(v_batch_id,v_id,case when v_is_first then v_fee else 0 end);
    end if;
    select exists(select 1 from public.order_items oi join public.products p on p.id=oi.product_id left join public.categories c on c.id=p.category_id where oi.order_id=v_id and (coalesce(c.name,'') ilike '%food%' or coalesce(c.name,'') ilike '%grocery%' or p.food_product_type is not null)) into v_order_has_food;
    update public.orders set expected_delivery_date=case when v_order_has_food then p_expected_delivery_date else null end,delivery_window_start=case when v_order_has_food then p_delivery_window_start else null end,delivery_window_end=case when v_order_has_food then p_delivery_window_end else null end,
      delivery_note=nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),delivery_timing_confirmed_at=case when v_order_has_food then now() else null end,delivery_timing_confirmed_by=case when v_order_has_food then auth.uid() else null end,
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
;
