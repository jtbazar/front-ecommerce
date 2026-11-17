-- Guard driver assignment against vendor items that have not been collected and preserve already-completed assignments.
create or replace function public.admin_assign_driver_to_order(p_order_id uuid,p_driver_user_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_assignment_id uuid; v_existing_status text; v_order public.orders; v_batch_id uuid; v_batch_count integer;
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into v_order from public.orders o where o.id=p_order_id and o.order_status='confirmed'::public.order_status for update;
 if not found then raise exception 'Only confirmed orders can be assigned to a driver' using errcode='23514'; end if;
 if v_order.customer_id is not null and v_order.customer_id=p_driver_user_id then raise exception 'You cannot assign an order to the same user who placed it. Please select another driver.' using errcode='23514'; end if;
 if not exists(select 1 from public.customer_driver_access a join public.driver_applications d on d.user_id=a.user_id where a.user_id=p_driver_user_id and a.enabled=true and d.status='approved') then raise exception 'Driver is not approved or driver access is disabled' using errcode='42501'; end if;
 if not exists(select 1 from public.order_items oi where oi.order_id=p_order_id and oi.delivery_status<>'delivered') then raise exception 'No undelivered products remain on this order' using errcode='22023'; end if;
 if exists(select 1 from public.order_items oi where oi.order_id=p_order_id and oi.delivery_status<>'delivered' and ((oi.seller_id is null and oi.delivery_status<>'ready') or (oi.seller_id is not null and not exists(select 1 from public.vendor_order_pickups vp where vp.order_id=oi.order_id and vp.seller_id=oi.seller_id and vp.status='picked_up')))) then
   raise exception 'Every remaining product must be ready and every vendor product must be collected by JTBazar before driver assignment' using errcode='22023';
 end if;
 select count(distinct bo.batch_id),min(bo.batch_id::text)::uuid into v_batch_count,v_batch_id from public.delivery_batch_orders bo join public.delivery_batches b on b.id=bo.batch_id where bo.order_id=p_order_id and b.status='scheduled';
 if v_batch_count>1 then raise exception 'This order has multiple active delivery batches. Assign each delivery batch separately.' using errcode='22023'; end if;
 if v_batch_id is null then
   insert into public.delivery_batches(customer_id,customer_phone,delivery_fee,status,created_by) values(v_order.customer_id,v_order.customer_phone,coalesce(v_order.delivery_fee,0),'scheduled',auth.uid()) returning id into v_batch_id;
   insert into public.delivery_batch_orders(batch_id,order_id,fee_allocated) values(v_batch_id,p_order_id,coalesce(v_order.delivery_fee,0));
 else
   if exists(select 1 from public.delivery_batch_orders bo join public.orders o on o.id=bo.order_id where bo.batch_id=v_batch_id and (o.customer_id is distinct from v_order.customer_id or o.shipping_address_snapshot is distinct from v_order.shipping_address_snapshot)) then raise exception 'A driver batch can only contain one customer and one delivery address' using errcode='22023'; end if;
 end if;
 if exists(select 1 from public.delivery_batch_items bi join public.order_items oi on oi.id=bi.order_item_id where oi.order_id=p_order_id and oi.delivery_status<>'delivered' and bi.batch_id<>v_batch_id) then raise exception 'Some undelivered products already belong to another delivery batch. Use the follow-up delivery workflow.' using errcode='22023'; end if;
 insert into public.delivery_batch_items(batch_id,order_item_id) select v_batch_id,oi.id from public.order_items oi where oi.order_id=p_order_id and oi.delivery_status<>'delivered' and not exists(select 1 from public.delivery_batch_items bi where bi.order_item_id=oi.id);
 update public.order_items set delivery_status='ready' where order_id=p_order_id and delivery_status not in ('ready','delivered');
 select id,status into v_assignment_id,v_existing_status from public.driver_assignments where order_id=p_order_id for update;
 if v_assignment_id is not null and v_existing_status='delivered' then raise exception 'This order already has a completed driver delivery. Follow-up partial delivery needs its own item-level assignment.' using errcode='22023'; end if;
 if v_assignment_id is not null and v_existing_status in ('assigned','picked_up') then raise exception 'This order already has an active driver assignment. Cancel it before assigning again' using errcode='23505'; end if;
 if v_assignment_id is null then
   insert into public.driver_assignments(order_id,driver_user_id,assigned_by,delivery_batch_id,status) values(p_order_id,p_driver_user_id,auth.uid(),v_batch_id,'assigned') returning id into v_assignment_id;
 else
   update public.driver_assignments set driver_user_id=p_driver_user_id,assigned_by=auth.uid(),assigned_at=now(),picked_up_at=null,delivered_at=null,status='assigned',
     delivery_batch_id=v_batch_id,failed_reason=null,failed_note=null,delivery_proof_path=null,delivery_otp_hash=null,delivery_otp_expires_at=null,
     delivery_otp_verified_at=null,delivery_otp_attempts=0,cod_collected_amount=null,cod_collected_at=null,cash_reconciled_amount=null,
     cash_reconciled_at=null,cash_reconciled_by=null,cash_reconciliation_note=null where id=v_assignment_id;
 end if;
 return v_assignment_id;
end;
$$;

create or replace function public.admin_create_combined_driver_batch(p_order_ids uuid[])
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_batch_id uuid; v_customer_id uuid; v_phone text; v_fee numeric(12,2); v_count integer;
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_order_ids is null or cardinality(p_order_ids)<2 or cardinality(p_order_ids)>20 then raise exception 'Select between two and twenty orders to combine' using errcode='22023'; end if;
 if (select count(distinct x) from unnest(p_order_ids) x)<>cardinality(p_order_ids) then raise exception 'Duplicate orders are not allowed' using errcode='22023'; end if;
 select (array_agg(o.customer_id))[1],min(o.customer_phone),sum(o.delivery_fee),count(*) into v_customer_id,v_phone,v_fee,v_count from public.orders o where o.id=any(p_order_ids) and o.order_status='confirmed'::public.order_status;
 if v_count<>cardinality(p_order_ids) or v_customer_id is null then raise exception 'Every selected order must be confirmed and belong to a registered customer' using errcode='22023'; end if;
 if exists(select 1 from public.orders o where o.id=any(p_order_ids) and o.customer_id is distinct from v_customer_id) then raise exception 'All orders must belong to the same customer' using errcode='22023'; end if;
 if (select count(distinct o.shipping_address_snapshot) from public.orders o where o.id=any(p_order_ids))<>1 then raise exception 'All selected orders must have exactly the same delivery address' using errcode='22023'; end if;
 if exists(select 1 from public.driver_assignments a where a.order_id=any(p_order_ids) and a.status='delivered') then raise exception 'A selected order already has a completed driver delivery. Combine only orders with no previous delivery.' using errcode='22023'; end if;
 if not exists(select 1 from public.order_items oi where oi.order_id=any(p_order_ids) and oi.delivery_status<>'delivered') then raise exception 'No undelivered products remain in the selected orders' using errcode='22023'; end if;
 if exists(select 1 from public.order_items oi where oi.order_id=any(p_order_ids) and oi.delivery_status<>'delivered' and ((oi.seller_id is null and oi.delivery_status<>'ready') or (oi.seller_id is not null and not exists(select 1 from public.vendor_order_pickups vp where vp.order_id=oi.order_id and vp.seller_id=oi.seller_id and vp.status='picked_up')))) then raise exception 'Every remaining product must be ready and every vendor product must be collected by JTBazar before combining deliveries' using errcode='22023'; end if;
 if exists(select 1 from public.driver_assignments a where a.order_id=any(p_order_ids) and a.status in ('assigned','picked_up')) then raise exception 'One or more orders already have an active driver assignment' using errcode='23505'; end if;
 if exists(select 1 from public.delivery_batch_orders bo join public.delivery_batches b on b.id=bo.batch_id where bo.order_id=any(p_order_ids) and b.status='scheduled') then raise exception 'One or more orders already belong to a scheduled delivery batch' using errcode='23505'; end if;
 if exists(select 1 from public.delivery_batch_items bi join public.order_items oi on oi.id=bi.order_item_id where oi.order_id=any(p_order_ids) and oi.delivery_status<>'delivered') then raise exception 'Some undelivered products already belong to another delivery batch. Use the follow-up delivery workflow.' using errcode='22023'; end if;
 insert into public.delivery_batches(customer_id,customer_phone,delivery_fee,status,created_by) values(v_customer_id,v_phone,coalesce(v_fee,0),'scheduled',auth.uid()) returning id into v_batch_id;
 insert into public.delivery_batch_orders(batch_id,order_id,fee_allocated) select v_batch_id,o.id,o.delivery_fee from public.orders o where o.id=any(p_order_ids);
 insert into public.delivery_batch_items(batch_id,order_item_id) select v_batch_id,oi.id from public.order_items oi where oi.order_id=any(p_order_ids) and oi.delivery_status<>'delivered';
 update public.order_items set delivery_status='ready' where order_id=any(p_order_ids) and delivery_status not in ('ready','delivered');
 insert into public.admin_audit_logs(actor_id,action,entity,entity_id,details) values(auth.uid(),'INSERT','delivery_batches',v_batch_id,jsonb_build_object('order_ids',p_order_ids,'customer_id',v_customer_id,'delivery_fee_preserved',coalesce(v_fee,0),'combined_driver_route',true));
 return v_batch_id;
end;
$$;

create or replace function public.admin_assign_driver_to_delivery_batch(p_batch_id uuid,p_driver_user_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer:=0; v_order record; v_customer uuid;
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 if not exists(select 1 from public.customer_driver_access a join public.driver_applications d on d.user_id=a.user_id where a.user_id=p_driver_user_id and a.enabled=true and d.status='approved') then raise exception 'Driver is not approved or driver access is disabled' using errcode='42501'; end if;
 select customer_id into v_customer from public.delivery_batches where id=p_batch_id and status='scheduled';
 if v_customer is null then raise exception 'Scheduled delivery batch not found or has no customer' using errcode='P0002'; end if;
 if exists(select 1 from public.delivery_batch_orders bo join public.orders o on o.id=bo.order_id join public.driver_assignments a on a.order_id=o.id where bo.batch_id=p_batch_id and a.status='delivered' and a.delivery_batch_id is distinct from p_batch_id) then raise exception 'An order in this batch already has a completed delivery from another batch. Follow-up item-level delivery is not supported by this assignment screen.' using errcode='22023'; end if;
 if exists(select 1 from public.delivery_batch_orders bo join public.orders o on o.id=bo.order_id where bo.batch_id=p_batch_id and (o.customer_id is distinct from v_customer or o.order_status<>'confirmed'::public.order_status)) then raise exception 'All batch orders must belong to the same customer and be confirmed' using errcode='22023'; end if;
 if (select count(distinct o.shipping_address_snapshot) from public.delivery_batch_orders bo join public.orders o on o.id=bo.order_id where bo.batch_id=p_batch_id)<>1 then raise exception 'Orders in one driver batch must have the same delivery address' using errcode='22023'; end if;
 if exists(select 1 from public.delivery_batch_orders bo join public.orders o on o.id=bo.order_id join public.order_items oi on oi.order_id=o.id where bo.batch_id=p_batch_id and oi.delivery_status<>'delivered' and not exists(select 1 from public.delivery_batch_items bi where bi.batch_id=p_batch_id and bi.order_item_id=oi.id)) then raise exception 'Every undelivered product in this batch must be included in its ready-to-deliver item list' using errcode='22023'; end if;
 if exists(select 1 from public.delivery_batch_orders bo join public.orders o on o.id=bo.order_id join public.order_items oi on oi.order_id=o.id where bo.batch_id=p_batch_id and oi.delivery_status<>'delivered' and oi.seller_id is not null and not exists(select 1 from public.vendor_order_pickups vp where vp.order_id=oi.order_id and vp.seller_id=oi.seller_id and vp.status='picked_up')) then raise exception 'A vendor product is still waiting for JTBazar pickup' using errcode='22023'; end if;
 if exists(select 1 from public.delivery_batch_orders bo join public.driver_assignments a on a.order_id=bo.order_id and a.delivery_batch_id=p_batch_id where bo.batch_id=p_batch_id and a.status in ('assigned','picked_up')) then raise exception 'One or more orders in this batch already have an active driver assignment' using errcode='23505'; end if;
 for v_order in select o.id from public.delivery_batch_orders bo join public.orders o on o.id=bo.order_id where bo.batch_id=p_batch_id and not exists(select 1 from public.driver_assignments a where a.order_id=o.id and a.delivery_batch_id=p_batch_id and a.status='delivered') loop
   insert into public.driver_assignments(order_id,driver_user_id,assigned_by,delivery_batch_id,status,assigned_at,picked_up_at,delivered_at,failed_reason,failed_note,delivery_proof_path,delivery_otp_hash,delivery_otp_expires_at,delivery_otp_verified_at,delivery_otp_attempts,cod_collected_amount,cod_collected_at,cash_reconciled_amount,cash_reconciled_at,cash_reconciled_by,cash_reconciliation_note)
   values(v_order.id,p_driver_user_id,auth.uid(),p_batch_id,'assigned',now(),null,null,null,null,null,null,null,null,0,null,null,null,null,null,null)
   on conflict(order_id) do update set driver_user_id=excluded.driver_user_id,assigned_by=excluded.assigned_by,delivery_batch_id=excluded.delivery_batch_id,status='assigned',assigned_at=now(),picked_up_at=null,delivered_at=null,failed_reason=null,failed_note=null,delivery_proof_path=null,delivery_otp_hash=null,delivery_otp_expires_at=null,delivery_otp_verified_at=null,delivery_otp_attempts=0,cod_collected_amount=null,cod_collected_at=null,cash_reconciled_amount=null,cash_reconciled_at=null,cash_reconciled_by=null,cash_reconciliation_note=null where public.driver_assignments.status in ('failed','cancelled');
   v_count:=v_count+1;
 end loop;
 return v_count;
end;
$$;

create or replace function public.admin_reconcile_driver_cash(p_assignment_id uuid,p_amount numeric,p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_collected numeric; v_status text; v_driver uuid; v_total numeric;
begin
 if not private.has_role('admin'::public.app_role) then raise exception 'Admin access required' using errcode='42501'; end if;
 select a.order_id,a.cod_collected_amount,a.status,a.driver_user_id,o.total into v_order_id,v_collected,v_status,v_driver,v_total from public.driver_assignments a join public.orders o on o.id=a.order_id where a.id=p_assignment_id for update of a;
 if v_order_id is null then raise exception 'Driver assignment not found' using errcode='P0002'; end if;
 if v_status<>'delivered' or v_collected is null then raise exception 'Driver COD collection must be recorded before reconciliation' using errcode='22023'; end if;
 if p_amount is null or p_amount<0 or p_amount>v_total then raise exception 'Reconciled cash must be between zero and the order total' using errcode='22023'; end if;
 if p_amount<>v_collected and nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'Add a note when the cash amount does not match the driver collection' using errcode='22023'; end if;
 if p_note is not null and char_length(p_note)>1000 then raise exception 'Reconciliation note is too long' using errcode='22023'; end if;
 update public.driver_assignments set cash_reconciled_amount=p_amount,cash_reconciled_at=now(),cash_reconciled_by=auth.uid(),cash_reconciliation_note=nullif(btrim(p_note),'') where id=p_assignment_id;
 if p_amount=v_total then update public.orders set payment_status='paid'::public.payment_status,updated_at=now() where id=v_order_id; end if;
 insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type) values(p_assignment_id,v_order_id,v_driver,'cash_reconciled');
end;
$$;

create or replace function public.driver_update_delivery_status(p_assignment_id uuid,p_action text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_order_id uuid; v_status text; v_order_status public.order_status; v_otp_verified timestamptz; v_proof text; v_batch_id uuid;
begin
 if not coalesce((select a.enabled from public.customer_driver_access a where a.user_id=auth.uid()),false) or not exists(select 1 from public.driver_applications d where d.user_id=auth.uid() and d.status='approved') then raise exception 'Approved active driver access required' using errcode='42501'; end if;
 if p_action not in ('picked_up','delivered') then raise exception 'Invalid delivery action' using errcode='22023'; end if;
 select a.order_id,a.status,o.order_status,a.delivery_otp_verified_at,a.delivery_proof_path,a.delivery_batch_id into v_order_id,v_status,v_order_status,v_otp_verified,v_proof,v_batch_id from public.driver_assignments a join public.orders o on o.id=a.order_id where a.id=p_assignment_id and a.driver_user_id=auth.uid() for update of a;
 if v_order_id is null then raise exception 'Assigned delivery not found' using errcode='42501'; end if;
 if v_order_status='cancelled'::public.order_status then raise exception 'Cancelled orders cannot be delivered' using errcode='22023'; end if;
 if v_status in ('delivered','cancelled','failed') then raise exception 'Delivery is already closed' using errcode='22023'; end if;
 if p_action='picked_up' then
   if v_status<>'assigned' then raise exception 'Only assigned deliveries can be picked up' using errcode='22023'; end if;
   update public.driver_assignments set status='picked_up',picked_up_at=coalesce(picked_up_at,now()) where id=p_assignment_id;
   insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type) values(p_assignment_id,v_order_id,auth.uid(),'picked_up');
 else
   if v_status<>'picked_up' then raise exception 'Parcel must be picked up before delivery' using errcode='22023'; end if;
   if v_otp_verified is null then raise exception 'Customer delivery OTP must be verified first' using errcode='22023'; end if;
   if nullif(v_proof,'') is null then raise exception 'Delivery photo proof is required before completion' using errcode='22023'; end if;
   update public.driver_assignments set status='delivered',delivered_at=now() where id=p_assignment_id;
   if v_batch_id is not null then
     update public.order_items oi set delivery_status='delivered' from public.delivery_batch_items bi where bi.batch_id=v_batch_id and bi.order_item_id=oi.id and oi.order_id=v_order_id and oi.delivery_status<>'delivered';
     if not exists(select 1 from public.delivery_batch_items bi join public.order_items oi on oi.id=bi.order_item_id where bi.batch_id=v_batch_id and oi.delivery_status<>'delivered') then update public.delivery_batches set status='delivered',updated_at=now() where id=v_batch_id and status='scheduled'; end if;
   else update public.order_items set delivery_status='delivered' where order_id=v_order_id and delivery_status='ready'; end if;
   if not exists(select 1 from public.order_items oi where oi.order_id=v_order_id and oi.delivery_status<>'delivered') then update public.orders set order_status='delivered'::public.order_status,delivered_at=now(),updated_at=now() where id=v_order_id; end if;
   insert into public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type) values(p_assignment_id,v_order_id,auth.uid(),'delivered');
 end if;
end;
$$;