-- Add server-side category filtering to platform product pagination.
drop function if exists public.admin_list_products_page(text,uuid,text,integer,integer,boolean);
create function public.admin_list_products_page(
 p_search text default '',
 p_seller_id uuid default null,
 p_moderation_status text default null,
 p_page integer default 0,
 p_page_size integer default 12,
 p_platform_only boolean default false,
 p_category_id uuid default null
) returns setof public.products
language plpgsql stable security definer set search_path=''
as $function$
declare
 term text := nullif(pg_catalog.btrim(coalesce(p_search,'')),'');
 safe_page integer := greatest(coalesce(p_page,0),0);
 safe_size integer := least(greatest(coalesce(p_page_size,12),1),50);
begin
 if (auth.jwt()->>'role') is distinct from 'service_role'
    and (auth.jwt()->>'aal') is distinct from 'aal2'
    and (private.has_role('admin'::public.app_role) or private.has_verified_totp_factor()) then
   raise exception using errcode='42501',message='JTBazar authenticator verification is required.';
 end if;
 if not private.has_role('admin'::public.app_role) then
   raise exception using errcode='42501',message='Administrator access is required.';
 end if;
 return query
 select p.* from public.products p
 where (term is null or p.name ilike '%'||term||'%' or p.sku ilike '%'||term||'%' or p.slug ilike '%'||term||'%')
 and (p_seller_id is null or p.seller_id=p_seller_id)
 and ((coalesce(p_platform_only,false) and p.seller_id is null) or (not coalesce(p_platform_only,false) and p.seller_id is not null))
 and (p_category_id is null or p.category_id=p_category_id)
 and (p_moderation_status is null or (p_moderation_status='approved' and p.moderation_status in ('approved','hidden')) or p.moderation_status=p_moderation_status)
 order by p.created_at desc limit safe_size offset (safe_page*safe_size);
end;
$function$;

drop function if exists public.admin_count_products_page(text,uuid,text,boolean);
create function public.admin_count_products_page(
 p_search text default '',
 p_seller_id uuid default null,
 p_moderation_status text default null,
 p_platform_only boolean default false,
 p_category_id uuid default null
) returns bigint
language plpgsql stable security definer set search_path=''
as $function$
declare
 term text := nullif(pg_catalog.btrim(coalesce(p_search,'')),'');
 total bigint;
begin
 if (auth.jwt()->>'role') is distinct from 'service_role'
    and (auth.jwt()->>'aal') is distinct from 'aal2'
    and (private.has_role('admin'::public.app_role) or private.has_verified_totp_factor()) then
   raise exception using errcode='42501',message='JTBazar authenticator verification is required.';
 end if;
 if not private.has_role('admin'::public.app_role) then
   raise exception using errcode='42501',message='Administrator access is required.';
 end if;
 select count(*) into total from public.products p
 where (term is null or p.name ilike '%'||term||'%' or p.sku ilike '%'||term||'%' or p.slug ilike '%'||term||'%')
 and (p_seller_id is null or p.seller_id=p_seller_id)
 and ((coalesce(p_platform_only,false) and p.seller_id is null) or (not coalesce(p_platform_only,false) and p.seller_id is not null))
 and (p_category_id is null or p.category_id=p_category_id)
 and (p_moderation_status is null or (p_moderation_status='approved' and p.moderation_status in ('approved','hidden')) or p.moderation_status=p_moderation_status);
 return total;
end;
$function$;

revoke all on function public.admin_list_products_page(text,uuid,text,integer,integer,boolean,uuid) from public,anon;
revoke all on function public.admin_count_products_page(text,uuid,text,boolean,uuid) from public,anon;
grant execute on function public.admin_list_products_page(text,uuid,text,integer,integer,boolean,uuid) to authenticated;
grant execute on function public.admin_count_products_page(text,uuid,text,boolean,uuid) to authenticated;
