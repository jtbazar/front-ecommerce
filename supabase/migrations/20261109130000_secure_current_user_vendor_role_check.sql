-- Keep user_roles inaccessible to direct client SELECT. The mobile app and other
-- authenticated clients can ask only whether the current JWT user has the vendor role.
create or replace function public.current_user_is_vendor()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'vendor'
  );
$$;

revoke all on function public.current_user_is_vendor() from public, anon;
grant execute on function public.current_user_is_vendor() to authenticated;
