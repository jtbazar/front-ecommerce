-- Complete driver application verification and optional company label.
-- Sensitive identity images are stored in a private bucket and are readable only by
-- the uploading applicant and authorized JTBazar admins.

alter table public.driver_applications
  add column if not exists current_address text,
  add column if not exists cnic_front_path text,
  add column if not exists cnic_back_path text,
  add column if not exists vehicle_plate_image_path text,
  add column if not exists company_name text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-documents','driver-documents',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists driver_documents_owner_insert on storage.objects;
create policy driver_documents_owner_insert on storage.objects for insert to authenticated
with check (
  bucket_id='driver-documents'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists(select 1 from public.customer_driver_access a where a.user_id=(select auth.uid()) and a.enabled=true)
);

drop policy if exists driver_documents_owner_or_admin_read on storage.objects;
create policy driver_documents_owner_or_admin_read on storage.objects for select to authenticated
using (
  bucket_id='driver-documents'
  and ((storage.foldername(name))[1]=(select auth.uid())::text or (select private.has_role('admin'::public.app_role)))
);

drop policy if exists driver_documents_owner_delete on storage.objects;
create policy driver_documents_owner_delete on storage.objects for delete to authenticated
using (bucket_id='driver-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);

drop function if exists public.submit_driver_application(text,text,text);
create function public.submit_driver_application(
  p_full_name text,
  p_phone text,
  p_vehicle_type text,
  p_current_address text default null,
  p_cnic_front_path text default null,
  p_cnic_back_path text default null,
  p_vehicle_plate_image_path text default null
)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare
  v_id uuid;
  v_user_id uuid := auth.uid();
  v_paths text[] := array[p_cnic_front_path,p_cnic_back_path,p_vehicle_plate_image_path];
begin
  if v_user_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if not coalesce((select a.enabled from public.customer_driver_access a where a.user_id=v_user_id),false) then
    raise exception 'Driver access has not been enabled for this account' using errcode='42501';
  end if;
  if nullif(btrim(p_full_name),'') is null or nullif(btrim(p_phone),'') is null
     or lower(coalesce(nullif(btrim(p_vehicle_type),''),'')) not in ('bike','car','motorcycle') then
    raise exception 'Enter your name, phone number and a valid vehicle type (Bike or Car).' using errcode='22023';
  end if;
  if nullif(btrim(p_current_address),'') is null or p_cnic_front_path is null
     or p_cnic_back_path is null or p_vehicle_plate_image_path is null then
    raise exception 'Current address, CNIC front and back images, and vehicle rear number-plate image are required.' using errcode='22023';
  end if;
  if (select count(distinct p) from unnest(v_paths) p) <> 3
     or exists (
       select 1 from unnest(v_paths) as p(path)
       where p.path not like v_user_id::text || '/%'
          or not exists (
            select 1 from storage.objects o
            where o.bucket_id='driver-documents' and o.name=p.path
              and (storage.foldername(o.name))[1]=v_user_id::text
          )
     ) then
    raise exception 'Upload all three verification images to your own driver documents folder before submitting.' using errcode='22023';
  end if;
  insert into public.driver_applications(
    user_id,full_name,phone,vehicle_type,current_address,cnic_front_path,cnic_back_path,vehicle_plate_image_path,status,admin_note,reviewed_by,reviewed_at
  ) values (
    v_user_id,btrim(p_full_name),btrim(p_phone),initcap(btrim(p_vehicle_type)),btrim(p_current_address),
    p_cnic_front_path,p_cnic_back_path,p_vehicle_plate_image_path,'pending',null,null,null
  )
  on conflict(user_id) do update set
    full_name=excluded.full_name,phone=excluded.phone,vehicle_type=excluded.vehicle_type,current_address=excluded.current_address,
    cnic_front_path=excluded.cnic_front_path,cnic_back_path=excluded.cnic_back_path,vehicle_plate_image_path=excluded.vehicle_plate_image_path,
    status='pending',admin_note=null,reviewed_by=null,reviewed_at=null,updated_at=now()
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.submit_driver_application(text,text,text,text,text,text,text) from public,anon;
grant execute on function public.submit_driver_application(text,text,text,text,text,text,text) to authenticated;

drop function if exists public.admin_list_driver_applications();
create function public.admin_list_driver_applications()
returns table(id uuid,user_id uuid,full_name text,phone text,vehicle_type text,status text,admin_note text,created_at timestamptz,current_address text,cnic_front_path text,cnic_back_path text,vehicle_plate_image_path text,company_name text)
language plpgsql stable security definer set search_path=''
as $function$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query select d.id,d.user_id,d.full_name::text,d.phone::text,d.vehicle_type::text,d.status::text,d.admin_note::text,d.created_at,
 d.current_address::text,d.cnic_front_path::text,d.cnic_back_path::text,d.vehicle_plate_image_path::text,d.company_name::text
 from public.driver_applications d order by d.created_at desc limit 200;
end;
$function$;

drop function if exists public.admin_list_approved_drivers();
create function public.admin_list_approved_drivers()
returns table(user_id uuid,full_name text,phone text,company_name text)
language plpgsql stable security definer set search_path=''
as $function$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query select d.user_id,d.full_name::text,d.phone::text,d.company_name::text
 from public.driver_applications d join public.customer_driver_access a on a.user_id=d.user_id and a.enabled=true
 where d.status='approved' order by d.full_name;
end;
$function$;

drop function if exists public.admin_list_driver_assignments();
create function public.admin_list_driver_assignments()
returns table(assignment_id uuid,order_id uuid,order_number text,customer_name text,driver_user_id uuid,driver_name text,driver_phone text,assignment_status text,assigned_at timestamptz,picked_up_at timestamptz,delivered_at timestamptz,driver_company_name text)
language plpgsql stable security definer set search_path=''
as $function$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query select a.id,a.order_id,o.order_number::text,o.customer_name::text,a.driver_user_id,
 coalesce(d.full_name::text,''),coalesce(d.phone::text,''),a.status::text,a.assigned_at,a.picked_up_at,a.delivered_at,d.company_name::text
 from public.driver_assignments a join public.orders o on o.id=a.order_id
 left join public.driver_applications d on d.user_id=a.driver_user_id order by a.assigned_at desc limit 300;
end;
$function$;

create or replace function public.admin_update_driver_company_name(p_user_id uuid,p_company_name text)
returns void language plpgsql security definer set search_path=''
as $function$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_company_name is not null and char_length(btrim(p_company_name))>160 then
   raise exception 'Company name must be 160 characters or fewer.' using errcode='22023';
 end if;
 update public.driver_applications set company_name=nullif(btrim(p_company_name),''),updated_at=now() where user_id=p_user_id;
 if not found then raise exception 'Driver application not found.' using errcode='P0002'; end if;
end;
$function$;

revoke all on function public.admin_list_driver_applications() from public,anon;
revoke all on function public.admin_list_approved_drivers() from public,anon;
revoke all on function public.admin_list_driver_assignments() from public,anon;
revoke all on function public.admin_update_driver_company_name(uuid,text) from public,anon;
grant execute on function public.admin_list_driver_applications() to authenticated;
grant execute on function public.admin_list_approved_drivers() to authenticated;
grant execute on function public.admin_list_driver_assignments() to authenticated;
grant execute on function public.admin_update_driver_company_name(uuid,text) to authenticated;
