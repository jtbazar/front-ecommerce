-- JTBazar multi-batch partial delivery, stock-out SLA and refund tracking.
-- Apply through reviewed Supabase migration workflow; do not run against live data ad hoc.

ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'partially_delivered';

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS stock_unavailable_at timestamptz,
  ADD COLUMN IF NOT EXISTS stock_arranged_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS stock_unavailable_note text;

ALTER TABLE public.admin_refund_records ALTER COLUMN case_id DROP NOT NULL;

ALTER TABLE public.driver_assignments DROP CONSTRAINT IF EXISTS driver_assignments_order_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS driver_assignments_order_batch_uidx
  ON public.driver_assignments(order_id, delivery_batch_id)
  WHERE delivery_batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.enforce_order_status_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $$
DECLARE old_rank numeric; new_rank numeric;
BEGIN
  IF NEW.order_status = OLD.order_status THEN RETURN NEW; END IF;
  old_rank := CASE OLD.order_status::text
    WHEN 'pending' THEN 1 WHEN 'confirmed' THEN 2 WHEN 'processing' THEN 3
    WHEN 'shipped' THEN 4 WHEN 'partially_delivered' THEN 4.5 WHEN 'delivered' THEN 5 ELSE 99 END;
  new_rank := CASE NEW.order_status::text
    WHEN 'pending' THEN 1 WHEN 'confirmed' THEN 2 WHEN 'processing' THEN 3
    WHEN 'shipped' THEN 4 WHEN 'partially_delivered' THEN 4.5 WHEN 'delivered' THEN 5 ELSE 99 END;
  IF OLD.order_status::text IN ('delivered','cancelled') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Delivered or cancelled orders cannot move to another status.';
  END IF;
  IF NEW.order_status::text='cancelled' THEN RETURN NEW; END IF;
  IF new_rank<=old_rank OR new_rank=99 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Order status can only move forward.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.rollup_order_delivery_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_active integer; v_delivered integer; v_remaining integer;
BEGIN
  SELECT count(*) FILTER (WHERE oi.vendor_fulfillment_status<>'cancelled'),
         count(*) FILTER (WHERE oi.vendor_fulfillment_status<>'cancelled' AND oi.delivery_status='delivered'),
         count(*) FILTER (WHERE oi.vendor_fulfillment_status<>'cancelled' AND oi.delivery_status<>'delivered')
    INTO v_active,v_delivered,v_remaining
  FROM public.order_items oi WHERE oi.order_id=NEW.order_id;

  IF v_active=0 THEN
    UPDATE public.orders SET order_status='cancelled'::public.order_status,updated_at=now()
      WHERE id=NEW.order_id AND order_status NOT IN ('delivered'::public.order_status,'cancelled'::public.order_status);
  ELSIF v_remaining=0 THEN
    UPDATE public.orders SET order_status='delivered'::public.order_status,delivered_at=coalesce(delivered_at,now()),updated_at=now()
      WHERE id=NEW.order_id AND order_status NOT IN ('delivered'::public.order_status,'cancelled'::public.order_status);
  ELSIF v_delivered>0 THEN
    UPDATE public.orders SET order_status='partially_delivered'::public.order_status,delivered_at=NULL,updated_at=now()
      WHERE id=NEW.order_id AND order_status NOT IN ('delivered'::public.order_status,'cancelled'::public.order_status,'partially_delivered'::public.order_status);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.admin_mark_order_item_stock_unavailable(p_item_id uuid,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_order public.orders%ROWTYPE; v_item public.order_items%ROWTYPE; v_deadline timestamptz;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' AND (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'JTBazar authenticator verification is required.' USING ERRCODE='42501';
  END IF;
  IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.order_items WHERE id=p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order item not found.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=v_item.order_id FOR UPDATE;
  IF v_order.order_status IN ('delivered'::public.order_status,'cancelled'::public.order_status)
     OR v_item.delivery_status='delivered' OR v_item.vendor_fulfillment_status='cancelled' THEN
    RAISE EXCEPTION 'This item is already closed and cannot be put on stock hold.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.driver_assignments da
      JOIN public.delivery_batch_items bi ON bi.batch_id=da.delivery_batch_id
      WHERE bi.order_item_id=p_item_id AND da.status IN ('assigned','picked_up')) THEN
    RAISE EXCEPTION 'This item is already assigned to a driver.' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.delivery_batch_items WHERE order_item_id=p_item_id;
  UPDATE public.delivery_batches SET status='cancelled',updated_at=now() WHERE status='scheduled' AND id IN (SELECT id FROM public.delivery_batches WHERE id IN (SELECT batch_id FROM public.delivery_batch_orders WHERE order_id=v_item.order_id)) AND NOT EXISTS(SELECT 1 FROM public.delivery_batch_items bi WHERE bi.batch_id=public.delivery_batches.id);
  v_deadline:=now()+interval '7 days';
  UPDATE public.order_items SET delivery_status='pending',stock_unavailable_at=now(),
    stock_arranged_deadline_at=v_deadline,stock_unavailable_note=nullif(left(btrim(coalesce(p_note,'')),500),'')
  WHERE id=p_item_id;
  INSERT INTO public.admin_audit_logs(actor_id,action,entity,entity_id,details)
  VALUES(auth.uid(),'UPDATE','order_items',p_item_id,
    jsonb_build_object('order_id',v_order.id,'deadline_at',v_deadline,'note',p_note));
  RETURN jsonb_build_object('item_id',p_item_id,'stock_unavailable_at',now(),'deadline_at',v_deadline);
END $$;

