-- Keep product campaigns website-only without changing Android checkout callers.
-- Website checkout uses the new overload with p_platform='website'; the existing
-- 11-argument place_order overload remains the legacy path for the Android app.
create or replace function public.apply_best_product_campaign_price()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_items jsonb; v_product public.products%rowtype; v_base numeric(12,2);
  v_best_rate numeric(8,6):=0; v_bogo_rate numeric(8,6):=0; v_free_qty integer:=0;
  v_campaign record; v_bundle_item record; v_bundle_rate numeric(8,6);
  v_bundle_sets integer; v_bundle_sum numeric(14,2); v_bundle_wins boolean;
  v_item_rate numeric(8,6); v_final_total numeric(14,2);
  v_applied_type text:='none'; v_applied_campaign uuid:=null;
begin
  if current_setting('jtbazar.checkout_platform',true) is distinct from 'website' then return new; end if;
  v_items:=nullif(pg_catalog.current_setting('jtbazar.checkout_items',true),'')::jsonb;
  if v_items is null then return new; end if;
  select * into v_product from public.products p where p.id=new.product_id;
  if not found then return new; end if;
  v_base:=new.unit_price;
  select greatest(coalesce(v_product.discount_percent,0),coalesce(max(c.discount_percent),0))/100.0
  into v_best_rate from public.product_campaign_items ci join public.product_campaigns c on c.id=ci.campaign_id
  where ci.product_id=new.product_id and c.status='active' and c.campaign_type in ('flash_sale','seasonal','custom')
    and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>now());
  for v_campaign in
    select c.id,c.buy_quantity,c.get_quantity from public.product_campaign_items ci
    join public.product_campaigns c on c.id=ci.campaign_id
    where ci.product_id=new.product_id and c.status='active' and c.campaign_type='bogo'
      and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>now())
  loop
    v_free_qty:=(new.quantity/(v_campaign.buy_quantity+v_campaign.get_quantity))*v_campaign.get_quantity
      + greatest(0,(new.quantity%(v_campaign.buy_quantity+v_campaign.get_quantity))-v_campaign.buy_quantity);
    if v_free_qty::numeric/greatest(new.quantity,1)>v_bogo_rate then
      v_bogo_rate:=v_free_qty::numeric/greatest(new.quantity,1);
      if v_free_qty>0 then v_applied_type:='bogo'; v_applied_campaign:=v_campaign.id; end if;
    end if;
  end loop;
  if v_bogo_rate>v_best_rate then v_best_rate:=v_bogo_rate;
  elsif v_best_rate>0 then v_applied_type:='percentage'; v_applied_campaign:=null; end if;

  for v_campaign in
    select c.id,c.bundle_price from public.product_campaigns c
    where c.status='active' and c.campaign_type='bundle' and c.bundle_price is not null
      and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>now())
      and not exists(select x.product_id from pg_catalog.jsonb_to_recordset(v_items) x(product_id uuid,variant_id uuid,quantity integer)
        join public.product_campaign_items ci on ci.product_id=x.product_id where ci.campaign_id=c.id
        group by x.product_id having count(*)>1)
      and exists(select 1 from public.product_campaign_items ci where ci.campaign_id=c.id and ci.product_id=new.product_id)
      and not exists(select 1 from public.product_campaign_items ci where ci.campaign_id=c.id
        and not exists(select 1 from pg_catalog.jsonb_to_recordset(v_items) x(product_id uuid,variant_id uuid,quantity integer) where x.product_id=ci.product_id))
  loop
    select min(qty),sum(base_price) into v_bundle_sets,v_bundle_sum from (
      select ci.product_id,sum(x.quantity)::integer qty,
        coalesce((select coalesce(v.price_override,p.price) from pg_catalog.jsonb_to_recordset(v_items) x2(product_id uuid,variant_id uuid,quantity integer)
          left join public.product_variants v on v.id=x2.variant_id and v.product_id=x2.product_id
          where x2.product_id=ci.product_id order by x2.variant_id nulls first limit 1),p.price)::numeric(12,2) base_price
      from public.product_campaign_items ci join public.products p on p.id=ci.product_id
      join pg_catalog.jsonb_to_recordset(v_items) x(product_id uuid,variant_id uuid,quantity integer) on x.product_id=ci.product_id
      where ci.campaign_id=v_campaign.id group by ci.product_id,p.price
    ) bundle_lines;
    if coalesce(v_bundle_sum,0)<=0 or coalesce(v_bundle_sets,0)<1 then continue; end if;
    v_bundle_rate:=greatest(0,least(1,1-(v_campaign.bundle_price/v_bundle_sum)));
    v_bundle_wins:=v_bundle_rate>0;
    for v_bundle_item in
      select ci.product_id,sum(x.quantity)::integer quantity,p.price::numeric(12,2) base_price,p.discount_percent
      from public.product_campaign_items ci join public.products p on p.id=ci.product_id
      join pg_catalog.jsonb_to_recordset(v_items) x(product_id uuid,variant_id uuid,quantity integer) on x.product_id=ci.product_id
      where ci.campaign_id=v_campaign.id group by ci.product_id,p.price,p.discount_percent
    loop
      v_item_rate:=coalesce(v_bundle_item.discount_percent,0)/100.0;
      select greatest(v_item_rate,coalesce(max(c.discount_percent),0)/100.0) into v_item_rate
      from public.product_campaign_items ci join public.product_campaigns c on c.id=ci.campaign_id
      where ci.product_id=v_bundle_item.product_id and c.status='active'
        and c.campaign_type in ('flash_sale','seasonal','custom')
        and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>now());
      select greatest(v_item_rate,coalesce(max(
        (((v_bundle_item.quantity/(c.buy_quantity+c.get_quantity))*c.get_quantity
          + greatest(0,(v_bundle_item.quantity%(c.buy_quantity+c.get_quantity))-c.buy_quantity))::numeric
          / greatest(v_bundle_item.quantity,1))
      ),0)) into v_item_rate
      from public.product_campaign_items ci join public.product_campaigns c on c.id=ci.campaign_id
      where ci.product_id=v_bundle_item.product_id and c.status='active' and c.campaign_type='bogo'
        and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>now());
      if v_bundle_rate<=v_item_rate then v_bundle_wins:=false; exit; end if;
    end loop;
    if v_bundle_wins then
      v_final_total:=(least(new.quantity,v_bundle_sets)*v_base*(1-v_bundle_rate))
        +(greatest(0,new.quantity-v_bundle_sets)*v_base*(1-v_best_rate));
      if v_final_total<v_base*new.quantity*(1-v_best_rate) then
        new.unit_price:=round(v_final_total/new.quantity,2);
        v_applied_type:='bundle'; v_applied_campaign:=v_campaign.id;
        v_best_rate:=1-(v_final_total/(v_base*new.quantity));
      end if;
    end if;
  end loop;
  if v_applied_type<>'bundle' then
    if v_bogo_rate>v_best_rate then v_best_rate:=v_bogo_rate; end if;
    new.unit_price:=round(v_base*(1-v_best_rate),2);
  end if;
  new.product_snapshot:=coalesce(new.product_snapshot,'{}'::jsonb)||jsonb_build_object(
    'campaign_original_unit_price',v_base,'campaign_discount_percent',round(v_best_rate*100,2),
    'campaign_discount_type',v_applied_type,'campaign_id',v_applied_campaign);
  return new;
