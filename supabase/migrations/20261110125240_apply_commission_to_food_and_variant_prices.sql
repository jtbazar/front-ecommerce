
-- Apply the same commission calculation to food unit prices and variant overrides.
create or replace function public.vendor_set_food_product_details(
  p_product_id uuid,p_selling_unit text,p_unit_price numeric,p_quantity_increment integer,p_minimum_quantity integer
)
returns public.products language plpgsql security definer set search_path=''
as $$
declare
  v_product public.products%rowtype;
  v_category_id uuid;
  v_is_food boolean:=false;
  v_divisor numeric;
  v_final_unit_price numeric(12,2);
  v_price_per_increment numeric(12,2);
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2'
     and (private.has_role('admin'::public.app_role) or private.has_verified_totp_factor()) then
    raise exception using errcode='42501',message='JTBazar authenticator verification is required.';
  end if;
  if (select auth.uid()) is null then raise exception using errcode='42501',message='Sign in required.'; end if;
  if p_selling_unit not in ('kg','g','l','ml','piece','dozen','pack') or p_unit_price is null or p_unit_price<0
     or p_quantity_increment is null or p_quantity_increment<1 or p_minimum_quantity is null or p_minimum_quantity<1 then
    raise exception using errcode='22023',message='Enter valid food selling unit, price, increment and minimum quantity.';
  end if;
  select p.* into v_product from public.products p join public.seller_profiles s on s.id=p.seller_id
  where p.id=p_product_id and s.user_id=(select auth.uid()) and s.status='approved' for update of p;
  if not found then raise exception using errcode='42501',message='This product is not available to your vendor account.'; end if;
  v_category_id:=v_product.category_id;
  while v_category_id is not null loop
    select c.is_food_category,c.parent_id into v_is_food,v_category_id from public.categories c where c.id=v_category_id;
    exit when v_is_food or v_category_id is null;
  end loop;
  if not v_is_food then raise exception using errcode='22023',message='Food selling units are only available for Food Category products.'; end if;
  v_divisor:=case when p_selling_unit in ('kg','l') then 1000 else 1 end;
  if p_selling_unit in ('kg','l') and (p_quantity_increment>1000 or 1000 % p_quantity_increment<>0) then
    raise exception using errcode='22023',message='For kg or litre, choose a step that divides 1000 (for example 50, 100, 250 or 500).';
  end if;
  v_final_unit_price:=round(p_unit_price*(1+coalesce(v_product.commission_percent,0)/100),2);
  v_price_per_increment:=round(v_final_unit_price*p_quantity_increment/v_divisor,2);
  update public.products set food_selling_unit=p_selling_unit,food_unit_price=v_final_unit_price,
    food_quantity_increment=p_quantity_increment,food_minimum_quantity=p_minimum_quantity,price=v_price_per_increment,
    commission_amount=round(p_unit_price*coalesce(v_product.commission_percent,0)/100,2),updated_at=now()
  where id=p_product_id returning * into v_product;
  return v_product;
end;
$$;