CREATE OR REPLACE FUNCTION public.admin_clear_order_item_stock_unavailable(p_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' AND (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'JTBazar authenticator verification is required.' USING ERRCODE='42501';
  END IF;
  IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE='42501'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id
    LEFT JOIN public.product_inventory inv ON inv.product_id=oi.product_id
      AND inv.variant_id IS NOT DISTINCT FROM oi.variant_id
    WHERE oi.id=p_item_id AND (
      (p.is_daily_item AND (p.daily_status<>'available' OR coalesce(p.daily_available_quantity,0)<oi.quantity))
      OR (p.track_inventory AND coalesce(inv.quantity,0)<oi.quantity)
    )
  ) THEN
    RAISE EXCEPTION 'The required quantity is not available in live inventory yet. Update stock first, then mark it arranged.' USING ERRCODE='22023';
  END IF;
  UPDATE public.order_items oi SET stock_unavailable_at=NULL,stock_arranged_deadline_at=NULL,stock_unavailable_note=NULL,
    delivery_status=CASE
      WHEN oi.seller_id IS NULL THEN 'ready'
      WHEN oi.vendor_fulfillment_status='ready' AND EXISTS(
        SELECT 1 FROM public.vendor_order_pickups vp WHERE vp.order_id=oi.order_id
          AND vp.seller_id=oi.seller_id AND vp.status='picked_up') THEN 'ready'
      ELSE 'pending' END
  WHERE oi.id=p_item_id AND oi.vendor_fulfillment_status<>'cancelled' AND oi.delivery_status<>'delivered';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active undelivered item not found.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.admin_audit_logs(actor_id,action,entity,entity_id,details)
  VALUES(auth.uid(),'UPDATE','order_items',p_item_id,jsonb_build_object('action','clear_stock_hold'));
END $$;

