CREATE OR REPLACE FUNCTION public.admin_list_vendor_settlement_balances()
RETURNS TABLE(seller_id uuid, shop_name text, eligible_items bigint, eligible_amount numeric, paid_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_role('admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT
      oi.seller_id,
      count(*) AS item_count,
      round(sum(oi.vendor_base_price_snapshot * oi.quantity), 2) AS eligible_amount
    FROM public.order_items AS oi
    JOIN public.orders AS o ON o.id = oi.order_id
    WHERE oi.seller_id IS NOT NULL
      AND o.order_status = 'delivered'::public.order_status
      AND o.payment_status = 'paid'::public.payment_status
      AND oi.vendor_base_price_snapshot IS NOT NULL
      AND oi.commission_amount_snapshot IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.vendor_settlement_items AS si
        WHERE si.order_item_id = oi.id
      )
    GROUP BY oi.seller_id
  ), paid AS (
    SELECT
      batches.seller_id,
      round(sum(batches.amount), 2) AS amount
    FROM public.vendor_settlement_batches AS batches
    WHERE batches.status = 'paid'
    GROUP BY batches.seller_id
  )
  SELECT
    sp.id,
    sp.shop_name,
    coalesce(eligible.item_count, 0),
    coalesce(eligible.eligible_amount, 0),
    coalesce(paid.amount, 0)
  FROM public.seller_profiles AS sp
  LEFT JOIN eligible ON eligible.seller_id = sp.id
  LEFT JOIN paid ON paid.seller_id = sp.id
  WHERE coalesce(eligible.item_count, 0) > 0
     OR coalesce(paid.amount, 0) > 0
  ORDER BY coalesce(eligible.eligible_amount, 0) DESC, sp.shop_name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_vendor_settlement_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_vendor_settlement_balances() TO authenticated;
