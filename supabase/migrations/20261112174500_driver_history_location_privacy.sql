create or replace function public.driver_list_assigned_orders()
returns table(
 assignment_id uuid, order_id uuid, order_number text, order_status public.order_status,
 customer_name text, customer_phone text, delivery_address jsonb, delivery_lat numeric,
 delivery_lng numeric, delivery_location_name text, assigned_at timestamptz,
 assignment_status text, items jsonb
)
language plpgsql stable security definer set search_path=''
as $function$
begin
 if not coalesce((select x.enabled from public.customer_driver_access x where x.user_id=auth.uid()),false) then
   raise exception 'Driver access is disabled for this account' using errcode='42501';
 end if;
 if not exists(select 1 from public.driver_applications d where d.user_id=auth.uid() and d.status='approved') then
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
                  from public.order_items i where i.order_id=o.id),'[]'::jsonb)
 from public.driver_assignments a join public.orders o on o.id=a.order_id
 where a.driver_user_id=auth.uid() and a.status in ('assigned','picked_up','delivered','cancelled')
 order by case when a.status in ('delivered','cancelled') then 1 else 0 end, a.assigned_at desc;
end;
$function$;