CREATE OR REPLACE FUNCTION public.admin_cancel_order_item(p_item_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_order_id uuid; v_order public.orders%ROWTYPE; v_item public.order_items%ROWTYPE;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),''); v_remaining integer; v_delivered integer;
  v_sub numeric(12,2); v_disc numeric(12,2); v_old_total numeric(12,2); v_refund numeric(12,2);
  v_batch_id uuid; v_seller_user uuid; v_order_cancelled boolean:=false; v_refund_id uuid;
  v_picked_up boolean:=false; v_fee_to_refund numeric(12,2):=0;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' AND (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'JTBazar authenticator verification is required.' USING ERRCODE='42501';
  END IF;
  IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE='42501'; END IF;
  IF v_reason IS NULL OR char_length(v_reason)<3 THEN RAISE EXCEPTION 'A cancellation reason (at least 3 characters) is required.' USING ERRCODE='22023'; END IF;
  v_reason:=left(v_reason,500);

  SELECT order_id INTO v_order_id FROM public.order_items WHERE id=p_item_id;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'Order item not found.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=v_order_id FOR UPDATE;
  PERFORM 1 FROM public.order_items WHERE order_id=v_order_id FOR UPDATE;
  SELECT * INTO v_item FROM public.order_items WHERE id=p_item_id;
  IF v_order.order_status IN ('delivered'::public.order_status,'cancelled'::public.order_status) THEN
    RAISE EXCEPTION 'This order is already closed.' USING ERRCODE='22023';
  END IF;
  IF v_item.vendor_fulfillment_status='cancelled' OR v_item.delivery_status='delivered' THEN
    RAISE EXCEPTION 'This item is already cancelled or delivered.' USING ERRCODE='22023';
  END IF;
  IF v_item.stock_unavailable_at IS NULL OR v_item.stock_arranged_deadline_at IS NULL THEN
    RAISE EXCEPTION 'Mark this item stock unavailable first. The 7-day arrangement period starts from that time.' USING ERRCODE='22023';
  END IF;
  IF now()<v_item.stock_arranged_deadline_at THEN
    RAISE EXCEPTION 'The 7-day stock arrangement period has not expired yet.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.driver_assignments da JOIN public.delivery_batch_items bi ON bi.batch_id=da.delivery_batch_id
      WHERE bi.order_item_id=p_item_id AND da.status IN ('assigned','picked_up')) THEN
    RAISE EXCEPTION 'This item is already with a driver. Resolve the active driver assignment first.' USING ERRCODE='22023';
  END IF;

  v_old_total:=v_order.total;
  v_picked_up:=EXISTS(SELECT 1 FROM public.vendor_order_pickups vp
    WHERE vp.order_id=v_order_id AND vp.seller_id=v_item.seller_id AND vp.status='picked_up');
  DELETE FROM public.delivery_batch_items WHERE order_item_id=p_item_id RETURNING batch_id INTO v_batch_id;
  IF v_batch_id IS NOT NULL THEN
    UPDATE public.delivery_batches SET status='cancelled',updated_at=now()
    WHERE id=v_batch_id AND status='scheduled'
      AND NOT EXISTS(SELECT 1 FROM public.delivery_batch_items WHERE batch_id=v_batch_id);
  END IF;

  PERFORM pg_catalog.set_config('paperloom.inventory_movement_type','return',true);
  PERFORM pg_catalog.set_config('paperloom.inventory_reference_id',v_item.id::text,true);
  PERFORM pg_catalog.set_config('paperloom.inventory_note','Admin cancelled unavailable item on order '||v_order.order_number,true);
  UPDATE public.product_inventory inv SET quantity=inv.quantity+v_item.quantity
    FROM public.products pr
    WHERE pr.id=v_item.product_id AND pr.track_inventory AND inv.product_id=v_item.product_id
      AND inv.variant_id IS NOT DISTINCT FROM v_item.variant_id;

  UPDATE public.order_items SET vendor_fulfillment_status='cancelled',
    delivery_status=CASE WHEN delivery_status='delivered' THEN 'delivered' ELSE 'pending' END,
    vendor_updated_at=now() WHERE id=p_item_id;

  IF v_item.seller_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.order_items oi WHERE oi.order_id=v_order_id AND oi.seller_id=v_item.seller_id
      AND oi.vendor_fulfillment_status<>'cancelled') THEN
    UPDATE public.vendor_order_pickups SET status='cancelled',updated_at=now()
      WHERE order_id=v_order_id AND seller_id=v_item.seller_id AND status IN ('awaiting_vendor','ready_for_pickup');
  END IF;

  SELECT count(*) FILTER(WHERE vendor_fulfillment_status<>'cancelled'),
         count(*) FILTER(WHERE delivery_status='delivered')
    INTO v_remaining,v_delivered FROM public.order_items WHERE order_id=v_order_id;
  SELECT coalesce(sum(coalesce((oi.product_snapshot->>'campaign_original_unit_price')::numeric,oi.unit_price)*oi.quantity),0),
         coalesce(sum(greatest(0,coalesce((oi.product_snapshot->>'campaign_original_unit_price')::numeric,oi.unit_price)*oi.quantity-oi.line_total)),0)
    INTO v_sub,v_disc FROM public.order_items oi
    WHERE oi.order_id=v_order_id AND oi.vendor_fulfillment_status<>'cancelled';

  IF v_remaining=0 THEN
    v_order_cancelled:=v_delivered=0;
    IF v_order_cancelled THEN v_fee_to_refund:=v_order.delivery_fee; END IF;
    UPDATE public.orders SET subtotal=0,discount_amount=0,
      delivery_fee=CASE WHEN v_order_cancelled THEN 0 ELSE delivery_fee END,
      order_status=CASE WHEN v_order_cancelled THEN 'cancelled'::public.order_status ELSE 'delivered'::public.order_status END,
      updated_at=now() WHERE id=v_order_id;
  ELSE
    UPDATE public.orders SET subtotal=v_sub,discount_amount=v_disc,updated_at=now() WHERE id=v_order_id;
  END IF;

  v_refund:=round(coalesce(v_item.line_total,v_item.unit_price*v_item.quantity)+v_fee_to_refund,2);
  IF v_order.payment_status IN ('paid'::public.payment_status,'partially_refunded'::public.payment_status) AND v_refund>0 THEN
    IF v_order.customer_id IS NULL THEN
      RAISE EXCEPTION 'Paid guest order has no buyer account for refund tracking. Resolve buyer identity before cancelling this paid item.' USING ERRCODE='23514';
    END IF;
    INSERT INTO public.admin_refund_records(case_id,order_id,order_item_id,buyer_id,amount,currency,method,status,admin_note,created_by)
    VALUES(NULL,v_order_id,p_item_id,v_order.customer_id,v_refund,'PKR','other','pending',
      left('Stock unavailable beyond 7-day limit. '||v_reason,2000),auth.uid())
    RETURNING id INTO v_refund_id;
  END IF;

  IF v_item.seller_id IS NOT NULL THEN
    SELECT user_id INTO v_seller_user FROM public.seller_profiles WHERE id=v_item.seller_id;
    IF v_seller_user IS NOT NULL THEN
      INSERT INTO public.notifications(user_id,kind,title,body,related_order_id)
      VALUES(v_seller_user,'order'::public.notification_kind,'Item cancelled in order '||v_order.order_number,
        left(v_item.product_name_snapshot||' was cancelled by JTBazar admin. Reason: '||v_reason,2000),v_order_id);
    END IF;
  END IF;
  IF v_order.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,kind,title,body,related_order_id)
    VALUES(v_order.customer_id,'order'::public.notification_kind,'Item cancelled in order '||v_order.order_number,
      left(v_item.product_name_snapshot||' was cancelled after the 7-day stock arrangement period. '||
      CASE WHEN v_refund_id IS NOT NULL THEN 'A refund is pending admin processing.' ELSE 'Your updated order total is PKR '||(SELECT total::text FROM public.orders WHERE id=v_order_id)||'.' END,2000),v_order_id);
  END IF;
  INSERT INTO public.admin_audit_logs(actor_id,action,entity,entity_id,details)
  VALUES(auth.uid(),'UPDATE','order_items',p_item_id,jsonb_build_object('action','admin_cancel_order_item','order_id',v_order_id,
    'reason',v_reason,'old_order_total',v_old_total,'new_order_total',(SELECT total FROM public.orders WHERE id=v_order_id),
    'order_cancelled',v_order_cancelled,'refund_record_id',v_refund_id,'refund_amount',v_refund,'goods_already_picked_up',v_picked_up));

  RETURN jsonb_build_object('item_id',p_item_id,'order_id',v_order_id,'order_number',v_order.order_number,
    'order_status',(SELECT order_status FROM public.orders WHERE id=v_order_id),'order_cancelled',v_order_cancelled,
    'subtotal',(SELECT subtotal FROM public.orders WHERE id=v_order_id),'discount_amount',(SELECT discount_amount FROM public.orders WHERE id=v_order_id),
    'delivery_fee',(SELECT delivery_fee FROM public.orders WHERE id=v_order_id),'total',(SELECT total FROM public.orders WHERE id=v_order_id),
    'amount_reduced',v_old_total-(SELECT total FROM public.orders WHERE id=v_order_id),
    'refund_record_id',v_refund_id,'refund_amount',CASE WHEN v_refund_id IS NOT NULL THEN v_refund ELSE 0 END,
    'refund_status',CASE WHEN v_refund_id IS NOT NULL THEN 'pending' ELSE NULL END,'goods_already_picked_up',v_picked_up);
END $$;

