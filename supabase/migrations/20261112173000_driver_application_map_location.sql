alter table public.driver_applications
  add column if not exists current_lat double precision,
  add column if not exists current_lng double precision;

create or replace function public.driver_save_application_location(
  p_lat double precision,
  p_lng double precision,
  p_address text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if not coalesce((select a.enabled from public.customer_driver_access a where a.user_id = auth.uid()), false) then
    raise exception 'Driver access has not been enabled for this account' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Select a valid location on the map' using errcode = '22023';
  end if;
  if nullif(btrim(p_address), '') is null then
    raise exception 'Enter the address for the selected map location' using errcode = '22023';
  end if;

  update public.driver_applications
  set current_lat = p_lat,
      current_lng = p_lng,
      current_address = btrim(p_address),
      updated_at = now()
  where user_id = auth.uid()
    and status <> 'approved';

  if not found then
    raise exception 'A pending driver application was not found' using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.driver_save_application_location(double precision,double precision,text) from public, anon;
grant execute on function public.driver_save_application_location(double precision,double precision,text) to authenticated;