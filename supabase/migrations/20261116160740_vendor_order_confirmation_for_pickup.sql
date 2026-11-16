BEGIN;

CREATE OR REPLACE FUNCTION public.vendor_order_items_page_v2(
  p_limit integer DEFAULT 12,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  order_id uuid,
  order_number text,
  shop_name text,
  customer_name text,
  customer_phone text,
  shipping_address_snapshot jsonb,
  delivery_lat numeric,
  delivery_lng numeric,
  delivery_location_name text,
  payment_method text,
  order_created_at timestamptz,
  product_name_snapshot text,
  product_image_url text,
  sku_snapshot text,
  variant_snapshot jsonb,
  quantity integer,
  unit_price numeric,
  line_total numeric,
  vendor_fulfillment_status text,
  tracking_number text,
  tracking_url text,
  vendor_note text,
  vendor_updated_at timestamptz,
  created_at timestamptz,
  order_confirmation_status text,
  total_orders bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  seller_id_value uuid;
  search_value text := NULLIF(pg_catalog.left(pg_catalog.btrim(p_search), 100), '');
  page_size integer := LEAST(15, GREATEST(1, COALESCE(p_limit, 12)));
  page_offset integer := GREATEST(0, COALESCE(p_offset, 0));
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role'
     AND (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2'
     AND (private.has_role('admin'::public.app_role) OR private.has_verified_totp_factor()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JTBazar authenticator verification is required.';
  END IF;

  SELECT s.id INTO seller_id_value
  FROM public.seller_profiles AS s
  WHERE s.user_id = (SELECT auth.uid()) AND s.status = 'approved';
  IF seller_id_value IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'An approved seller account is required.';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pending', 'delivered', 'not_delivered') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid delivery status filter.';
  END IF;

  RETURN QUERY
  WITH matched_orders AS (
    SELECT o.id, o.created_at
    FROM public.order_items AS oi
    JOIN public.orders AS o ON o.id = oi.order_id
    WHERE oi.seller_id = seller_id_value
      AND (
        p_status IS NULL
        OR (p_status = 'pending' AND o.order_status::text IN ('pending', 'confirmed'))
        OR (p_status = 'delivered' AND o.order_status::text = 'delivered')
        OR (p_status = 'not_delivered' AND o.order_status::text NOT IN ('delivered'))
      )
      AND (
        search_value IS NULL
        OR o.order_number ILIKE '%' || search_value || '%'
        OR EXISTS (
          SELECT 1
          FROM public.order_items AS searched_item
          WHERE searched_item.order_id = o.id
            AND searched_item.seller_id = seller_id_value
            AND searched_item.product_name_snapshot ILIKE '%' || search_value || '%'
        )
      )
    GROUP BY o.id, o.created_at
  ),
  paged_orders AS (
    SELECT matched_orders.id, matched_orders.created_at,
           pg_catalog.count(*) OVER () AS total_orders
    FROM matched_orders
    ORDER BY matched_orders.created_at DESC, matched_orders.id DESC
    LIMIT page_size OFFSET page_offset
  )
  SELECT
    oi.id, oi.order_id, o.order_number, seller.shop_name,
    NULL::text, NULL::text, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::text, NULL::text,
    o.created_at, oi.product_name_snapshot,
    (SELECT pi.image_url FROM public.product_images AS pi
     WHERE pi.product_id = oi.product_id
     ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC
     LIMIT 1),
    oi.sku_snapshot, oi.variant_snapshot,
    oi.quantity, oi.unit_price, oi.line_total,
    CASE
      WHEN o.order_status::text IN ('pending', 'confirmed') THEN 'pending'
      WHEN o.order_status::text = 'delivered' THEN 'delivered'
      WHEN o.order_status::text = 'cancelled' THEN 'cancelled'
      ELSE 'processing'
    END,
    NULL::text, NULL::text, NULL::text, oi.vendor_updated_at, oi.created_at,
    o.confirmation_status::text,
    paged.total_orders
  FROM paged_orders AS paged
  JOIN public.orders AS o ON o.id = paged.id
  JOIN public.order_items AS oi ON oi.order_id = o.id AND oi.seller_id = seller_id_value
  JOIN public.seller_profiles AS seller ON seller.id = seller_id_value
  ORDER BY paged.created_at DESC, o.order_number DESC, oi.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.vendor_order_items_page_v2(integer, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_order_items_page_v2(integer, integer, text, text)
  TO authenticated, service_role;

COMMIT;
