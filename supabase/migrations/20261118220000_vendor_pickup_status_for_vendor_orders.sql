BEGIN;

-- Expose only the current approved vendor's pickup status for its own orders.
-- This keeps the vendor order page in sync with the separate pickup workflow.
CREATE OR REPLACE FUNCTION public.vendor_list_order_pickup_statuses(p_order_ids uuid[])
RETURNS TABLE(order_id uuid, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  seller_id_value uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in as an approved seller to view pickup status.';
  END IF;

  SELECT s.id
    INTO seller_id_value
  FROM public.seller_profiles AS s
  WHERE s.user_id = (SELECT auth.uid())
    AND s.status = 'approved'
    AND s.vendor_locked = false;

  IF seller_id_value IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'An approved and enabled seller account is required.';
  END IF;

  RETURN QUERY
  SELECT vp.order_id, vp.status::text
  FROM public.vendor_order_pickups AS vp
  WHERE vp.seller_id = seller_id_value
    AND vp.order_id = ANY(COALESCE(p_order_ids, ARRAY[]::uuid[]));
END;
$$;

REVOKE ALL ON FUNCTION public.vendor_list_order_pickup_statuses(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_list_order_pickup_statuses(uuid[]) TO authenticated, service_role;

COMMIT;