CREATE OR REPLACE FUNCTION public.admin_assign_driver_to_delivery_batch(p_batch_id uuid,p_driver_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_customer uuid; v_order record; v_count integer:=0; v_rows integer;
BEGIN
  IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customer_driver_access a JOIN public.driver_applications d ON d.user_id=a.user_id
    WHERE a.user_id=p_driver_user_id AND a.enabled AND d.status='approved') THEN
    RAISE EXCEPTION 'Driver is not approved or driver access is disabled' USING ERRCODE='42501';
  END IF;
  SELECT customer_id INTO v_customer FROM public.delivery_batches WHERE id=p_batch_id AND status='scheduled' FOR UPDATE;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Scheduled delivery batch not found.' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.delivery_batch_items WHERE batch_id=p_batch_id) THEN
    RAISE EXCEPTION 'This delivery batch has no ready products.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.delivery_batch_orders bo JOIN public.orders o ON o.id=bo.order_id
    WHERE bo.batch_id=p_batch_id AND (o.customer_id IS DISTINCT FROM v_customer
      OR o.order_status NOT IN ('confirmed'::public.order_status,'processing'::public.order_status,'shipped'::public.order_status,'partially_delivered'::public.order_status))) THEN
    RAISE EXCEPTION 'Batch orders must belong to the same customer and remain active.' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(DISTINCT o.shipping_address_snapshot) FROM public.delivery_batch_orders bo
      JOIN public.orders o ON o.id=bo.order_id WHERE bo.batch_id=p_batch_id)<>1 THEN
    RAISE EXCEPTION 'All orders in one driver batch must have the same delivery address.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.delivery_batch_items bi JOIN public.order_items oi ON oi.id=bi.order_item_id
    WHERE bi.batch_id=p_batch_id AND (oi.delivery_status<>'ready' OR oi.vendor_fulfillment_status='cancelled'
      OR oi.stock_unavailable_at IS NOT NULL
      OR NOT EXISTS(SELECT 1 FROM public.delivery_batch_orders bo WHERE bo.batch_id=p_batch_id AND bo.order_id=oi.order_id))) THEN
    RAISE EXCEPTION 'Every batch product must be ready, active, available and linked to an order in this batch.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.delivery_batch_items bi JOIN public.order_items oi ON oi.id=bi.order_item_id
    WHERE bi.batch_id=p_batch_id AND oi.seller_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.vendor_order_pickups vp WHERE vp.order_id=oi.order_id AND vp.seller_id=oi.seller_id AND vp.status='picked_up')) THEN
    RAISE EXCEPTION 'A vendor product is still waiting for JTBazar collection.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.delivery_batch_orders bo JOIN public.driver_assignments da
      ON da.order_id=bo.order_id AND da.status IN ('assigned','picked_up')
    WHERE bo.batch_id=p_batch_id AND da.delivery_batch_id IS DISTINCT FROM p_batch_id) THEN
    RAISE EXCEPTION 'An order already has an active delivery with another driver. Finish it before assigning the next batch.' USING ERRCODE='23505';
  END IF;
  IF EXISTS(SELECT 1 FROM public.delivery_batch_orders bo JOIN public.driver_assignments da
      ON da.order_id=bo.order_id AND da.delivery_batch_id=p_batch_id
    WHERE bo.batch_id=p_batch_id AND da.status IN ('assigned','picked_up','delivered')) THEN
    RAISE EXCEPTION 'This batch already has an active or completed driver assignment.' USING ERRCODE='23505';
  END IF;

  FOR v_order IN SELECT bo.order_id FROM public.delivery_batch_orders bo WHERE bo.batch_id=p_batch_id LOOP
    INSERT INTO public.driver_assignments(order_id,driver_user_id,assigned_by,delivery_batch_id,status,assigned_at,
      picked_up_at,delivered_at,failed_reason,failed_note,delivery_proof_path,delivery_otp_hash,
      delivery_otp_expires_at,delivery_otp_verified_at,delivery_otp_attempts,cod_collected_amount,cod_collected_at,
      cash_reconciled_amount,cash_reconciled_at,cash_reconciled_by,cash_reconciliation_note)
    VALUES(v_order.order_id,p_driver_user_id,auth.uid(),p_batch_id,'assigned',now(),NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,NULL,NULL,NULL)
    ON CONFLICT(order_id,delivery_batch_id) WHERE delivery_batch_id IS NOT NULL
    DO UPDATE SET driver_user_id=EXCLUDED.driver_user_id,assigned_by=EXCLUDED.assigned_by,status='assigned',
      assigned_at=now(),picked_up_at=NULL,delivered_at=NULL,failed_reason=NULL,failed_note=NULL,delivery_proof_path=NULL,
      delivery_otp_hash=NULL,delivery_otp_expires_at=NULL,delivery_otp_verified_at=NULL,delivery_otp_attempts=0,
      cod_collected_amount=NULL,cod_collected_at=NULL,cash_reconciled_amount=NULL,cash_reconciled_at=NULL,
      cash_reconciled_by=NULL,cash_reconciliation_note=NULL
    WHERE public.driver_assignments.status IN ('failed','cancelled');
    GET DIAGNOSTICS v_rows=ROW_COUNT;
    IF v_rows=0 THEN RAISE EXCEPTION 'A driver assignment already exists for one of these order batches.' USING ERRCODE='23505'; END IF;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.admin_create_combined_driver_batch(p_order_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_batch uuid; v_customer uuid; v_phone text; v_fee numeric(12,2); v_count integer;
BEGIN
  IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  IF p_order_ids IS NULL OR cardinality(p_order_ids)<2 OR cardinality(p_order_ids)>20
    OR (SELECT count(DISTINCT x) FROM unnest(p_order_ids) x)<>cardinality(p_order_ids) THEN
    RAISE EXCEPTION 'Select 2–20 different orders to combine.' USING ERRCODE='22023';
  END IF;
  SELECT (array_agg(o.customer_id))[1],min(o.customer_phone),count(*) INTO v_customer,v_phone,v_count
    FROM public.orders o WHERE o.id=ANY(p_order_ids)
      AND o.order_status IN ('confirmed'::public.order_status,'processing'::public.order_status,'shipped'::public.order_status,'partially_delivered'::public.order_status);
  IF v_count<>cardinality(p_order_ids) OR v_customer IS NULL
    OR EXISTS(SELECT 1 FROM public.orders o WHERE o.id=ANY(p_order_ids) AND o.customer_id IS DISTINCT FROM v_customer) THEN
    RAISE EXCEPTION 'All selected orders must belong to the same customer and be active.' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(DISTINCT o.shipping_address_snapshot) FROM public.orders o WHERE o.id=ANY(p_order_ids))<>1 THEN
    RAISE EXCEPTION 'All selected orders must have the same delivery address.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.delivery_batch_orders bo JOIN public.delivery_batches b ON b.id=bo.batch_id
    WHERE bo.order_id=ANY(p_order_ids) AND b.status='scheduled') THEN
    RAISE EXCEPTION 'One selected order already has a scheduled batch. Assign that batch first.' USING ERRCODE='23505';
  END IF;
  IF EXISTS(SELECT 1 FROM public.driver_assignments da WHERE da.order_id=ANY(p_order_ids) AND da.status IN ('assigned','picked_up')) THEN
    RAISE EXCEPTION 'One selected order already has an active driver delivery.' USING ERRCODE='23505';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=ANY(p_order_ids)
    AND oi.delivery_status='ready' AND oi.vendor_fulfillment_status<>'cancelled'
    AND oi.stock_unavailable_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.delivery_batch_items bi WHERE bi.order_item_id=oi.id)) THEN
    RAISE EXCEPTION 'No unassigned ready products are available to combine.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=ANY(p_order_ids)
    AND oi.delivery_status='ready' AND oi.seller_id IS NOT NULL AND oi.vendor_fulfillment_status<>'cancelled'
    AND NOT EXISTS(SELECT 1 FROM public.vendor_order_pickups vp WHERE vp.order_id=oi.order_id AND vp.seller_id=oi.seller_id AND vp.status='picked_up')) THEN
    RAISE EXCEPTION 'A vendor product is still waiting for JTBazar collection.' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(sum(CASE WHEN EXISTS(SELECT 1 FROM public.delivery_batch_orders oldbo WHERE oldbo.order_id=o.id)
    THEN 0 ELSE o.delivery_fee END),0) INTO v_fee FROM public.orders o WHERE o.id=ANY(p_order_ids);
  INSERT INTO public.delivery_batches(customer_id,customer_phone,delivery_fee,status,created_by)
  VALUES(v_customer,v_phone,v_fee,'scheduled',auth.uid()) RETURNING id INTO v_batch;
  INSERT INTO public.delivery_batch_orders(batch_id,order_id,fee_allocated)
  SELECT v_batch,o.id,CASE WHEN EXISTS(SELECT 1 FROM public.delivery_batch_orders oldbo WHERE oldbo.order_id=o.id)
    THEN 0 ELSE o.delivery_fee END FROM public.orders o WHERE o.id=ANY(p_order_ids);
  INSERT INTO public.delivery_batch_items(batch_id,order_item_id)
  SELECT v_batch,oi.id FROM public.order_items oi WHERE oi.order_id=ANY(p_order_ids)
    AND oi.delivery_status='ready' AND oi.vendor_fulfillment_status<>'cancelled'
    AND oi.stock_unavailable_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.delivery_batch_items bi WHERE bi.order_item_id=oi.id);
  INSERT INTO public.admin_audit_logs(actor_id,action,entity,entity_id,details)
  VALUES(auth.uid(),'INSERT','delivery_batches',v_batch,jsonb_build_object('order_ids',p_order_ids,'partial_ready_batch',true,'delivery_fee',v_fee));
  RETURN v_batch;
