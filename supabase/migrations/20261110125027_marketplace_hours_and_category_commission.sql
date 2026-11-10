
-- Add configurable marketplace opening hours and vendor commissions.
alter table public.store_settings
  add column if not exists marketplace_hours jsonb not null default '{
    "monday":{"enabled":true,"open":"07:00","close":"00:00","close_day_offset":1},
    "tuesday":{"enabled":true,"open":"07:00","close":"00:00","close_day_offset":1},
    "wednesday":{"enabled":true,"open":"07:00","close":"00:00","close_day_offset":1},
    "thursday":{"enabled":true,"open":"07:00","close":"00:00","close_day_offset":1},
    "friday":{"enabled":true,"open":"07:00","close":"00:00","close_day_offset":1},
    "saturday":{"enabled":true,"open":"07:00","close":"00:00","close_day_offset":1},
    "sunday":{"enabled":true,"open":"07:00","close":"03:00","close_day_offset":1}
  }'::jsonb;

alter table public.products
  add column if not exists vendor_base_price numeric(12,2),
  add column if not exists commission_percent numeric(6,2) not null default 0,
  add column if not exists commission_amount numeric(12,2) not null default 0;

update public.products
set vendor_base_price=price, commission_percent=0, commission_amount=0
where vendor_base_price is null;

alter table public.products
  alter column vendor_base_price set not null,
  add constraint products_vendor_base_price_nonnegative check (vendor_base_price>=0),
  add constraint products_commission_percent_range check (commission_percent between 0 and 100),
  add constraint products_commission_amount_nonnegative check (commission_amount>=0);

create table if not exists public.commission_settings (
  singleton boolean primary key default true check (singleton),
  default_percent numeric(6,2) not null default 0 check (default_percent between 0 and 100),
  category_rates jsonb not null default '{}'::jsonb check (jsonb_typeof(category_rates)='object'),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);
insert into public.commission_settings(singleton,default_percent,category_rates)
values(true,0,'{}'::jsonb) on conflict(singleton) do nothing;
alter table public.commission_settings enable row level security;
revoke all on public.commission_settings from anon,authenticated;

create or replace function public.admin_get_commission_settings()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare result_row public.commission_settings;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception using errcode='42501',message='JTBazar authenticator verification is required.';
  end if;
  if not private.has_role('admin'::public.app_role) then
    raise exception using errcode='42501',message='Administrator access is required.';
  end if;
  select * into result_row from public.commission_settings where singleton=true;
  return jsonb_build_object('default_percent',result_row.default_percent,'category_rates',result_row.category_rates,'updated_at',result_row.updated_at);
end;
$$;

