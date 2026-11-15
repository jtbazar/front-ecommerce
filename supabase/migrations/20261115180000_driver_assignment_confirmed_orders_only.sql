-- Restrict driver assignment to confirmed orders in both the admin queue and assignment RPC.
-- Also retain the database-level customer/driver UUID self-assignment guard.
create or replace function public.admin_list_assignable_driver_orders()
returns table(id uuid, order_number text, customer_name text, customer_phone text, order_status public.order_status, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not private.has_role('admin'::public.app_role) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return query
  select o.id, o.order_number::text, o.customer_name::text, o.customer_phone::text,
         o.order_status, o.created_at
  from public.orders o
  where o.order_status = 'confirmed'::public.order_status
    and not exists (
      select 1 from public.driver_assignments a
      where a.order_id = o.id and a.status in ('assigned','picked_up')
    )
  order by o.created_at desc
  limit 250;
end;
$function$;

create or replace function public.admin_assign_driver_to_order(p_order_id uuid,p_driver_user_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare
 v_assignment_id uuid;
 v_existing_status text;
 v_customer_id uuid;
begin
 if not private.has_role('admin'::public.app_role) then
   raise exception 'Admin access required' using errcode='42501';
 end if;

 select o.customer_id
 into v_customer_id
 from public.orders o
 where o.id = p_order_id
   and o.order_status = 'confirmed'::public.order_status;

 if not found then
   raise exception 'Only confirmed orders can be assigned to a driver' using errcode='23514';
 end if;

 if v_customer_id is not null and v_customer_id = p_driver_user_id then
   raise exception 'You cannot assign an order to the same user who placed it. Please select another driver.'
     using errcode='23514';
 end if;

 if not exists(
   select 1
   from public.customer_driver_access a
   join public.driver_applications d on d.user_id = a.user_id
   where a.user_id = p_driver_user_id
     and a.enabled = true
     and d.status = 'approved'
 ) then
   raise exception 'Driver is not approved or driver access is disabled' using errcode='42501';
 end if;

 select id, status
 into v_assignment_id, v_existing_status
 from public.driver_assignments
 where order_id = p_order_id
 for update;

 if v_assignment_id is not null and v_existing_status in ('assigned', 'picked_up') then
   raise exception 'This order already has an active driver assignment. Cancel it before assigning again'
     using errcode='23505';
 end if;

 if v_assignment_id is null then
   insert into public.driver_assignments(order_id, driver_user_id, assigned_by)
   values(p_order_id, p_driver_user_id, auth.uid())
   returning id into v_assignment_id;
 else
   update public.driver_assignments
   set driver_user_id = p_driver_user_id,
       assigned_by = auth.uid(),
       assigned_at = now(),
       picked_up_at = null,
       delivered_at = null,
       status = 'assigned'
   where id = v_assignment_id;
 end if;

 return v_assignment_id;
end;
$function$;

revoke all on function public.admin_assign_driver_to_order(uuid, uuid) from public, anon;
grant execute on function public.admin_assign_driver_to_order(uuid, uuid) to authenticated;
revoke all on function public.admin_list_assignable_driver_orders() from public, anon;
grant execute on function public.admin_list_assignable_driver_orders() to authenticated;