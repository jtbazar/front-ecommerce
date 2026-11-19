CREATE OR REPLACE FUNCTION public.customer_list_delivery_otp_orders(p_order_ids uuid[])
RETURNS TABLE(order_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.id
  FROM public.orders o
  WHERE o.customer_id = auth.uid()
    AND o.id = ANY(COALESCE(p_order_ids, ARRAY[]::uuid[]))
    AND EXISTS (
      SELECT 1
      FROM public.driver_assignments a
      WHERE a.order_id = o.id
        AND a.status = 'picked_up'
    );
$$;

REVOKE ALL ON FUNCTION public.customer_list_delivery_otp_orders(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_list_delivery_otp_orders(uuid[]) TO authenticated;
