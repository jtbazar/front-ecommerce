-- Prevent vendor-owned order items from entering a delivery batch before JTBazar has collected them.
create or replace function private.guard_vendor_pickup_before_delivery_batch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_seller_id uuid;
begin
  select oi.seller_id
    into v_seller_id
  from public.order_items oi
  where oi.id = new.order_item_id;

  if not found then
    raise exception 'Order item was not found.' using errcode = '23503';
  end if;

  if v_seller_id is not null and not exists (
    select 1
    from public.vendor_order_pickups vp
    where vp.order_id = (select oi.order_id from public.order_items oi where oi.id = new.order_item_id)
      and vp.seller_id = v_seller_id
      and vp.status = 'picked_up'
  ) then
    raise exception 'Vendor product must be collected by JTBazar before it can be scheduled for customer delivery.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists delivery_batch_items_require_vendor_pickup on public.delivery_batch_items;
create trigger delivery_batch_items_require_vendor_pickup
before insert on public.delivery_batch_items
for each row
execute function private.guard_vendor_pickup_before_delivery_batch();

-- Once JTBazar collects a vendor order, mark the vendor fulfilment leg as shipped
-- so the vendor no longer sees the collected order as pending.
create or replace function private.sync_vendor_pickup_status_to_order_items()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'picked_up' and old.status is distinct from new.status then
    update public.order_items
       set vendor_fulfillment_status = 'shipped',
           vendor_updated_at = now()
     where order_id = new.order_id
       and seller_id = new.seller_id
       and vendor_fulfillment_status not in ('delivered', 'cancelled');
  end if;
  return new;
end;
$$;

drop trigger if exists vendor_pickup_sync_order_item_status on public.vendor_order_pickups;
create trigger vendor_pickup_sync_order_item_status
after update of status on public.vendor_order_pickups
for each row
execute function private.sync_vendor_pickup_status_to_order_items();

-- Repair only the stale status on items whose vendor pickup is already confirmed.
update public.order_items oi
   set vendor_fulfillment_status = 'shipped',
       vendor_updated_at = now()
 where oi.seller_id is not null
   and oi.vendor_fulfillment_status not in ('delivered', 'cancelled', 'shipped')
   and exists (
     select 1
     from public.vendor_order_pickups vp
     where vp.order_id = oi.order_id
       and vp.seller_id = oi.seller_id
       and vp.status = 'picked_up'
   );
