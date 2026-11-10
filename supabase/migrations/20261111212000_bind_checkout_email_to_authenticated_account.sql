-- Customer order email is derived from the authenticated Supabase account.
-- Do not trust a free-text email supplied by a client for order notifications.
CREATE OR REPLACE FUNCTION public.place_order(p_customer_name text, p_customer_phone text, p_customer_email text, p_shipping_address jsonb, p_items jsonb, p_idempotency_key text, p_customer_note text DEFAULT NULL::text, p_delivery_lat numeric DEFAULT NULL::numeric, p_delivery_lng numeric DEFAULT NULL::numeric, p_delivery_location_name text DEFAULT NULL::text, p_delivery_location_captured_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  line record;
  product_lock_id uuid;
  product_row public.products%ROWTYPE;
  seller_row public.seller_profiles%ROWTYPE;
  inventory_row public.product_inventory%ROWTYPE;
  v_buyer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_item_quantity integer;
  v_item_price numeric(12, 2);
  v_variant_sku text;
  v_variant_snapshot jsonb;
  v_subtotal numeric(16, 2) := 0;
  v_delivery_fee numeric(16, 2) := 250;
  v_cod_enabled boolean := true;
  v_free_delivery_enabled boolean := false;
  v_seller record;
BEGIN
  IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' AND (auth.jwt() ->> 'aal') IS DISTINCT FROM 'aal2' AND (private.has_role('admin'::public.app_role) OR private.has_verified_totp_factor()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'JTBazar authenticator verification is required.';
  END IF;
  v_buyer_id := (SELECT auth.uid());
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in before placing an order.';
  END IF;

  IF p_customer_name IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_customer_name)) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A valid customer name is required.';
  END IF;
  IF p_customer_phone IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_customer_phone)) NOT BETWEEN 7 AND 32 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A valid customer phone number is required.';
  END IF;
  IF p_customer_email IS NOT NULL AND pg_catalog.btrim(p_customer_email) <> ''
     AND p_customer_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A valid customer email is required.';
  END IF;
  IF p_shipping_address IS NULL OR pg_catalog.jsonb_typeof(p_shipping_address) <> 'object'
     OR NULLIF(pg_catalog.btrim(p_shipping_address ->> 'address_line_1'), '') IS NULL
     OR NULLIF(pg_catalog.btrim(p_shipping_address ->> 'city'), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A complete shipping address is required.';
  END IF;
  IF pg_catalog.octet_length(p_shipping_address::text) > 20000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The shipping address is too long.';
  END IF;
  IF p_idempotency_key IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A valid checkout key is required.';
  END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR pg_catalog.jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Between one and fifty order lines are required.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_items) AS input_line(product_id uuid, variant_id uuid, quantity integer)
    WHERE input_line.product_id IS NULL
       OR input_line.quantity IS NULL
       OR input_line.quantity NOT BETWEEN 1 AND 99
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Order lines require a product and a quantity between one and ninety-nine.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_items) AS input_line(product_id uuid, variant_id uuid, quantity integer)
    GROUP BY input_line.product_id, input_line.variant_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Duplicate order lines are not accepted.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_buyer_id::text || ':' || pg_catalog.btrim(p_idempotency_key), 0)
  );

  SELECT o.id INTO v_order_id
  FROM public.orders AS o
  WHERE o.customer_id = v_buyer_id
    AND o.idempotency_key = pg_catalog.btrim(p_idempotency_key);

  IF v_order_id IS NOT NULL THEN
    RETURN QUERY
    SELECT o.id, o.order_number, o.subtotal, o.delivery_fee, o.total
    FROM public.orders AS o
    WHERE o.id = v_order_id;
    RETURN;
  END IF;

  SELECT s.delivery_fee, s.cod_enabled, s.free_delivery_enabled
  INTO v_delivery_fee, v_cod_enabled, v_free_delivery_enabled
  FROM public.store_settings AS s
  WHERE s.id = 'default';

  IF NOT FOUND THEN
    v_delivery_fee := 250;
    v_cod_enabled := true;
    v_free_delivery_enabled := false;
  END IF;
  IF v_free_delivery_enabled THEN
    v_delivery_fee := 0;
  END IF;
  IF NOT v_cod_enabled THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Cash on delivery is currently unavailable.';
  END IF;

  FOR product_lock_id IN
    SELECT DISTINCT input_line.product_id
    FROM pg_catalog.jsonb_to_recordset(p_items) AS input_line(product_id uuid, variant_id uuid, quantity integer)
    ORDER BY input_line.product_id
  LOOP
    PERFORM 1 FROM public.products AS p WHERE p.id = product_lock_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An order product was not found.';
    END IF;
  END LOOP;

  FOR line IN
    SELECT *
    FROM pg_catalog.jsonb_to_recordset(p_items) AS input_line(product_id uuid, variant_id uuid, quantity integer)
  LOOP
    SELECT * INTO product_row FROM public.products AS p WHERE p.id = line.product_id;

    IF product_row.publication_status <> 'published'::public.publication_status THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An order product is no longer published.';
    END IF;
    IF product_row.moderation_status <> 'approved' OR product_row.stock_verification_status = 'paused' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An order product is not currently available.';
    END IF;
    IF product_row.currency <> 'PKR' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'The product currency does not match the store currency.';
    END IF;

    IF product_row.seller_id IS NOT NULL THEN
      SELECT * INTO seller_row FROM public.seller_profiles AS s WHERE s.id = product_row.seller_id;
      IF NOT FOUND OR seller_row.status <> 'approved' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'An order product seller is not currently approved.';
      END IF;
    END IF;

    IF line.variant_id IS NOT NULL THEN
      PERFORM 1 FROM public.product_variants AS v
      WHERE v.id = line.variant_id AND v.product_id = product_row.id AND v.is_active
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A selected product variant is unavailable.';
      END IF;
      v_item_price := NULL;
      v_variant_snapshot := NULL;
      v_variant_sku := NULL;
      SELECT COALESCE(v.price_override, product_row.price),
             pg_catalog.jsonb_build_object('label', v.option_label, 'value', v.option_value, 'attributes', v.attributes),
             v.sku
      INTO v_item_price, v_variant_snapshot, v_variant_sku
      FROM public.product_variants AS v
      WHERE v.id = line.variant_id AND v.product_id = product_row.id AND v.is_active;
      IF v_item_price IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A selected product variant is unavailable.';
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.product_variants AS v
        WHERE v.product_id = product_row.id AND v.is_active
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A product variant must be selected.';
      END IF;
      v_item_price := product_row.price;
      v_variant_snapshot := '{}'::jsonb;
      v_variant_sku := NULL;
    END IF;

    v_item_quantity := line.quantity;

    IF product_row.track_inventory THEN
      SELECT * INTO inventory_row
      FROM public.product_inventory AS i
      WHERE i.product_id = product_row.id
        AND i.variant_id IS NOT DISTINCT FROM line.variant_id
      FOR UPDATE;
      IF NOT FOUND OR inventory_row.quantity < v_item_quantity THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Insufficient product availability.';
      END IF;
    END IF;

    v_subtotal := v_subtotal + (v_item_price * v_item_quantity);
  END LOOP;

  INSERT INTO public.orders (
    customer_id, customer_name, customer_phone, customer_email,
    shipping_address_snapshot, customer_note, currency, subtotal,
    delivery_fee, payment_method, payment_status, order_status,
    delivery_lat, delivery_lng, delivery_location_name, delivery_location_captured_at,
    idempotency_key
  ) VALUES (
    v_buyer_id,
    pg_catalog.btrim(p_customer_name),
    pg_catalog.btrim(p_customer_phone),
    (SELECT u.email FROM auth.users AS u WHERE u.id = v_buyer_id),
    p_shipping_address,
    NULLIF(pg_catalog.btrim(COALESCE(p_customer_note, '')), ''),
    'PKR',
    v_subtotal,
    v_delivery_fee,
    'cod'::public.payment_method,
    'pending'::public.payment_status,
    'pending'::public.order_status,
    p_delivery_lat,
    p_delivery_lng,
    NULLIF(pg_catalog.btrim(COALESCE(p_delivery_location_name, '')), ''),
    p_delivery_location_captured_at,
    pg_catalog.btrim(p_idempotency_key)
  )
  RETURNING id, orders.order_number INTO v_order_id, v_order_number;

  PERFORM pg_catalog.set_config('paperloom.inventory_movement_type', 'sale', true);
  PERFORM pg_catalog.set_config('paperloom.inventory_reference_id', v_order_id::text, true);
  PERFORM pg_catalog.set_config('jtbazar.checkout_items', p_items::text, true);

  FOR line IN
    SELECT *
    FROM pg_catalog.jsonb_to_recordset(p_items) AS input_line(product_id uuid, variant_id uuid, quantity integer)
  LOOP
    SELECT * INTO product_row FROM public.products AS p WHERE p.id = line.product_id;

    IF line.variant_id IS NOT NULL THEN
      SELECT COALESCE(v.price_override, product_row.price),
             pg_catalog.jsonb_build_object('label', v.option_label, 'value', v.option_value, 'attributes', v.attributes),
             v.sku
      INTO v_item_price, v_variant_snapshot, v_variant_sku
      FROM public.product_variants AS v
      WHERE v.id = line.variant_id AND v.product_id = product_row.id AND v.is_active;
    ELSE
      v_item_price := product_row.price;
      v_variant_snapshot := '{}'::jsonb;
      v_variant_sku := NULL;
    END IF;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, seller_id, seller_name_snapshot,
      product_name_snapshot, sku_snapshot, variant_snapshot, product_snapshot,
      quantity, unit_price
    ) VALUES (
      v_order_id,
      product_row.id,
      line.variant_id,
      product_row.seller_id,
      (SELECT s.shop_name FROM public.seller_profiles AS s WHERE s.id = product_row.seller_id),
      product_row.name,
      COALESCE(v_variant_sku, product_row.sku),
      v_variant_snapshot,
      pg_catalog.jsonb_build_object(
        'slug', product_row.slug,
        'short_description', product_row.short_description,
        'currency', product_row.currency
      ),
      line.quantity,
      v_item_price
    );

    IF product_row.track_inventory THEN
      UPDATE public.product_inventory AS i
      SET quantity = i.quantity - line.quantity
      WHERE i.product_id = product_row.id
        AND i.variant_id IS NOT DISTINCT FROM line.variant_id;
    END IF;
  END LOOP;

  INSERT INTO public.notifications (user_id, kind, title, body, related_order_id)
  VALUES (
    v_buyer_id,
    'order',
    'Order ' || v_order_number || ' received',
    'We received your cash-on-delivery order. Track its status from your account.',
    v_order_id
  );

  FOR v_seller IN
    SELECT DISTINCT s.user_id, s.shop_name
    FROM public.order_items AS oi
    JOIN public.seller_profiles AS s ON s.id = oi.seller_id
    WHERE oi.order_id = v_order_id
  LOOP
    INSERT INTO public.notifications (user_id, kind, title, body, related_order_id)
    VALUES (
      v_seller.user_id,
      'order',
      'New order for ' || v_seller.shop_name,
      'A buyer placed order ' || v_order_number || '. Review the items in your seller dashboard.',
      v_order_id
    );
  END LOOP;

  RETURN QUERY
  SELECT o.id, o.order_number, o.subtotal, o.delivery_fee, o.total FROM public.orders o WHERE o.id = v_order_id;
END;
$function$

