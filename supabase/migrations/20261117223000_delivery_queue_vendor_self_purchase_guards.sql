-- Make one-order batches assignable from the normal rider queue, while keeping
-- genuinely combined batches in the batch selector. Also block vendors from
-- checking out their own products in both order creation entry points.
DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='admin_list_assignable_driver_orders' AND p.pronargs=0;
  v_old := 'and not exists(select 1 from public.delivery_batch_orders bo join public.delivery_batches b on b.id=bo.batch_id where bo.order_id=o.id and b.status=''scheduled'')';
  v_new := 'and not exists(select 1 from public.delivery_batch_orders bo join public.delivery_batches b on b.id=bo.batch_id where bo.order_id=o.id and b.status=''scheduled'' and (select count(*) from public.delivery_batch_orders bo_count where bo_count.batch_id=b.id)>1)';
  IF v_def IS NULL THEN RAISE EXCEPTION 'admin_list_assignable_driver_orders() not found'; END IF;
  IF position(v_old in v_def)>0 THEN
    EXECUTE replace(v_def,v_old,v_new);
  ELSIF position(v_new in v_def)=0 THEN
    RAISE EXCEPTION 'Unexpected admin_list_assignable_driver_orders() definition';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='admin_list_assignable_delivery_batches' AND p.pronargs=0;
  v_old := 'having bool_and(o.order_status=''confirmed''::public.order_status) and count(distinct o.shipping_address_snapshot)=1';
  v_new := 'having count(*)>1 and bool_and(o.order_status=''confirmed''::public.order_status) and count(distinct o.shipping_address_snapshot)=1';
  IF v_def IS NULL THEN RAISE EXCEPTION 'admin_list_assignable_delivery_batches() not found'; END IF;
  IF position(v_old in v_def)>0 THEN
    EXECUTE replace(v_def,v_old,v_new);
  ELSIF position(v_new in v_def)=0 THEN
    RAISE EXCEPTION 'Unexpected admin_list_assignable_delivery_batches() definition';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='create_order' AND p.pronargs=9;
  v_old := '    SELECT * INTO product_row FROM public.products AS p WHERE p.id = item_product_id;' || E'\n' ||
           '    IF product_row.publication_status';
  v_new := '    SELECT * INTO product_row FROM public.products AS p WHERE p.id = item_product_id;' || E'\n' ||
           '    IF product_row.seller_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.seller_profiles AS s WHERE s.id = product_row.seller_id AND s.user_id = p_customer_id) THEN' || E'\n' ||
           '      RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''Vendors cannot purchase their own products.'';' || E'\n' ||
           '    END IF;' || E'\n' ||
           '    IF product_row.publication_status';
  IF v_def IS NULL THEN RAISE EXCEPTION 'create_order() not found'; END IF;
  IF position(v_old in v_def)>0 THEN
    EXECUTE replace(v_def,v_old,v_new);
  ELSIF position('Vendors cannot purchase their own products.' in v_def)=0 THEN
    RAISE EXCEPTION 'Unexpected create_order() definition';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='place_order' AND p.pronargs=11;
  v_old := '      IF NOT FOUND OR seller_row.status <> ''approved'' THEN' || E'\n' ||
           '        RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''An order product seller is not currently approved.'';' || E'\n' ||
           '      END IF;';
  v_new := v_old || E'\n' ||
           '      IF seller_row.user_id = v_buyer_id THEN' || E'\n' ||
           '        RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''Vendors cannot purchase their own products.'';' || E'\n' ||
           '      END IF;';
  IF v_def IS NULL THEN RAISE EXCEPTION 'place_order() checkout function not found'; END IF;
  IF position(v_old in v_def)>0 THEN
    EXECUTE replace(v_def,v_old,v_new);
  ELSIF position('Vendors cannot purchase their own products.' in v_def)=0 THEN
    RAISE EXCEPTION 'Unexpected place_order() checkout definition';
  END IF;
END
$patch$;
