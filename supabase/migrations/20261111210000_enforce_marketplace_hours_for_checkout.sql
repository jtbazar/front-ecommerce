-- Enforce the configured Asia/Karachi marketplace schedule on customer
-- checkout. The shared place_order RPC sets jtbazar.checkout_items before
-- inserting order_items, so this guard covers Android and website checkouts
-- while leaving admin/manual order workflows unchanged.
CREATE OR REPLACE FUNCTION private.marketplace_is_open_at(p_instant timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v_hours jsonb;
  v_local timestamp without time zone;
  v_day jsonb;
  v_previous_day jsonb;
  v_open time;
  v_close time;
  v_offset integer;
  v_start timestamp without time zone;
  v_end timestamp without time zone;
BEGIN
  SELECT s.marketplace_hours INTO v_hours
  FROM public.store_settings AS s
  WHERE s.id = 'default';

  IF NOT FOUND OR pg_catalog.jsonb_typeof(v_hours) <> 'object' THEN
    RETURN false;
  END IF;

  v_local := p_instant AT TIME ZONE 'Asia/Karachi';
  v_day := v_hours -> pg_catalog.lower(pg_catalog.to_char(v_local, 'FMDay'));

  IF COALESCE((v_day ->> 'enabled')::boolean, false) THEN
    v_open := NULLIF(v_day ->> 'open', '')::time;
    v_close := NULLIF(v_day ->> 'close', '')::time;
    v_offset := GREATEST(COALESCE(NULLIF(v_day ->> 'close_day_offset', '')::integer, 0), 0);

    IF v_open IS NOT NULL AND v_close IS NOT NULL THEN
      IF v_close <= v_open AND v_offset = 0 THEN v_offset := 1; END IF;
      v_start := pg_catalog.date_trunc('day', v_local) + v_open;
      v_end := pg_catalog.date_trunc('day', v_local) + v_close + pg_catalog.make_interval(days => v_offset);
      IF v_local >= v_start AND v_local < v_end THEN RETURN true; END IF;
    END IF;
  END IF;

  v_previous_day := v_hours -> pg_catalog.lower(pg_catalog.to_char(v_local - interval '1 day', 'FMDay'));
  IF COALESCE((v_previous_day ->> 'enabled')::boolean, false) THEN
    v_open := NULLIF(v_previous_day ->> 'open', '')::time;
    v_close := NULLIF(v_previous_day ->> 'close', '')::time;
    v_offset := GREATEST(COALESCE(NULLIF(v_previous_day ->> 'close_day_offset', '')::integer, 0), 0);

    IF v_open IS NOT NULL AND v_close IS NOT NULL THEN
      IF v_close <= v_open AND v_offset = 0 THEN v_offset := 1; END IF;
      v_start := pg_catalog.date_trunc('day', v_local - interval '1 day') + v_open;
      v_end := pg_catalog.date_trunc('day', v_local - interval '1 day') + v_close + pg_catalog.make_interval(days => v_offset);
      IF v_local >= v_start AND v_local < v_end THEN RETURN true; END IF;
    END IF;
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION private.enforce_marketplace_hours_for_checkout()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF NULLIF(pg_catalog.current_setting('jtbazar.checkout_items', true), '') IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT private.marketplace_is_open_at(pg_catalog.now()) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'JTBazar marketplace is currently closed. Please place your order during opening hours.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.marketplace_is_open_at(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.enforce_marketplace_hours_for_checkout() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS order_items_enforce_marketplace_hours ON public.order_items;
CREATE TRIGGER order_items_enforce_marketplace_hours
BEFORE INSERT ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION private.enforce_marketplace_hours_for_checkout();