END $$;

CREATE OR REPLACE FUNCTION public.driver_list_assigned_orders_v2()
RETURNS TABLE(assignment_id uuid,order_id uuid,order_number text,order_status public.order_status,customer_name text,
 customer_phone text,delivery_address jsonb,delivery_lat numeric,delivery_lng numeric,delivery_location_name text,
 assigned_at timestamptz,assignment_status text,items jsonb,delivery_batch_id uuid,delivery_batch_number text,
 delivery_proof_path text,otp_verified boolean,cod_collected_amount numeric,payment_method text,order_total numeric,failed_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF NOT coalesce((SELECT x.enabled FROM public.customer_driver_access x WHERE x.user_id=auth.uid()),false)
    OR NOT EXISTS(SELECT 1 FROM public.driver_applications d WHERE d.user_id=auth.uid() AND d.status='approved') THEN
    RAISE EXCEPTION 'Approved active driver access required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT a.id,o.id,o.order_number,o.order_status,o.customer_name,o.customer_phone,
    CASE WHEN a.status IN ('delivered','cancelled','failed') THEN NULL::jsonb ELSE o.shipping_address_snapshot END,
    CASE WHEN a.status IN ('delivered','cancelled','failed') THEN NULL::numeric ELSE o.delivery_lat END,
    CASE WHEN a.status IN ('delivered','cancelled','failed') THEN NULL::numeric ELSE o.delivery_lng END,
    CASE WHEN a.status IN ('delivered','cancelled','failed') THEN NULL::text ELSE o.delivery_location_name END,
    a.assigned_at,a.status,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.product_name_snapshot,'quantity',i.quantity,
      'variant',i.variant_snapshot,'vendor_fulfillment_status',i.vendor_fulfillment_status,'delivery_status',i.delivery_status)
      ORDER BY i.created_at) FROM public.order_items i
      WHERE i.order_id=o.id AND (a.delivery_batch_id IS NULL OR EXISTS(
        SELECT 1 FROM public.delivery_batch_items bi WHERE bi.batch_id=a.delivery_batch_id AND bi.order_item_id=i.id))), '[]'::jsonb),
    a.delivery_batch_id,b.batch_number,a.delivery_proof_path,(a.delivery_otp_verified_at IS NOT NULL),
    a.cod_collected_amount,o.payment_method::text,o.total,a.failed_reason
  FROM public.driver_assignments a JOIN public.orders o ON o.id=a.order_id
  LEFT JOIN public.delivery_batches b ON b.id=a.delivery_batch_id
  WHERE a.driver_user_id=auth.uid()
  ORDER BY CASE WHEN a.status IN ('delivered','cancelled','failed') THEN 1 ELSE 0 END,a.assigned_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_refund_status(p_refund_id uuid,p_status text,p_reference text DEFAULT NULL,p_admin_note text DEFAULT NULL)