create or replace function public.admin_update_commission_settings(p_default_percent numeric,p_category_rates jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare item record; saved public.commission_settings; rate numeric;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception using errcode='42501',message='JTBazar authenticator verification is required.';
  end if;
  if not private.has_role('admin'::public.app_role) then
    raise exception using errcode='42501',message='Administrator access is required.';
  end if;
  if p_default_percent is null or p_default_percent<0 or p_default_percent>100
     or p_category_rates is null or jsonb_typeof(p_category_rates)<>'object' then
    raise exception using errcode='22023',message='Commission settings are invalid.';
  end if;
  for item in select key,value from jsonb_each(p_category_rates) loop
    if item.key !~* '^[0-9a-f-]{36}$' or jsonb_typeof(item.value) not in ('number','string') then
      raise exception using errcode='22023',message='A category commission entry is invalid.';
    end if;
    rate:=(item.value #>> '{}')::numeric;
    if rate<0 or rate>100 then raise exception using errcode='22023',message='Category commission must be between 0 and 100 percent.'; end if;
    if not exists(select 1 from public.categories c where c.id::text=item.key) then
      raise exception using errcode='22023',message='A commission category no longer exists.';
    end if;
  end loop;
  insert into public.commission_settings(singleton,default_percent,category_rates,updated_at,updated_by)
  values(true,p_default_percent,p_category_rates,now(),auth.uid())
  on conflict(singleton) do update set default_percent=excluded.default_percent,category_rates=excluded.category_rates,updated_at=now(),updated_by=auth.uid()
  returning * into saved;
  return jsonb_build_object('default_percent',saved.default_percent,'category_rates',saved.category_rates,'updated_at',saved.updated_at);
end;
$$;
revoke all on function public.admin_get_commission_settings() from public,anon;
revoke all on function public.admin_update_commission_settings(numeric,jsonb) from public,anon;
grant execute on function public.admin_get_commission_settings() to authenticated;
grant execute on function public.admin_update_commission_settings(numeric,jsonb) to authenticated;

create or replace function public.admin_update_store_settings(p_settings jsonb)
returns public.store_settings language plpgsql security definer set search_path=''
as $$
declare result_row public.store_settings;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception using errcode='42501',message='JTBazar authenticator verification is required.';
  end if;
  if not private.has_role('admin'::public.app_role) then
    raise exception using errcode='42501',message='Administrator access is required.';
  end if;
  if p_settings is null or jsonb_typeof(p_settings)<>'object' then
    raise exception using errcode='22023',message='Store settings must be an object.';
  end if;
  if p_settings ? 'marketplace_hours' and jsonb_typeof(p_settings->'marketplace_hours')<>'object' then
    raise exception using errcode='22023',message='Marketplace opening hours must be an object.';
  end if;
  update public.store_settings s set
    store_name=coalesce(nullif(btrim(p_settings->>'store_name'),''),s.store_name),
    support_email=case when p_settings ? 'support_email' then nullif(btrim(p_settings->>'support_email'),'') else s.support_email end,
    support_phone=case when p_settings ? 'support_phone' then nullif(btrim(p_settings->>'support_phone'),'') else s.support_phone end,
    support_whatsapp=case when p_settings ? 'support_whatsapp' then nullif(btrim(p_settings->>'support_whatsapp'),'') else s.support_whatsapp end,
    delivery_fee=case when p_settings ? 'delivery_fee' then (p_settings->>'delivery_fee')::numeric else s.delivery_fee end,
    free_delivery_enabled=case when p_settings ? 'free_delivery_enabled' then (p_settings->>'free_delivery_enabled')::boolean else s.free_delivery_enabled end,
    additional_delivery_fee=case when p_settings ? 'additional_delivery_fee' then (p_settings->>'additional_delivery_fee')::numeric else s.additional_delivery_fee end,
    cod_enabled=case when p_settings ? 'cod_enabled' then (p_settings->>'cod_enabled')::boolean else s.cod_enabled end,
    return_window_days=case when p_settings ? 'return_window_days' then (p_settings->>'return_window_days')::integer else s.return_window_days end,
    marketplace_hours=case when p_settings ? 'marketplace_hours' then p_settings->'marketplace_hours' else s.marketplace_hours end
  where s.id='default' returning * into result_row;
  if not found then raise exception using errcode='22023',message='Store settings were not found.'; end if;
  if result_row.delivery_fee<0 or result_row.additional_delivery_fee<0 or result_row.return_window_days<0 then
    raise exception using errcode='22023',message='Fees and return window must be zero or greater.';
  end if;
  return result_row;
end;
$$;

create or replace function public.vendor_create_product(
  p_category_id uuid,p_name text,p_slug text,p_sku text,p_short_description text,p_description text,
  p_price numeric,p_supplier_cost numeric,p_fulfillment_expense numeric,p_minimum_profit numeric,
  p_track_inventory boolean default true,p_discount_percent numeric default 0,p_weight_grams integer default null,
  p_specifications jsonb default '[]'::jsonb,p_dimensions jsonb default '{}'::jsonb,p_seo_title text default null,
  p_seo_description text default null,p_initial_stock integer default 0
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare seller public.seller_profiles; product_id uuid; v_commission_percent numeric(6,2):=0;
  v_commission_amount numeric(12,2):=0; v_customer_price numeric(12,2);
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2'
     and (private.has_role('admin'::public.app_role) or private.has_verified_totp_factor()) then
    raise exception using errcode='42501',message='JTBazar authenticator verification is required.';
  end if;
  select * into seller from public.seller_profiles where user_id=(select auth.uid()) and status='approved' for share;
  if not found then raise exception using errcode='42501',message='An approved seller account is required.'; end if;
  if p_price is null or p_price<coalesce(p_supplier_cost,0)+coalesce(p_fulfillment_expense,0)+coalesce(p_minimum_profit,0) then
    raise exception using errcode='22023',message='Your base price does not meet the minimum profit rule.';
  end if;
  if coalesce(p_discount_percent,0)<0 or coalesce(p_discount_percent,0)>100 or coalesce(p_initial_stock,0)<0
     or (p_weight_grams is not null and p_weight_grams<0)
     or jsonb_typeof(coalesce(p_specifications,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_dimensions,'{}'::jsonb))<>'object' then
    raise exception using errcode='22023',message='Product specifications, dimensions, discount, weight or stock are invalid.';
  end if;
  select coalesce((s.category_rates->>p_category_id::text)::numeric,s.default_percent,0) into v_commission_percent
  from public.commission_settings s where s.singleton=true;
  v_commission_percent:=coalesce(v_commission_percent,0);
  v_commission_amount:=round(p_price*v_commission_percent/100,2);
  v_customer_price:=round(p_price+v_commission_amount,2);
  insert into public.products(seller_id,category_id,name,slug,sku,short_description,description,price,vendor_base_price,
    commission_percent,commission_amount,supplier_cost,fulfillment_expense,minimum_profit,cost_updated_at,track_inventory,
    publication_status,moderation_status,discount_percent,weight_grams,specifications,dimensions,seo_title,seo_description)
  values(seller.id,p_category_id,p_name,p_slug,nullif(p_sku,''),coalesce(p_short_description,''),coalesce(p_description,''),
    v_customer_price,p_price,v_commission_percent,v_commission_amount,p_supplier_cost,coalesce(p_fulfillment_expense,0),
    coalesce(p_minimum_profit,0),now(),coalesce(p_track_inventory,true),'draft','pending_review',coalesce(p_discount_percent,0),
    p_weight_grams,coalesce(p_specifications,'[]'::jsonb),coalesce(p_dimensions,'{}'::jsonb),
    nullif(btrim(p_seo_title),''),nullif(btrim(p_seo_description),'')) returning id into product_id;
  if coalesce(p_track_inventory,true) then
    insert into public.product_inventory(product_id,variant_id,quantity,low_stock_threshold) values(product_id,null,coalesce(p_initial_stock,0),5);
  end if;
  return product_id;
end;
$$;

create or replace function public.vendor_update_product(
  p_product_id uuid,p_category_id uuid,p_name text,p_slug text,p_sku text,p_short_description text,p_description text,
  p_price numeric,p_supplier_cost numeric,p_fulfillment_expense numeric,p_minimum_profit numeric,p_discount_percent numeric default 0,
  p_weight_grams integer default null,p_specifications jsonb default '[]'::jsonb,p_dimensions jsonb default '{}'::jsonb,
  p_seo_title text default null,p_seo_description text default null
)
returns public.products language plpgsql security definer set search_path=''
as $$
declare result_row public.products; v_commission_percent numeric(6,2):=0;
  v_commission_amount numeric(12,2):=0; v_customer_price numeric(12,2);
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2'
     and (private.has_role('admin'::public.app_role) or private.has_verified_totp_factor()) then
    raise exception using errcode='42501',message='JTBazar authenticator verification is required.';
  end if;
  if p_price is null or p_price<coalesce(p_supplier_cost,0)+coalesce(p_fulfillment_expense,0)+coalesce(p_minimum_profit,0)
     or coalesce(p_discount_percent,0)<0 or coalesce(p_discount_percent,0)>100
     or (p_weight_grams is not null and p_weight_grams<0)
     or jsonb_typeof(coalesce(p_specifications,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_dimensions,'{}'::jsonb))<>'object' then
    raise exception using errcode='22023',message='Product fields, base price, discount, weight or profit values are invalid.';
  end if;
  select coalesce((s.category_rates->>p_category_id::text)::numeric,s.default_percent,0) into v_commission_percent
  from public.commission_settings s where s.singleton=true;
  v_commission_percent:=coalesce(v_commission_percent,0);
  v_commission_amount:=round(p_price*v_commission_percent/100,2);
  v_customer_price:=round(p_price+v_commission_amount,2);
  update public.products p set category_id=p_category_id,name=p_name,slug=p_slug,sku=nullif(p_sku,''),
    short_description=coalesce(p_short_description,''),description=coalesce(p_description,''),price=v_customer_price,
    vendor_base_price=p_price,commission_percent=v_commission_percent,commission_amount=v_commission_amount,
    supplier_cost=p_supplier_cost,fulfillment_expense=coalesce(p_fulfillment_expense,0),minimum_profit=coalesce(p_minimum_profit,0),
    cost_updated_at=now(),discount_percent=coalesce(p_discount_percent,0),weight_grams=p_weight_grams,
    specifications=coalesce(p_specifications,'[]'::jsonb),dimensions=coalesce(p_dimensions,'{}'::jsonb),
    seo_title=nullif(btrim(p_seo_title),''),seo_description=nullif(btrim(p_seo_description),''),
    moderation_status='pending_review',publication_status='draft',moderation_reason=null,updated_at=now()
  where p.id=p_product_id and p.seller_id in (select s.id from public.seller_profiles s where s.user_id=(select auth.uid()) and s.status='approved')
  returning p.* into result_row;
  if not found then raise exception using errcode='42501',message='Product access was denied.'; end if;
  return result_row;
end;
$$;