create or replace function public.vendor_save_product_variants(p_product_id uuid,p_variants jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_seller public.seller_profiles;
  v_product public.products;
  v_item jsonb;
  v_variant_id uuid;
  v_saved public.product_variants;
  v_label text;
  v_value text;
  v_sku text;
  v_price numeric;
  v_stock integer;
  v_sort integer:=0;
  v_result jsonb:='[]'::jsonb;
  v_keep_ids uuid[]:=array[]::uuid[];
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' and (auth.jwt()->>'aal') is distinct from 'aal2'
     and (private.has_role('admin'::public.app_role) or private.has_verified_totp_factor()) then
    raise exception using errcode='42501',message='JTBazar authenticator verification is required.';
  end if;
  if (select auth.uid()) is null then raise exception using errcode='42501',message='Sign in to manage product variants.'; end if;
  if jsonb_typeof(coalesce(p_variants,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_variants,'[]'::jsonb))>100 then
    raise exception using errcode='22023',message='Variants must be an array containing no more than 100 entries.';
  end if;
  select * into v_seller from public.seller_profiles where user_id=(select auth.uid()) and status='approved' for share;
  if not found or coalesce(v_seller.vendor_locked,false) then
    raise exception using errcode='42501',message='An unlocked, approved seller account is required.';
  end if;
  select * into v_product from public.products where id=p_product_id and seller_id=v_seller.id for update;
  if not found then raise exception using errcode='42501',message='You can only manage variants for your own products.'; end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_variants,'[]'::jsonb)) loop
    v_label:=nullif(btrim(v_item->>'option_label'),'');
    v_value:=nullif(btrim(v_item->>'option_value'),'');
    v_sku:=nullif(btrim(v_item->>'sku'),'');
    v_price:=case when nullif(v_item->>'price_override','') is null then null else (v_item->>'price_override')::numeric end;
    v_stock:=coalesce(nullif(v_item->>'quantity','')::integer,0);
    if v_label is null or char_length(v_label)>80 or v_value is null or char_length(v_value)>160
       or (v_sku is not null and char_length(v_sku)>100) or (v_price is not null and v_price<0)
       or v_stock<0 or v_stock>2147483647 then
      raise exception using errcode='22023',message='Each variant needs a valid option name, value, price and stock quantity.';
    end if;
    if exists(select 1 from public.product_variants pv where pv.product_id=p_product_id
      and lower(pv.option_label)=lower(v_label) and lower(pv.option_value)=lower(v_value)
      and pv.id<>coalesce(nullif(v_item->>'id','')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)) then
      raise exception using errcode='23505',message='Duplicate variant option and value. Each variant must be unique.';
    end if;
    if v_price is not null then v_price:=round(v_price*(1+coalesce(v_product.commission_percent,0)/100),2); end if;
    if nullif(v_item->>'id','') is not null then
      v_variant_id:=(v_item->>'id')::uuid;
      update public.product_variants set option_label=v_label,option_value=v_value,sku=v_sku,price_override=v_price,
        attributes=case when jsonb_typeof(v_item->'attributes')='object' then v_item->'attributes' else '{}'::jsonb end,
        is_active=true,sort_order=v_sort,updated_at=now()
      where id=v_variant_id and product_id=p_product_id returning * into v_saved;
      if not found then raise exception using errcode='42501',message='A selected variant does not belong to this product.'; end if;
    else
      insert into public.product_variants(product_id,option_label,option_value,sku,price_override,attributes,is_active,sort_order)
      values(p_product_id,v_label,v_value,v_sku,v_price,
        case when jsonb_typeof(v_item->'attributes')='object' then v_item->'attributes' else '{}'::jsonb end,true,v_sort)
      returning * into v_saved;
    end if;
    v_keep_ids:=array_append(v_keep_ids,v_saved.id);
    select id into v_variant_id from public.product_inventory where product_id=p_product_id and variant_id=v_saved.id limit 1;
    if v_variant_id is null then
      insert into public.product_inventory(product_id,variant_id,quantity,low_stock_threshold) values(p_product_id,v_saved.id,v_stock,5);
    else
      update public.product_inventory set quantity=v_stock,updated_at=now() where id=v_variant_id;
    end if;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('id',v_saved.id,'product_id',v_saved.product_id,
      'option_label',v_saved.option_label,'option_value',v_saved.option_value,'sku',v_saved.sku,
      'price_override',v_saved.price_override,'attributes',v_saved.attributes,'is_active',v_saved.is_active,'sort_order',v_saved.sort_order));
    v_sort:=v_sort+1;
    v_variant_id:=null;
  end loop;
  delete from public.product_variants pv where pv.product_id=p_product_id and not (pv.id=any(v_keep_ids));
  if cardinality(v_keep_ids)>0 then
    delete from public.product_inventory where product_id=p_product_id and variant_id is null;
    update public.products set track_inventory=true,publication_status='draft',moderation_status='pending_review',
      moderation_reason=null,updated_at=now() where id=p_product_id;
  else
    if not exists(select 1 from public.product_inventory where product_id=p_product_id and variant_id is null) then
      insert into public.product_inventory(product_id,variant_id,quantity,low_stock_threshold) values(p_product_id,null,0,5);
    end if;
  end if;
  return v_result;
end;
$$;
