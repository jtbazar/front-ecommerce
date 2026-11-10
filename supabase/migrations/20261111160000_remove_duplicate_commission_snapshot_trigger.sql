DROP TRIGGER IF EXISTS capture_order_item_commission_snapshot ON public.order_items;
DROP FUNCTION IF EXISTS public.capture_order_item_commission_snapshot();
COMMENT ON COLUMN public.order_items.vendor_base_price_snapshot IS
  'Vendor base price captured by the existing private.snapshot_order_item_commission trigger. NULL on legacy rows means historical value is unknown and must not be inferred from current product settings.';
COMMENT ON COLUMN public.order_items.commission_percent_snapshot IS
  'Commission percentage captured by the existing private.snapshot_order_item_commission trigger. NULL on legacy rows means historical value is unknown and must not be inferred from current settings.';
COMMENT ON COLUMN public.order_items.commission_amount_snapshot IS
  'Commission amount captured by the existing private.snapshot_order_item_commission trigger. NULL on legacy rows means historical value is unknown and must not be inferred from current settings.';
