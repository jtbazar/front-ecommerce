create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name='jtbazar_push_webhook_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'jtbazar_push_webhook_secret','HMAC secret for signed database-to-FCM notification dispatch',null);
  end if;
end $$;

create or replace function public.verify_push_webhook(p_payload jsonb,p_signature text)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='jtbazar_push_webhook_secret' limit 1;
  if v_secret is null or p_signature is null then return false; end if;
  return encode(extensions.hmac(p_payload::text,v_secret,'sha256'),'hex')=p_signature;
end;
$$;
revoke all on function public.verify_push_webhook(jsonb,text) from public,anon,authenticated;
grant execute on function public.verify_push_webhook(jsonb,text) to service_role;

create or replace function private.dispatch_notification_push()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_payload jsonb; v_secret text; v_signature text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='jtbazar_push_webhook_secret' limit 1;
  if v_secret is null then
    raise warning 'JTBazar push webhook secret is missing; notification % remains in-app only',new.id;
    return new;
  end if;
  v_payload:=jsonb_build_object(
    'action','webhook','user_id',new.user_id,'title',new.title,'body',new.body,
    'data',jsonb_build_object('notification_id',new.id,'kind',new.kind,'audience',new.audience,'related_order_id',new.related_order_id),
    'link',case when new.related_order_id is not null then '/account' else '/' end
  );
  v_signature:=encode(extensions.hmac(v_payload::text,v_secret,'sha256'),'hex');
  perform net.http_post(
    url:='https://xrrhbnnzjqkqnqdvayjw.supabase.co/functions/v1/firebase-push-notifications',
    headers:=jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_fBu4PTDFMxgcNZ8luVkpOQ_lIIbZUHI','x-jtbazar-signature',v_signature),
    body:=v_payload
  );
  return new;
end;
$$;
drop trigger if exists notifications_dispatch_fcm_push on public.notifications;
create trigger notifications_dispatch_fcm_push after insert on public.notifications
for each row execute function private.dispatch_notification_push();

create or replace function private.notify_customers_of_active_campaign()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_body text;
begin
  if new.status <> 'active' then return new; end if;
  if tg_op='UPDATE' and old.status='active' then return new; end if;
  v_body:=coalesce(nullif(btrim(new.description),''),'A new deal is now available at JTBazar.');
  insert into public.notifications(user_id,kind,title,body)
  select ur.user_id,'store'::public.notification_kind,'New deal: '||new.display_title,v_body
  from public.user_roles ur where ur.role='customer'::public.app_role;
  return new;
end;
$$;
drop trigger if exists product_campaign_customer_push on public.product_campaigns;
create trigger product_campaign_customer_push after insert or update of status on public.product_campaigns
for each row execute function private.notify_customers_of_active_campaign();
