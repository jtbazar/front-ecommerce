-- Central cross-platform campaign controls for website and Android app.
alter table public.promotions
  add column if not exists target_platform text not null default 'both'
    check (target_platform in ('website','android','both')),
  add column if not exists campaign_type text not null default 'banner'
    check (campaign_type in ('banner','popup')),
  add column if not exists show_on_launch boolean not null default false,
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz;

create index if not exists promotions_public_campaign_idx
  on public.promotions (status, target_platform, campaign_type, display_position, priority desc);

comment on column public.promotions.target_platform is 'Where campaign is rendered: website, android, or both.';
comment on column public.promotions.campaign_type is 'Banner placement or launch popup.';
comment on column public.promotions.show_on_launch is 'Show popup on a fresh app launch or website session.';