RETURNS public.admin_refund_records LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE r public.admin_refund_records%ROWTYPE; v_order_total numeric; v_refunded numeric; v_original_paid numeric;
BEGIN
  IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  IF p_status NOT IN ('completed','failed','cancelled') THEN RAISE EXCEPTION 'Unsupported refund status.' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.admin_refund_records WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR r.status<>'pending' THEN RAISE EXCEPTION 'Only pending refunds can be updated.' USING ERRCODE='23514'; END IF;
  IF p_status='completed' AND r.method IN ('bank_transfer','wallet','card_gateway') AND nullif(btrim(coalesce(p_reference,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Enter the transfer or gateway reference before completing this refund.' USING ERRCODE='22023';
  END IF;
  SELECT total INTO v_order_total FROM public.orders WHERE id=r.order_id FOR UPDATE;
  UPDATE public.admin_refund_records SET status=p_status,reference=coalesce(nullif(btrim(p_reference),''),reference),
    admin_note=coalesce(nullif(btrim(p_admin_note),''),admin_note),
    completed_by=CASE WHEN p_status='completed' THEN auth.uid() ELSE NULL END,
    completed_at=CASE WHEN p_status='completed' THEN now() ELSE NULL END,updated_at=now()
  WHERE id=p_refund_id RETURNING * INTO r;
  IF p_status='completed' THEN
    SELECT coalesce(sum(amount),0) INTO v_refunded FROM public.admin_refund_records
      WHERE order_id=r.order_id AND status='completed';
    SELECT coalesce(sum(pt.amount),0) INTO v_original_paid FROM public.payment_transactions pt
      WHERE pt.order_id=r.order_id AND pt.status='paid'::public.payment_status;
    IF v_original_paid<=0 THEN
      SELECT v_order_total+coalesce(sum(amount),0) INTO v_original_paid FROM public.admin_refund_records
        WHERE order_id=r.order_id AND status IN ('pending','completed');
    END IF;
    UPDATE public.orders SET payment_status=CASE WHEN v_refunded>=v_original_paid THEN 'refunded'::public.payment_status
      ELSE 'partially_refunded'::public.payment_status END,updated_at=now()
      WHERE id=r.order_id AND payment_status IN ('paid'::public.payment_status,'partially_refunded'::public.payment_status);
  END IF;
  INSERT INTO public.admin_audit_logs(actor_id,action,entity,entity_id,details)
  VALUES(auth.uid(),'UPDATE','admin_refund_records',p_refund_id,
    jsonb_build_object('amount',r.amount,'reference',r.reference,'method',r.method));
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_refund_method(p_refund_id uuid,p_method text,p_reference text DEFAULT NULL)
RETURNS public.admin_refund_records LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE r public.admin_refund_records%ROWTYPE;
BEGIN
  IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  IF p_method NOT IN ('cash','bank_transfer','wallet','card_gateway','other') THEN RAISE EXCEPTION 'Invalid refund method.' USING ERRCODE='22023'; END IF;
  UPDATE public.admin_refund_records SET method=p_method,reference=coalesce(nullif(btrim(p_reference),''),reference),updated_at=now()
    WHERE id=p_refund_id AND status='pending' RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only pending refunds can be edited.' USING ERRCODE='22023'; END IF;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.admin_mark_order_item_stock_unavailable(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_clear_order_item_stock_unavailable(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_cancel_order_item(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_assign_driver_to_delivery_batch(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_create_combined_driver_batch(uuid[]) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_set_refund_method(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_order_item_stock_unavailable(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_order_item_stock_unavailable(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_order_item(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_driver_to_delivery_batch(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_combined_driver_batch(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_refund_method(uuid,text,text) TO authenticated;


-- Follow-up batches are free and may only contain items already marked ready.
CREATE OR REPLACE FUNCTION public.admin_create_followup_delivery_batch(
 p_order_id uuid,p_item_ids uuid[],p_expected_delivery_date date,p_delivery_window_start time,
 p_delivery_window_end time,p_delivery_note text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_order public.orders%ROWTYPE; v_batch uuid; v_has_food boolean:=false; v_reuse boolean:=false;
BEGIN
 IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' AND (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN
   RAISE EXCEPTION 'JTBazar authenticator verification is required.' USING ERRCODE='42501';
 END IF;
 IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE='42501'; END IF;
 IF p_item_ids IS NULL OR cardinality(p_item_ids)<1 OR (SELECT count(DISTINCT x) FROM unnest(p_item_ids) x)<>cardinality(p_item_ids) THEN
   RAISE EXCEPTION 'Select one or more different ready products.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR v_order.order_status IN ('cancelled'::public.order_status,'delivered'::public.order_status) THEN
   RAISE EXCEPTION 'Active order not found.' USING ERRCODE='22023';
 END IF;
 IF (SELECT count(*) FROM public.order_items oi WHERE oi.id=ANY(p_item_ids) AND oi.order_id=p_order_id
      AND oi.delivery_status='ready' AND oi.vendor_fulfillment_status<>'cancelled'
      AND oi.stock_unavailable_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.delivery_batch_items bi WHERE bi.order_item_id=oi.id))<>cardinality(p_item_ids) THEN
   RAISE EXCEPTION 'Only ready, available, unassigned products from this order can be added to a follow-up batch.' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.id=ANY(p_item_ids) AND oi.seller_id IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM public.vendor_order_pickups vp WHERE vp.order_id=oi.order_id AND vp.seller_id=oi.seller_id AND vp.status='picked_up')) THEN
   RAISE EXCEPTION 'Vendor products must be collected by JTBazar before delivery batching.' USING ERRCODE='22023';
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id
   LEFT JOIN public.categories cat ON cat.id=p.category_id
   WHERE oi.id=ANY(p_item_ids) AND (coalesce(cat.name,'') ILIKE '%food%' OR coalesce(cat.name,'') ILIKE '%grocery%' OR p.food_product_type IS NOT NULL))
 INTO v_has_food;
 IF v_has_food AND (p_expected_delivery_date IS NULL OR p_delivery_window_start IS NULL
   OR p_delivery_window_end IS NULL OR p_delivery_window_end<=p_delivery_window_start) THEN
   RAISE EXCEPTION 'Food products require a valid delivery date and time window.' USING ERRCODE='22023';
 END IF;
 SELECT dbo.batch_id INTO v_batch FROM public.delivery_batch_orders dbo
   JOIN public.delivery_batches b ON b.id=dbo.batch_id
   WHERE dbo.order_id=p_order_id AND b.status='scheduled'
     AND NOT EXISTS(SELECT 1 FROM public.delivery_batch_items bi WHERE bi.batch_id=b.id)
   ORDER BY b.created_at LIMIT 1 FOR UPDATE OF b;
 v_reuse:=v_batch IS NOT NULL;
 IF v_reuse THEN
   UPDATE public.delivery_batches SET expected_delivery_date=CASE WHEN v_has_food THEN p_expected_delivery_date ELSE NULL END,
     delivery_window_start=CASE WHEN v_has_food THEN p_delivery_window_start ELSE NULL END,
     delivery_window_end=CASE WHEN v_has_food THEN p_delivery_window_end ELSE NULL END,
     delivery_note=nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),updated_at=now() WHERE id=v_batch;
 ELSE
   -- A follow-up delivery for delayed stock never adds another delivery fee.
   INSERT INTO public.delivery_batches(customer_id,customer_phone,delivery_fee,expected_delivery_date,
     delivery_window_start,delivery_window_end,delivery_note,created_by)
   VALUES(v_order.customer_id,v_order.customer_phone,0,
     CASE WHEN v_has_food THEN p_expected_delivery_date ELSE NULL END,
     CASE WHEN v_has_food THEN p_delivery_window_start ELSE NULL END,
     CASE WHEN v_has_food THEN p_delivery_window_end ELSE NULL END,
     nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),auth.uid()) RETURNING id INTO v_batch;
   INSERT INTO public.delivery_batch_orders(batch_id,order_id,fee_allocated) VALUES(v_batch,p_order_id,0);
 END IF;
 INSERT INTO public.delivery_batch_items(batch_id,order_item_id) SELECT v_batch,unnest(p_item_ids);
 IF v_has_food THEN
   UPDATE public.orders SET expected_delivery_date=p_expected_delivery_date,delivery_window_start=p_delivery_window_start,
     delivery_window_end=p_delivery_window_end,delivery_note=nullif(left(btrim(coalesce(p_delivery_note,'')),1000),''),
     delivery_timing_confirmed_at=now(),delivery_timing_confirmed_by=auth.uid(),updated_at=now() WHERE id=p_order_id;
 END IF;
 INSERT INTO public.admin_audit_logs(actor_id,action,entity,entity_id,details)
 VALUES(auth.uid(),CASE WHEN v_reuse THEN 'UPDATE' ELSE 'INSERT' END,'delivery_batches',v_batch,
   jsonb_build_object('order_id',p_order_id,'item_ids',p_item_ids,'followup_delivery_fee',0,'food_timing_required',v_has_food));
 RETURN v_batch;
