create or replace function public.admin_create_combined_driver_batch(p_order_ids uuid[])
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_batch_id uuid; v_customer_id uuid; v_phone text; v_fee numeric(12,2); v_count integer;
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_order_ids is null or cardinality(p_order_ids)<2 or cardinality(p_order_ids)>20 then raise exception 'Select between two and twenty orders to combine' using errcode='22023'; end if;
 if (select count(distinct x) from unnest(p_order_ids) x)<>cardinality(p_order_ids) then raise exception 'Duplicate orders are not allowed' using errcode='22023'; end if;
 select (array_agg(o.customer_id))[1],min(o.customer_phone),sum(o.delivery_fee),count(*)
   into v_customer_id,v_phone,v_fee,v_count
 from public.orders o where o.id=any(p_order_ids) and o.order_status='confirmed'::public.order_status;
 if v_count<>cardinality(p_order_ids) or v_customer_id is null then raise exception 'Every selected order must be confirmed and belong to a registered customer' using errcode='22023'; end if;
 if exists(select 1 from public.orders o where o.id=any(p_order_ids) and o.customer_id is distinct from v_customer_id) then raise exception 'All orders must belong to the same customer' using errcode='22023'; end if;
 if (select count(distinct o.shipping_address_snapshot) from public.orders o where o.id=any(p_order_ids))<>1 then raise exception 'All selected orders must have exactly the same delivery address' using errcode='22023'; end if;
 if exists(select 1 from public.driver_assignments a where a.order_id=any(p_order_ids) and a.status in ('assigned','picked_up')) then raise exception 'One or more orders already have an active driver assignment' using errcode='23505'; end if;
 if exists(select 1 from public.delivery_batch_orders bo join public.delivery_batches b on b.id=bo.batch_id where bo.order_id=any(p_order_ids) and b.status='scheduled') then raise exception 'One or more orders already belong to a scheduled delivery batch' using errcode='23505'; end if;
 insert into public.delivery_batches(customer_id,customer_phone,delivery_fee,status,created_by)
 values(v_customer_id,v_phone,coalesce(v_fee,0),'scheduled',auth.uid()) returning id into v_batch_id;
 insert into public.delivery_batch_orders(batch_id,order_id,fee_allocated) select v_batch_id,o.id,o.delivery_fee from public.orders o where o.id=any(p_order_ids);
 insert into public.admin_audit_logs(actor_id,action,entity,entity_id,details)
 values(auth.uid(),'INSERT','delivery_batches',v_batch_id,jsonb_build_object('order_ids',p_order_ids,'customer_id',v_customer_id,'delivery_fee_preserved',coalesce(v_fee,0),'combined_driver_route',true));
 return v_batch_id;
end;
$$;

create or replace function public.admin_list_assignable_driver_orders()
returns table(id uuid,order_number text,customer_name text,customer_phone text,order_status public.order_status,created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 return query
 select o.id,o.order_number::text,o.customer_name::text,o.customer_phone::text,o.order_status,o.created_at
 from public.orders o
 where o.order_status='confirmed'::public.order_status
   and not exists(select 1 from public.driver_assignments a where a.order_id=o.id and a.status in ('assigned','picked_up'))
   and not exists(select 1 from public.delivery_batch_orders bo join public.delivery_batches b on b.id=bo.batch_id where bo.order_id=o.id and b.status='scheduled')
 order by o.created_at desc limit 250;
end;
$$;