-- Driver assignment lifecycle: audit trail, admin cancellation and re-assignable queue.
create table if not exists public.driver_assignment_history (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  order_id uuid not null,
  driver_user_id uuid not null,
  assigned_by uuid,
  event_type text not null check (event_type in ('assigned','reassigned','cancelled','picked_up','delivered')),
  assignment_status text not null,
  occurred_at timestamptz not null default now()
);
create index if not exists driver_assignment_history_order_idx on public.driver_assignment_history(order_id, occurred_at desc);
create index if not exists driver_assignment_history_driver_idx on public.driver_assignment_history(driver_user_id, occurred_at desc);
alter table public.driver_assignment_history enable row level security;
drop policy if exists "Admins can read driver assignment history" on public.driver_assignment_history;
create policy "Admins can read driver assignment history" on public.driver_assignment_history for select to authenticated using (private.has_role('admin'::public.app_role));
revoke all on public.driver_assignment_history from anon, authenticated;
grant select on public.driver_assignment_history to authenticated;

create or replace function public.log_driver_assignment_history()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare v_event text;
begin
  if tg_op = 'INSERT' then v_event := 'assigned';
  elsif new.status is distinct from old.status then
    v_event := case new.status when 'cancelled' then 'cancelled' when 'picked_up' then 'picked_up' when 'delivered' then 'delivered' else 'reassigned' end;
  elsif new.driver_user_id is distinct from old.driver_user_id then v_event := 'reassigned';
  else return new; end if;
  insert into public.driver_assignment_history(assignment_id,order_id,driver_user_id,assigned_by,event_type,assignment_status)
  values(new.id,new.order_id,new.driver_user_id,new.assigned_by,v_event,new.status);
  return new;
end;
$function$;
drop trigger if exists trg_log_driver_assignment_history on public.driver_assignments;
create trigger trg_log_driver_assignment_history after insert or update on public.driver_assignments for each row execute function public.log_driver_assignment_history();

create or replace function public.admin_assign_driver_to_order(p_order_id uuid,p_driver_user_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare v_assignment_id uuid; v_existing_status text;
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 if not exists(select 1 from public.customer_driver_access a join public.driver_applications d on d.user_id=a.user_id where a.user_id=p_driver_user_id and a.enabled=true and d.status='approved') then
   raise exception 'Driver is not approved or driver access is disabled' using errcode='42501';
 end if;
 if not exists(select 1 from public.orders o where o.id=p_order_id and o.order_status not in ('cancelled'::public.order_status,'delivered'::public.order_status)) then
   raise exception 'Order is cancelled, delivered, or unavailable' using errcode='P0002';
 end if;
 select id,status into v_assignment_id,v_existing_status from public.driver_assignments where order_id=p_order_id for update;
 if v_assignment_id is not null and v_existing_status in ('assigned','picked_up') then
   raise exception 'This order already has an active driver assignment. Cancel it before assigning again' using errcode='23505';
 end if;
 if v_assignment_id is null then
   insert into public.driver_assignments(order_id,driver_user_id,assigned_by) values(p_order_id,p_driver_user_id,auth.uid()) returning id into v_assignment_id;
 else
   update public.driver_assignments set driver_user_id=p_driver_user_id,assigned_by=auth.uid(),assigned_at=now(),picked_up_at=null,delivered_at=null,status='assigned' where id=v_assignment_id;
 end if;
 return v_assignment_id;
end;
$function$;

create or replace function public.admin_cancel_driver_assignment(p_assignment_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 update public.driver_assignments set status='cancelled' where id=p_assignment_id and status in ('assigned','picked_up');
 if not found then raise exception 'Active assignment not found or already completed' using errcode='P0002'; end if;
end;
$function$;

create or replace function public.admin_list_driver_assignments()
returns table(assignment_id uuid,order_id uuid,order_number text,customer_name text,driver_user_id uuid,driver_name text,driver_phone text,assignment_status text,assigned_at timestamptz,picked_up_at timestamptz,delivered_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $function$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query select a.id,a.order_id,o.order_number::text,o.customer_name::text,a.driver_user_id,coalesce(d.full_name::text,''),coalesce(d.phone::text,''),a.status,a.assigned_at,a.picked_up_at,a.delivered_at
 from public.driver_assignments a join public.orders o on o.id=a.order_id left join public.driver_applications d on d.user_id=a.driver_user_id
 order by a.assigned_at desc limit 300;
end;
$function$;

create or replace function public.admin_list_assignable_driver_orders()
returns table(id uuid,order_number text,customer_name text,customer_phone text,order_status public.order_status,created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $function$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query select o.id,o.order_number::text,o.customer_name::text,o.customer_phone::text,o.order_status,o.created_at from public.orders o
 where o.order_status not in ('delivered'::public.order_status,'cancelled'::public.order_status)
 and not exists(select 1 from public.driver_assignments a where a.order_id=o.id and a.status in ('assigned','picked_up'))
 order by o.created_at desc limit 250;
end;
$function$;
revoke all on function public.admin_cancel_driver_assignment(uuid) from public,anon;
revoke all on function public.admin_list_driver_assignments() from public,anon;
grant execute on function public.admin_cancel_driver_assignment(uuid) to authenticated;
grant execute on function public.admin_list_driver_assignments() to authenticated;