END $$;

CREATE OR REPLACE FUNCTION private.prevent_unavailable_stock_batch_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.id=NEW.order_item_id AND oi.stock_unavailable_at IS NOT NULL) THEN
   RAISE EXCEPTION 'An item marked out of stock cannot be added to a delivery batch.' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prevent_unavailable_stock_batch_item ON public.delivery_batch_items;
CREATE TRIGGER prevent_unavailable_stock_batch_item
 BEFORE INSERT OR UPDATE OF order_item_id ON public.delivery_batch_items
 FOR EACH ROW EXECUTE FUNCTION private.prevent_unavailable_stock_batch_item();

REVOKE ALL ON FUNCTION public.admin_create_followup_delivery_batch(uuid,uuid[],date,time,time,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_create_followup_delivery_batch(uuid,uuid[],date,time,time,text) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_list_assignable_driver_orders()
RETURNS TABLE(id uuid,order_number text,customer_name text,customer_phone text,order_status public.order_status,created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT o.id,o.order_number::text,o.customer_name::text,o.customer_phone::text,o.order_status,o.created_at
 FROM public.orders o
 WHERE o.order_status IN ('confirmed'::public.order_status,'processing'::public.order_status,
   'shipped'::public.order_status,'partially_delivered'::public.order_status)
   AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=o.id
     AND oi.delivery_status='ready' AND oi.vendor_fulfillment_status<>'cancelled'
     AND oi.stock_unavailable_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM public.delivery_batch_items bi WHERE bi.order_item_id=oi.id))
   AND NOT EXISTS(SELECT 1 FROM public.driver_assignments da WHERE da.order_id=o.id AND da.status IN ('assigned','picked_up'))
   AND NOT EXISTS(SELECT 1 FROM public.delivery_batch_orders bo JOIN public.delivery_batches b ON b.id=bo.batch_id
     WHERE bo.order_id=o.id AND b.status='scheduled')
 ORDER BY o.created_at DESC LIMIT 250;
END $$;


