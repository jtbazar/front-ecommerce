BEGIN;

CREATE OR REPLACE FUNCTION public.admin_mark_vendor_picked_up(p_pickup_id uuid)
RETURNS public.vendor_order_pickups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_pickup public.vendor_order_pickups;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role'
     AND (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2'
     AND (private.has_role('admin'::public.app_role) OR private.has_verified_totp_factor()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JTBazar authenticator verification is required.';
  END IF;

  IF NOT private.has_role('admin'::public.app_role) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Administrator access required.';
  END IF;

  UPDATE public.vendor_order_pickups
     SET status = 'picked_up',
         picked_up_at = now(),
         updated_at = now()
   WHERE id = p_pickup_id
     AND status = 'ready_for_pickup'
   RETURNING * INTO v_pickup;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Pickup is not marked ready by the vendor.';
  END IF;

  -- Collection by JTBazar is the hand-off point to the delivery workflow.
  -- Only collected, active vendor items with no stock hold become delivery-ready.
  UPDATE public.order_items
     SET delivery_status = 'ready'
   WHERE order_id = v_pickup.order_id
     AND seller_id = v_pickup.seller_id
     AND delivery_status = 'pending'
     AND vendor_fulfillment_status <> 'cancelled'
     AND stock_unavailable_at IS NULL;

  RETURN v_pickup;
END;
$function$;

-- Repair existing pickups that were already collected before this transition
-- was wired into the collection RPC. Do not alter delivered/cancelled or stock-held items.
UPDATE public.order_items AS oi
   SET delivery_status = 'ready'
  FROM public.vendor_order_pickups AS vp
 WHERE vp.order_id = oi.order_id
   AND vp.seller_id = oi.seller_id
   AND vp.status = 'picked_up'
   AND oi.delivery_status = 'pending'
   AND oi.vendor_fulfillment_status <> 'cancelled'
   AND oi.stock_unavailable_at IS NULL;

COMMIT;
