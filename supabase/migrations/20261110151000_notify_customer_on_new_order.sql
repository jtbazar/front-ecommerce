create or replace function private.notify_customer_new_order()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.customer_id is not null then
    insert into public.notifications(user_id,kind,title,body,related_order_id)
    values(
      new.customer_id,
      'order'::public.notification_kind,
      'Order received',
      'We have received your order '||new.order_number||' and will contact you to confirm it.',
      new.id
    );
  end if;
  return new;
end;
$$;
drop trigger if exists customer_new_order_notification on public.orders;
create trigger customer_new_order_notification after insert on public.orders
for each row execute function private.notify_customer_new_order();