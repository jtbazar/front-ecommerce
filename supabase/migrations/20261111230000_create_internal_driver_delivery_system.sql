alter table public.store_settings
  add column if not exists driver_system_enabled boolean not null default false;

create table if not exists public.driver_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  phone text not null,
  vehicle_type text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  admin_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);
create table if not exists public.driver_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  driver_user_id uuid not null references auth.users(id),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  picked_up_at timestamptz,
  delivered_at timestamptz,
  status text not null default 'assigned' check (status in ('assigned','picked_up','delivered','cancelled'))
);
create table if not exists public.driver_delivery_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.driver_assignments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  driver_user_id uuid not null references auth.users(id),
  event_type text not null check (event_type in ('picked_up','delivered')),
  created_at timestamptz not null default now()
);
create index if not exists driver_applications_status_created_idx on public.driver_applications(status,created_at desc);
create index if not exists driver_assignments_driver_status_idx on public.driver_assignments(driver_user_id,status,assigned_at desc);

alter table public.driver_applications enable row level security;
alter table public.driver_assignments enable row level security;
alter table public.driver_delivery_events enable row level security;

drop policy if exists driver_applications_read_own_or_admin on public.driver_applications;
create policy driver_applications_read_own_or_admin on public.driver_applications for select to authenticated
using (user_id=(select auth.uid()) or (select private.has_role('admin'::public.app_role)));
drop policy if exists driver_applications_submit_own on public.driver_applications;
create policy driver_applications_submit_own on public.driver_applications for insert to authenticated
with check (user_id=(select auth.uid()) and status='pending' and reviewed_by is null and reviewed_at is null);
drop policy if exists driver_applications_admin_manage on public.driver_applications;
create policy driver_applications_admin_manage on public.driver_applications for all to authenticated
using ((select private.has_role('admin'::public.app_role))) with check ((select private.has_role('admin'::public.app_role)));
drop policy if exists driver_assignments_admin_read on public.driver_assignments;
create policy driver_assignments_admin_read on public.driver_assignments for select to authenticated
using ((select private.has_role('admin'::public.app_role)));
drop policy if exists driver_delivery_events_admin_read on public.driver_delivery_events;
create policy driver_delivery_events_admin_read on public.driver_delivery_events for select to authenticated
using ((select private.has_role('admin'::public.app_role)));

create or replace function public.admin_review_driver_application(p_application_id uuid,p_decision text,p_admin_note text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_decision not in ('approved','rejected','suspended') then raise exception 'Invalid driver decision' using errcode='22023'; end if;
 update public.driver_applications set status=p_decision,admin_note=nullif(btrim(p_admin_note),''),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=p_application_id;
 if not found then raise exception 'Driver application not found' using errcode='P0002'; end if;
end $$;

create or replace function public.admin_assign_driver_to_order(p_order_id uuid,p_driver_user_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_assignment_id uuid;
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 if not exists(select 1 from public.driver_applications where user_id=p_driver_user_id and status='approved') then raise exception 'Driver is not approved and active' using errcode='42501'; end if;
 if not exists(select 1 from public.orders where id=p_order_id and order_status<>'cancelled'::public.order_status) then raise exception 'Order not found or cancelled' using errcode='P0002'; end if;
 insert into public.driver_assignments(order_id,driver_user_id,assigned_by) values(p_order_id,p_driver_user_id,auth.uid())
 on conflict(order_id) do update set driver_user_id=excluded.driver_user_id,assigned_by=excluded.assigned_by,assigned_at=now(),picked_up_at=null,delivered_at=null,status='assigned'
 returning id into v_assignment_id;
 return v_assignment_id;
end $$;

create or replace function public.driver_list_assigned_orders()
returns table(assignment_id uuid,order_id uuid,order_number text,order_status public.order_status,customer_name text,customer_phone text,delivery_address jsonb,delivery_lat numeric,delivery_lng numeric,delivery_location_name text,assigned_at timestamptz,assignment_status text,items jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.driver_applications where user_id=auth.uid() and status='approved') then raise exception 'Approved active driver access required' using errcode='42501'; end if;
 return query select a.id,o.id,o.order_number,o.order_status,o.customer_name,o.customer_phone,o.shipping_address_snapshot,o.delivery_lat,o.delivery_lng,o.delivery_location_name,a.assigned_at,a.status,
 coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',i.quantity,'variant',i.variant_snapshot) order by i.created_at) from public.order_items i where i.order_id=o.id),'[]'::jsonb)
 from public.driver_assignments a join public.orders o on o.id=a.order_id
 where a.driver_user_id=auth.uid() and a.status in ('assigned','picked_up') order by a.assigned_at desc;
end $$;

create or replace function public.driver_update_delivery_status(p_assignment_id uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare v_order_id uuid; v_status text;
begin
 if p_action not in ('picked_up','delivered') then raise exception 'Invalid delivery action' using errcode='22023'; end if;
 if not exists(select 1 from public.driver_applications where user_id=auth.uid() and status='approved') then raise exception 'Approved active driver access required' using errcode='42501'; end if;
 select order_id,status into v_order_id,v_status from public.driver_assignments where id=p_assignment_id and driver_user_id=auth.uid() for update;
 if v_order_id is null then raise exception 'Assigned delivery not found' using errcode='42501'; end if;
 if v_status in ('delivered','cancelled') then raise exception 'Delivery is already closed' using errcode='22023'; end if;
 if p_action='picked_up' then
  update public.driver_assignments set status='picked_up',picked_up_at=coalesce(picked_up_at,now()) where id=p_assignment_id;
 else
  update public.driver_assignments set status='delivered',delivered_at=now() where id=p_assignment_id;
  update public.orders set order_status='delivered'::public.order_status,delivered_at=now(),updated_at=now() where id=v_order_id;
 end if;
 insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type) values(p_assignment_id,v_order_id,auth.uid(),p_action);
end $$;

revoke all on function public.admin_review_driver_application(uuid,text,text) from public,anon;
revoke all on function public.admin_assign_driver_to_order(uuid,uuid) from public,anon;
revoke all on function public.driver_list_assigned_orders() from public,anon;
revoke all on function public.driver_update_delivery_status(uuid,text) from public,anon;
grant execute on function public.admin_review_driver_application(uuid,text,text) to authenticated;
grant execute on function public.admin_assign_driver_to_order(uuid,uuid) to authenticated;
grant execute on function public.driver_list_assigned_orders() to authenticated;
grant execute on function public.driver_update_delivery_status(uuid,text) to authenticated;
