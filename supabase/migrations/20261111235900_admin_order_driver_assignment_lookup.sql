-- Admin-only lookup for the latest rider assignment on the currently visible Orders page.
create or replace function public.admin_list_order_driver_assignments(p_order_ids uuid[])
returns table (
  order_id uuid,
  driver_name text,
  driver_phone text,
  assignment_status text,
  assigned_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not private.has_role('admin'::public.app_role) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select distinct on (a.order_id)
    a.order_id,
    coalesce(d.full_name::text, ''),
    coalesce(d.phone::text, ''),
    a.status,
    a.assigned_at
  from public.driver_assignments a
  left join public.driver_applications d on d.user_id = a.driver_user_id
  where a.order_id = any(coalesce(p_order_ids, '{}'::uuid[]))
  order by a.order_id, a.assigned_at desc, a.id desc;
end;
$function$;

revoke all on function public.admin_list_order_driver_assignments(uuid[]) from public, anon;
grant execute on function public.admin_list_order_driver_assignments(uuid[]) to authenticated;