end;
$$;

create or replace function public.place_order(
  p_customer_name text,p_customer_phone text,p_customer_email text,p_shipping_address jsonb,
  p_items jsonb,p_idempotency_key text,p_platform text,p_customer_note text default null,
  p_delivery_lat numeric default null,p_delivery_lng numeric default null,
  p_delivery_location_name text default null,p_delivery_location_captured_at timestamptz default null
)
returns table(order_id uuid,order_number text,subtotal numeric,delivery_fee numeric,total numeric)
language plpgsql security invoker set search_path=''
as $$
begin
  if p_platform is distinct from 'website' then
    raise exception using errcode='22023',message='This checkout endpoint is reserved for the website.';
  end if;
  perform pg_catalog.set_config('jtbazar.checkout_platform','website',true);
  return query select * from public.place_order(
    p_customer_name,p_customer_phone,p_customer_email,p_shipping_address,p_items,
    p_idempotency_key,p_customer_note,p_delivery_lat,p_delivery_lng,
    p_delivery_location_name,p_delivery_location_captured_at
  );
end;
$$;
revoke all on function public.place_order(text,text,text,jsonb,jsonb,text,text,text,numeric,numeric,text,timestamp with time zone) from public,anon;
grant execute on function public.place_order(text,text,text,jsonb,jsonb,text,text,text,numeric,numeric,text,timestamp with time zone) to authenticated,service_role;
