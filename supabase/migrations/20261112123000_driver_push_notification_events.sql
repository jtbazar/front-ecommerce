create or replace function private.notify_driver_push_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_order_number text; v_customer_id uuid; v_changed boolean := false;
begin
  if tg_op = 'INSERT' then v_changed := true;
  else v_changed := old.status is distinct from new.status or old.driver_user_id is distinct from new.driver_user_id;
  end if;
  if not v_changed then return new; end if;
  select o.order_number, o.customer_id into v_order_number, v_customer_id
  from public.orders o where o.id = new.order_id;
  if new.status = 'assigned' then
    insert into public.notifications(user_id, kind, title, body, related_order_id)
    values (new.driver_user_id, 'order'::public.notification_kind, 'New delivery assigned',
      'Order ' || coalesce(v_order_number, '') || ' has been assigned to you. Open JTBazar Driver to view delivery details.', new.order_id);
  elsif new.status = 'picked_up' and v_customer_id is not null then
    insert into public.notifications(user_id, kind, title, body, related_order_id)
    values (v_customer_id, 'order'::public.notification_kind, 'Your order has been picked up',
      'Your order ' || coalesce(v_order_number, '') || ' has been picked up and is on its way.', new.order_id);
  end if;
  return new;
end; $$;

create or replace function private.notify_driver_application_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text; v_body text;
begin
  if old.status is not distinct from new.status then return new; end if;
  if new.status = 'approved' then
    v_title := 'Driver application approved';
    v_body := 'Your JTBazar Driver application has been approved. You can now access Driver Center.';
  elsif new.status = 'rejected' then
    v_title := 'Driver application rejected';
    v_body := 'Your JTBazar Driver application was not approved. Open the app to review the admin note.';
  elsif new.status = 'suspended' then
    v_title := 'Driver access suspended';
    v_body := 'Your JTBazar Driver access has been suspended. Contact JTBazar support if you need help.';
  else return new;
  end if;
  insert into public.notifications(user_id, kind, title, body)
  values (new.user_id, 'account'::public.notification_kind, v_title, v_body);
  return new;
end; $$;

create or replace function private.assign_notification_audience()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.audience := case
    when new.title in ('New seller application','Product listing needs review','Marketplace case opened','New seller support ticket','New customer support ticket')
      or (new.title like 'New order %' and new.title not like 'New order for %') then 'admin'
    when new.title in ('New delivery assigned','Driver application approved','Driver application rejected','Driver access suspended') then 'driver'
    when new.title like 'New order for %' or new.title like 'Order % cancelled' then 'vendor'
    else 'customer'
  end;
  return new;
end; $$;

drop trigger if exists driver_assignments_push_events on public.driver_assignments;
create trigger driver_assignments_push_events after insert or update of driver_user_id, status
on public.driver_assignments for each row execute function private.notify_driver_push_events();

drop trigger if exists driver_application_push_status on public.driver_applications;
create trigger driver_application_push_status after update of status
on public.driver_applications for each row execute function private.notify_driver_application_status();

revoke all on function private.notify_driver_push_events() from public, anon, authenticated;
revoke all on function private.notify_driver_application_status() from public, anon, authenticated;
