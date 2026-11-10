-- Product-linked campaigns for website-only Campaign Manager.
-- Admins manage campaign records; storefront visitors can read active campaigns only.

begin;

create table if not exists public.product_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  campaign_type text not null check (campaign_type in ('flash_sale','bogo','bundle','seasonal','custom')),
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  display_title text not null check (char_length(btrim(display_title)) between 2 and 120),
  description text,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 90),
  buy_quantity integer not null default 1 check (buy_quantity between 1 and 99),
  get_quantity integer not null default 1 check (get_quantity between 1 and 99),
  bundle_price numeric(12,2) check (bundle_price is null or bundle_price >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at),
  check ((campaign_type <> 'bundle') or bundle_price is not null)
);

create table if not exists public.product_campaign_items (
  campaign_id uuid not null references public.product_campaigns(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_id, product_id)
);

create index if not exists product_campaigns_active_window_idx on public.product_campaigns(status, starts_at, ends_at);
create index if not exists product_campaign_items_product_idx on public.product_campaign_items(product_id);

alter table public.product_campaigns enable row level security;
alter table public.product_campaign_items enable row level security;
revoke all on public.product_campaigns from anon, authenticated;
revoke all on public.product_campaign_items from anon, authenticated;
grant select on public.product_campaigns, public.product_campaign_items to anon, authenticated;
grant insert, update, delete on public.product_campaigns, public.product_campaign_items to authenticated;
grant all on public.product_campaigns, public.product_campaign_items to service_role;

create policy product_campaigns_admin_manage on public.product_campaigns for all to authenticated
  using (private.has_role('admin'::public.app_role))
  with check (private.has_role('admin'::public.app_role));
create policy product_campaign_items_admin_manage on public.product_campaign_items for all to authenticated
  using (private.has_role('admin'::public.app_role))
  with check (private.has_role('admin'::public.app_role));

create policy product_campaigns_public_active_read on public.product_campaigns for select to anon, authenticated
  using (status = 'active' and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy product_campaign_items_public_active_read on public.product_campaign_items for select to anon, authenticated
  using (exists (select 1 from public.product_campaigns c where c.id = product_campaign_items.campaign_id
    and c.status = 'active' and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now())));

create or replace function public.list_active_product_campaigns()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'campaign_type', c.campaign_type,
    'display_title', c.display_title, 'description', c.description,
    'discount_percent', c.discount_percent, 'buy_quantity', c.buy_quantity,
    'get_quantity', c.get_quantity, 'bundle_price', c.bundle_price,
    'starts_at', c.starts_at, 'ends_at', c.ends_at,
    'product_ids', coalesce((select jsonb_agg(ci.product_id order by ci.product_id)
      from public.product_campaign_items ci where ci.campaign_id = c.id), '[]'::jsonb)
  ) order by c.starts_at nulls first, c.created_at desc), '[]'::jsonb)
  from public.product_campaigns c
  where c.status = 'active' and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at is null or c.ends_at > now());
$$;
revoke all on function public.list_active_product_campaigns() from public;
grant execute on function public.list_active_product_campaigns() to anon, authenticated;

commit;
