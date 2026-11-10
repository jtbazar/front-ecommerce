-- Capture commission inputs on each newly inserted marketplace order line.
-- Existing NULL snapshots are intentionally preserved as historical/unknown values.
CREATE OR REPLACE FUNCTION public.capture_order_item_commission_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  product_row public.products%ROWTYPE;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.* INTO product_row FROM public.products AS p WHERE p.id = NEW.product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Order item product does not exist.';
  END IF;

  NEW.vendor_base_price_snapshot := product_row.vendor_base_price;
  NEW.commission_percent_snapshot := product_row.commission_percent;
  NEW.commission_amount_snapshot := product_row.commission_amount;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS capture_order_item_commission_snapshot ON public.order_items;
CREATE TRIGGER capture_order_item_commission_snapshot
BEFORE INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.capture_order_item_commission_snapshot();

COMMENT ON COLUMN public.order_items.vendor_base_price_snapshot IS
  'Vendor base price captured at order insertion. NULL on legacy rows means historical value is unknown and must not be inferred from current product settings.';
COMMENT ON COLUMN public.order_items.commission_percent_snapshot IS
  'Commission percentage captured at order insertion. NULL on legacy rows means historical value is unknown and must not be inferred from current settings.';
COMMENT ON COLUMN public.order_items.commission_amount_snapshot IS
  'Commission amount captured at order insertion. NULL on legacy rows means historical value is unknown and must not be inferred from current settings.';

REVOKE EXECUTE ON FUNCTION public.capture_order_item_commission_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_marketplace_return_window() FROM PUBLIC, anon, authenticated;
