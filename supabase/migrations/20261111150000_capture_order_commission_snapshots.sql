-- The private.snapshot_order_item_commission trigger already captures all three
-- commission values for new order_items. Keep historical NULLs intact: old
-- product rows do not provide reliable historical pricing/commission evidence.
-- This migration documents the legacy treatment and removes a duplicate
-- public-schema trigger that was superseded by the private trigger.
DROP TRIGGER IF EXISTS capture_order_item_commission_snapshot ON public.order_items;
DROP FUNCTION IF EXISTS public.capture_order_item_commission_snapshot();

COMMENT ON COLUMN public.order_items.vendor_base_price_snapshot IS
  'Vendor base price captured by private.snapshot_order_item_commission. NULL on legacy rows means historical value is unknown and must not be inferred from current product settings.';
COMMENT ON COLUMN public.order_items.commission_percent_snapshot IS
  'Commission percentage captured by private.snapshot_order_item_commission. NULL on legacy rows means historical value is unknown and must not be inferred from current settings.';
COMMENT ON COLUMN public.order_items.commission_amount_snapshot IS
  'Commission amount captured by private.snapshot_order_item_commission. NULL on legacy rows means historical value is unknown and must not be inferred from current settings.';

REVOKE EXECUTE ON FUNCTION public.enforce_marketplace_return_window() FROM PUBLIC, anon, authenticated;
