-- Let approved vendors preview the effective commission for a selected category.
-- Commission settings remain private; this RPC exposes only the applicable rate.
create or replace function public.vendor_get_commission_preview(p_category_id uuid)
returns numeric
language plpgsql
security definer
set search_path=''
as $$
declare
  v_rate numeric(6,2);
  v_seller public.seller_profiles;
begin
  if (select auth.uid()) is null then
    raise exception using errcode='42501',message='Sign in required.';
  end if;
  select * into v_seller from public.seller_profiles
  where user_id=(select auth.uid()) and status='approved' for share;
  if not found or coalesce(v_seller.vendor_locked,false) then
    raise exception using errcode='42501',message='An unlocked, approved seller account is required.';
  end if;
  if p_category_id is null then
    select default_percent into v_rate from public.commission_settings where singleton=true;
  else
    select coalesce((s.category_rates->>p_category_id::text)::numeric,s.default_percent,0)
    into v_rate from public.commission_settings s where s.singleton=true;
  end if;
  return coalesce(v_rate,0);
end;
$$;
revoke all on function public.vendor_get_commission_preview(uuid) from public,anon;
grant execute on function public.vendor_get_commission_preview(uuid) to authenticated;