CREATE OR REPLACE FUNCTION public.admin_list_order_driver_assignments_v2(p_order_ids uuid[])
RETURNS TABLE(order_id uuid,driver_name text,driver_phone text,assignment_status text,assigned_at timestamptz,delivery_batch_number text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT DISTINCT ON (a.order_id) a.order_id,coalesce(d.full_name::text,''),coalesce(d.phone::text,''),
   a.status,a.assigned_at,b.batch_number
 FROM public.driver_assignments a
 LEFT JOIN public.driver_applications d ON d.user_id=a.driver_user_id
 LEFT JOIN public.delivery_batches b ON b.id=a.delivery_batch_id
 WHERE a.order_id=ANY(coalesce(p_order_ids,'{}'::uuid[]))
 ORDER BY a.order_id,a.assigned_at DESC,a.id DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_order_driver_assignments_v2(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_list_order_driver_assignments_v2(uuid[]) TO authenticated;


-- Retire the legacy one-assignment-per-order RPC. All assignments must target an explicit ready batch.
CREATE OR REPLACE FUNCTION public.admin_assign_driver_to_order(p_order_id uuid,p_driver_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 RAISE EXCEPTION 'Direct order assignment is retired. Create or select a ready delivery batch and assign the driver to that batch from Orders.' USING ERRCODE='0A000';
END $$;
REVOKE ALL ON FUNCTION public.admin_assign_driver_to_order(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_driver_to_order(uuid,uuid) TO authenticated;


-- A customer may have several historical assignments for one order; issue OTP only for the active picked-up batch.
CREATE OR REPLACE FUNCTION public.customer_generate_delivery_otp(p_order_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_assignment uuid; v_code text; v_bytes bytea; v_num bigint;
BEGIN
 SELECT a.id INTO v_assignment
 FROM public.driver_assignments a JOIN public.orders o ON o.id=a.order_id
 WHERE a.order_id=p_order_id AND o.customer_id=auth.uid() AND a.status='picked_up'
 ORDER BY a.assigned_at DESC,a.id DESC LIMIT 1 FOR UPDATE OF a;
 IF v_assignment IS NULL THEN
   RAISE EXCEPTION 'There is no active picked-up delivery for this order. OTP becomes available after the assigned driver picks up the parcel.' USING ERRCODE='22023';
 END IF;
 v_bytes:=extensions.gen_random_bytes(4);
 v_num:=(get_byte(v_bytes,0)::bigint*16777216+get_byte(v_bytes,1)::bigint*65536+
   get_byte(v_bytes,2)::bigint*256+get_byte(v_bytes,3)::bigint)%1000000;
 v_code:=lpad(v_num::text,6,'0');
 UPDATE public.driver_assignments SET delivery_otp_hash=encode(extensions.digest(v_code,'sha256'),'hex'),
   delivery_otp_expires_at=now()+interval '30 minutes',delivery_otp_verified_at=NULL,delivery_otp_attempts=0
 WHERE id=v_assignment;
 RETURN v_code;
END $$;
REVOKE ALL ON FUNCTION public.customer_generate_delivery_otp(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.customer_generate_delivery_otp(uuid) TO authenticated;


-- Automatically complete a batch item only after the assigned driver has both a verified customer OTP and a saved private proof photo.
CREATE OR REPLACE FUNCTION private.auto_complete_driver_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_batch_id uuid;
BEGIN
 IF NEW.status<>'picked_up' OR NEW.delivery_otp_verified_at IS NULL OR nullif(NEW.delivery_proof_path,'') IS NULL THEN
   RETURN NEW;
 END IF;
 IF OLD.status='delivered' THEN RETURN NEW; END IF;

 UPDATE public.driver_assignments
 SET status='delivered',delivered_at=coalesce(delivered_at,now())
 WHERE id=NEW.id AND status='picked_up';

 IF NOT FOUND THEN RETURN NEW; END IF;

 v_batch_id:=NEW.delivery_batch_id;
 IF v_batch_id IS NOT NULL THEN
   UPDATE public.order_items oi SET delivery_status='delivered'
   FROM public.delivery_batch_items bi
   WHERE bi.batch_id=v_batch_id AND bi.order_item_id=oi.id
     AND oi.order_id=NEW.order_id AND oi.delivery_status<>'delivered';

   IF NOT EXISTS(SELECT 1 FROM public.delivery_batch_items bi
     JOIN public.order_items oi ON oi.id=bi.order_item_id
     WHERE bi.batch_id=v_batch_id AND oi.delivery_status<>'delivered') THEN
     UPDATE public.delivery_batches SET status='delivered',updated_at=now()
       WHERE id=v_batch_id AND status IN ('scheduled','in_transit');
   ELSE
     UPDATE public.delivery_batches SET status='in_transit',updated_at=now()
       WHERE id=v_batch_id AND status='scheduled';
   END IF;
 ELSE
   UPDATE public.order_items SET delivery_status='delivered'
   WHERE order_id=NEW.order_id AND delivery_status='ready';
 END IF;

 INSERT INTO public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
 VALUES(NEW.id,NEW.order_id,NEW.driver_user_id,'delivered')
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS driver_assignment_auto_complete_delivery ON public.driver_assignments;
CREATE TRIGGER driver_assignment_auto_complete_delivery
 AFTER UPDATE OF delivery_proof_path,delivery_otp_verified_at ON public.driver_assignments
 FOR EACH ROW
 WHEN (NEW.status='picked_up' AND NEW.delivery_otp_verified_at IS NOT NULL AND NEW.delivery_proof_path IS NOT NULL)
 EXECUTE FUNCTION private.auto_complete_driver_assignment();

-- The driver no longer presses a separate "Complete delivery" action; the proof/OTP trigger is authoritative.
CREATE OR REPLACE FUNCTION public.driver_update_delivery_status(p_assignment_id uuid,p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_status text;
BEGIN
 IF NOT coalesce((SELECT a.enabled FROM public.customer_driver_access a WHERE a.user_id=auth.uid()),false)
   OR NOT EXISTS(SELECT 1 FROM public.driver_applications d WHERE d.user_id=auth.uid() AND d.status='approved') THEN
   RAISE EXCEPTION 'Approved active driver access required' USING ERRCODE='42501';
 END IF;
 IF p_action='delivered' THEN
   RAISE EXCEPTION 'Delivery completes automatically after both OTP verification and delivery proof are saved.' USING ERRCODE='0A000';
 END IF;
 IF p_action<>'picked_up' THEN RAISE EXCEPTION 'Invalid delivery action.' USING ERRCODE='22023'; END IF;
 SELECT status INTO v_status FROM public.driver_assignments
 WHERE id=p_assignment_id AND driver_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Assigned delivery not found.' USING ERRCODE='42501'; END IF;
 IF v_status<>'assigned' THEN RAISE EXCEPTION 'Only assigned deliveries can be picked up.' USING ERRCODE='22023'; END IF;
 UPDATE public.driver_assignments SET status='picked_up',picked_up_at=coalesce(picked_up_at,now())
 WHERE id=p_assignment_id;
 INSERT INTO public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
 SELECT id,order_id,auth.uid(),'picked_up' FROM public.driver_assignments WHERE id=p_assignment_id
 ON CONFLICT DO NOTHING;
 UPDATE public.delivery_batches SET status='in_transit',updated_at=now()
 WHERE id=(SELECT delivery_batch_id FROM public.driver_assignments WHERE id=p_assignment_id)
   AND status='scheduled';
END $$;
REVOKE ALL ON FUNCTION public.driver_update_delivery_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_update_delivery_status(uuid,text) TO authenticated;
