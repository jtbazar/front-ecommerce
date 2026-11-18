-- COD shown to a driver must cover only the order items in that driver's
-- delivery batch plus this order's allocated delivery fee. Never expose the
-- full order total for a partial delivery.
CREATE OR REPLACE FUNCTION public.driver_list_assigned_orders_v2()
RETURNS TABLE(
  assignment_id uuid,
  order_id uuid,
  order_number text,
  order_status public.order_status,
  customer_name text,
  customer_phone text,
  delivery_address jsonb,
  delivery_lat numeric,
  delivery_lng numeric,
  delivery_location_name text,
  assigned_at timestamptz,
  assignment_status text,
  items jsonb,
  delivery_batch_id uuid,
  delivery_batch_number text,
  delivery_proof_path text,
  otp_verified boolean,
  cod_collected_amount numeric,
  payment_method text,
  order_total numeric,
  failed_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
    a.cod_collected_amount,o.payment_method::text,
    CASE WHEN a.delivery_batch_id IS NULL THEN o.total
      ELSE coalesce((SELECT sum(i.line_total) FROM public.delivery_batch_items bi
        JOIN public.order_items i ON i.id=bi.order_item_id
        WHERE bi.batch_id=a.delivery_batch_id AND i.order_id=o.id),0)
        + coalesce((SELECT bo.fee_allocated FROM public.delivery_batch_orders bo
          WHERE bo.batch_id=a.delivery_batch_id AND bo.order_id=o.id),0)
    END,
    a.failed_reason
  FROM public.driver_assignments a
  JOIN public.orders o ON o.id=a.order_id
  LEFT JOIN public.delivery_batches b ON b.id=a.delivery_batch_id
  WHERE a.driver_user_id=auth.uid()
  ORDER BY CASE WHEN a.status IN ('delivered','cancelled','failed') THEN 1 ELSE 0 END,a.assigned_at DESC;
END
$function$;

-- Enforce the same batch-scoped ceiling at write time. A driver cannot record
-- COD for items that are still in another/pending delivery batch, and cannot
-- overwrite an already-recorded collection.
CREATE OR REPLACE FUNCTION public.driver_record_cod_collection(p_assignment_id uuid, p_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order_id uuid;
  v_status text;
  v_method public.payment_method;
  v_total numeric;
  v_verified timestamptz;
  v_proof text;
  v_batch_id uuid;
  v_existing_collected_at timestamptz;
BEGIN
  IF NOT coalesce((SELECT a.enabled FROM public.customer_driver_access a WHERE a.user_id=auth.uid()),false)
     OR NOT EXISTS(SELECT 1 FROM public.driver_applications d WHERE d.user_id=auth.uid() AND d.status='approved') THEN
    RAISE EXCEPTION 'Approved active driver access required' USING ERRCODE='42501';
  END IF;

  SELECT a.order_id,a.status,o.payment_method,a.delivery_otp_verified_at,a.delivery_proof_path,
         a.delivery_batch_id,a.cod_collected_at
    INTO v_order_id,v_status,v_method,v_verified,v_proof,v_batch_id,v_existing_collected_at
  FROM public.driver_assignments a
  JOIN public.orders o ON o.id=a.order_id
  WHERE a.id=p_assignment_id AND a.driver_user_id=auth.uid()
  FOR UPDATE OF a;

  IF v_order_id IS NULL THEN RAISE EXCEPTION 'Assigned delivery not found' USING ERRCODE='42501'; END IF;
  IF v_method <> 'cod' THEN RAISE EXCEPTION 'Cash collection is only available for COD orders' USING ERRCODE='22023'; END IF;
  IF v_status <> 'delivered' OR v_verified IS NULL OR nullif(v_proof,'') IS NULL THEN
    RAISE EXCEPTION 'Verified delivery and photo proof are required before COD collection' USING ERRCODE='22023';
  END IF;
  IF v_existing_collected_at IS NOT NULL THEN
    RAISE EXCEPTION 'COD has already been recorded for this delivery batch. Contact admin for reconciliation.' USING ERRCODE='23505';
  END IF;

  IF v_batch_id IS NULL THEN
    SELECT o.total INTO v_total FROM public.orders o WHERE o.id=v_order_id;
  ELSE
    SELECT coalesce((SELECT sum(i.line_total)
      FROM public.delivery_batch_items bi
      JOIN public.order_items i ON i.id=bi.order_item_id
      WHERE bi.batch_id=v_batch_id AND i.order_id=v_order_id),0)
      + coalesce((SELECT bo.fee_allocated FROM public.delivery_batch_orders bo
        WHERE bo.batch_id=v_batch_id AND bo.order_id=v_order_id),0)
    INTO v_total;
  END IF;

  IF p_amount IS NULL OR p_amount < 0 OR p_amount > v_total THEN
    RAISE EXCEPTION 'Collected amount must be between zero and this delivery batch COD total (%)',v_total USING ERRCODE='22023';
  END IF;

  UPDATE public.driver_assignments
  SET cod_collected_amount=p_amount,cod_collected_at=now()
  WHERE id=p_assignment_id;

  INSERT INTO public.driver_delivery_events(assignment_id,order_id,driver_user_id,event_type)
  VALUES(p_assignment_id,v_order_id,auth.uid(),'cod_collected');
END
$function$;
