-- Only surface orders/batches that can safely be assigned to a driver.
create or replace function public.admin_list_assignable_delivery_batches()
returns table(batch_id uuid,batch_number text,customer_id uuid,customer_name text,customer_phone text,order_count bigint,delivery_fee numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query
 select b.id,b.batch_number,b.customer_id,coalesce(min(o.customer_name),'Customer')::text,coalesce(b.customer_phone,''),count(*)::bigint,b.delivery_fee
 from public.delivery_batches b join public.delivery_batch_orders bo on bo.batch_id=b.id join public.orders o on o.id=bo.order_id
 where b.customer_id is not null and b.status='scheduled'
 group by b.id,b.batch_number,b.customer_id,b.customer_phone,b.delivery_fee
 having bool_and(o.order_status='confirmed'::public.order_status) and count(distinct o.shipping_address_snapshot)=1
   and not exists(select 1 from public.delivery_batch_orders bo2 join public.orders o2 on o2.id=bo2.order_id join public.order_items oi on oi.order_id=o2.id
     where bo2.batch_id=b.id and oi.delivery_status<>'delivered' and not exists(select 1 from public.delivery_batch_items bi where bi.batch_id=b.id and bi.order_item_id=oi.id))
   and not exists(select 1 from public.delivery_batch_orders bo2 join public.orders o2 on o2.id=bo2.order_id join public.order_items oi on oi.order_id=o2.id
     where bo2.batch_id=b.id and oi.delivery_status<>'delivered' and oi.seller_id is not null
       and not exists(select 1 from public.vendor_order_pickups vp where vp.order_id=oi.order_id and vp.seller_id=oi.seller_id and vp.status='picked_up'))
   and not exists(select 1 from public.delivery_batch_orders bo2 join public.driver_assignments a on a.order_id=bo2.order_id
     where bo2.batch_id=b.id and a.status in ('assigned','picked_up'))
 order by max(b.created_at) desc limit 200;
end;
$$;

create or replace function public.admin_list_assignable_driver_orders()
returns table(id uuid,order_number text,customer_name text,customer_phone text,order_status public.order_status,created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query
 select o.id,o.order_number::text,o.customer_name::text,o.customer_phone::text,o.order_status,o.created_at
 from public.orders o where o.order_status='confirmed'::public.order_status
 and not exists(select 1 from public.driver_assignments a where a.order_id=o.id and a.status in ('assigned','picked_up','delivered'))
 and not exists(select 1 from public.delivery_batch_orders bo join public.delivery_batches b on b.id=bo.batch_id where bo.order_id=o.id and b.status='scheduled')
 and exists(select 1 from public.order_items oi where oi.order_id=o.id and oi.delivery_status<>'delivered')
 and not exists(select 1 from public.order_items oi where oi.order_id=o.id and oi.delivery_status<>'delivered' and (
   (oi.seller_id is null and oi.delivery_status<>'ready')
   or (oi.seller_id is not null and not exists(select 1 from public.vendor_order_pickups vp where vp.order_id=oi.order_id and vp.seller_id=oi.seller_id and vp.status='picked_up'))
 ))
 order by o.created_at desc limit 250;
end;
$$;