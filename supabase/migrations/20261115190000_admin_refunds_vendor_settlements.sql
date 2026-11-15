-- Audited admin refunds and vendor settlements. This records manually verified money movement;
-- it does not initiate bank/card gateway transfers.
CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at_id_idx ON public.admin_audit_logs(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_created_at_idx ON public.admin_audit_logs(actor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_action_created_at_idx ON public.admin_audit_logs(action,created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_entity_created_at_idx ON public.admin_audit_logs(entity,created_at DESC);

CREATE TABLE public.admin_refund_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES public.marketplace_cases(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
 order_item_id uuid REFERENCES public.order_items(id) ON DELETE RESTRICT,
 buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 amount numeric(12,2) NOT NULL CHECK(amount>0),
 currency text NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),
 method text NOT NULL CHECK(method IN ('cash','bank_transfer','wallet','card_gateway','other')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','cancelled')),
 reference text,
 admin_note text NOT NULL CHECK(char_length(btrim(admin_note)) BETWEEN 3 AND 2000),
 created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 completed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_refund_records_created_idx ON public.admin_refund_records(created_at DESC);
CREATE INDEX admin_refund_records_status_created_idx ON public.admin_refund_records(status,created_at DESC);
CREATE INDEX admin_refund_records_case_idx ON public.admin_refund_records(case_id);

CREATE TABLE public.vendor_settlement_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE RESTRICT,
 amount numeric(12,2) NOT NULL CHECK(amount>0),
 currency text NOT NULL DEFAULT 'PKR' CHECK(currency='PKR'),
 method text NOT NULL CHECK(method IN ('cash','bank_transfer','wallet','other')),
 reference text,
 admin_note text NOT NULL CHECK(char_length(btrim(admin_note)) BETWEEN 3 AND 2000),
 status text NOT NULL DEFAULT 'paid' CHECK(status IN ('paid','reversed')),
 created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 paid_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendor_settlement_batches_seller_paid_idx ON public.vendor_settlement_batches(seller_id,paid_at DESC);

CREATE TABLE public.vendor_settlement_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL REFERENCES public.vendor_settlement_batches(id) ON DELETE RESTRICT,
 seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE RESTRICT,
 order_item_id uuid NOT NULL UNIQUE REFERENCES public.order_items(id) ON DELETE RESTRICT,
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
 product_name_snapshot text NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0),
 gross_amount numeric(12,2) NOT NULL CHECK(gross_amount>=0),
 commission_amount numeric(12,2) NOT NULL CHECK(commission_amount>=0),
 payout_amount numeric(12,2) NOT NULL CHECK(payout_amount>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendor_settlement_items_seller_idx ON public.vendor_settlement_items(seller_id,created_at DESC);
CREATE INDEX vendor_settlement_items_batch_idx ON public.vendor_settlement_items(batch_id);

ALTER TABLE public.admin_refund_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_settlement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_settlement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read_refund_records ON public.admin_refund_records FOR SELECT TO authenticated USING((SELECT private.has_role('admin'::public.app_role)));
CREATE POLICY admin_read_vendor_settlement_batches ON public.vendor_settlement_batches FOR SELECT TO authenticated USING((SELECT private.has_role('admin'::public.app_role)));
CREATE POLICY admin_read_vendor_settlement_items ON public.vendor_settlement_items FOR SELECT TO authenticated USING((SELECT private.has_role('admin'::public.app_role)));
REVOKE ALL ON public.admin_refund_records,public.vendor_settlement_batches,public.vendor_settlement_items FROM anon,authenticated;
GRANT SELECT ON public.admin_refund_records,public.vendor_settlement_batches,public.vendor_settlement_items TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_record_case_refund(p_case_id uuid,p_amount numeric,p_method text,p_admin_note text,p_reference text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 c public.marketplace_cases%ROWTYPE;
 item_total numeric;
 order_total numeric;
 item_refunded numeric;
 order_refunded numeric;
 order_payment_status public.payment_status;
 refund_id uuid;
BEGIN
 IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF p_amount IS NULL OR round(p_amount,2)<=0 OR p_method NOT IN ('cash','bank_transfer','wallet','card_gateway','other')
   OR p_admin_note IS NULL OR char_length(btrim(p_admin_note))<3 THEN
  RAISE EXCEPTION 'Enter a valid refund amount, method and admin note.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO c FROM public.marketplace_cases WHERE id=p_case_id FOR UPDATE;
 IF NOT FOUND OR c.status NOT IN ('approved','resolved') THEN
  RAISE EXCEPTION 'Only approved or resolved cases can receive a refund.' USING ERRCODE='23514';
 END IF;
 SELECT total,payment_status INTO order_total,order_payment_status FROM public.orders WHERE id=c.order_id FOR UPDATE;
 IF order_payment_status NOT IN ('paid'::public.payment_status,'partially_refunded'::public.payment_status) THEN
  RAISE EXCEPTION 'This order has no collected payment to refund.' USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(sum(amount),0) INTO order_refunded FROM public.admin_refund_records
  WHERE order_id=c.order_id AND status IN ('pending','completed');
 IF round(p_amount,2)>order_total-order_refunded THEN
  RAISE EXCEPTION 'Refund exceeds the remaining refundable amount for this order.' USING ERRCODE='23514';
 END IF;
 IF c.order_item_id IS NOT NULL THEN
  SELECT line_total INTO item_total FROM public.order_items WHERE id=c.order_item_id AND order_id=c.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case order item could not be verified.' USING ERRCODE='23503'; END IF;
  SELECT COALESCE(sum(amount),0) INTO item_refunded FROM public.admin_refund_records
   WHERE order_item_id=c.order_item_id AND status IN ('pending','completed');
  IF round(p_amount,2)>item_total-item_refunded THEN
   RAISE EXCEPTION 'Refund exceeds remaining refundable amount for this item.' USING ERRCODE='23514';
  END IF;
 END IF;
 INSERT INTO public.admin_refund_records(case_id,order_id,order_item_id,buyer_id,amount,method,status,reference,admin_note,created_by)
 VALUES(c.id,c.order_id,c.order_item_id,c.buyer_id,round(p_amount,2),p_method,'pending',nullif(btrim(p_reference),''),btrim(p_admin_note),auth.uid())
 RETURNING id INTO refund_id;
 INSERT INTO public.admin_audit_logs(actor_id,action,entity,entity_id,details)
 VALUES(auth.uid(),'refund_created','admin_refund_records',refund_id,jsonb_build_object('case_id',c.id,'order_id',c.order_id,'amount',round(p_amount,2),'method',p_method));
 RETURN refund_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_refund_status(p_refund_id uuid,p_status text,p_reference text DEFAULT NULL,p_admin_note text DEFAULT NULL)
RETURNS public.admin_refund_records LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE r public.admin_refund_records%ROWTYPE; v_refunded numeric; v_order_total numeric;
BEGIN
 IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('completed','failed','cancelled') THEN RAISE EXCEPTION 'Unsupported refund status.' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.admin_refund_records WHERE id=p_refund_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RAISE EXCEPTION 'Only pending refunds can be updated.' USING ERRCODE='23514'; END IF;
 IF p_status='completed' THEN
  SELECT total INTO v_order_total FROM public.orders WHERE id=r.order_id FOR UPDATE;
 END IF;
 UPDATE public.admin_refund_records SET status=p_status,reference=COALESCE(nullif(btrim(p_reference),''),reference),
  admin_note=COALESCE(nullif(btrim(p_admin_note),''),admin_note),completed_by=CASE WHEN p_status='completed' THEN auth.uid() END,
  completed_at=CASE WHEN p_status='completed' THEN now() END,updated_at=now()
 WHERE id=p_refund_id RETURNING * INTO r;
 IF p_status='completed' THEN
  SELECT COALESCE(sum(amount),0) INTO v_refunded FROM public.admin_refund_records WHERE order_id=r.order_id AND status='completed';
  UPDATE public.orders SET payment_status=CASE WHEN v_refunded>=v_order_total THEN 'refunded'::public.payment_status ELSE 'partially_refunded'::public.payment_status END,updated_at=now()
   WHERE id=r.order_id AND payment_status IN ('paid'::public.payment_status,'partially_refunded'::public.payment_status);
 END IF;
 INSERT INTO public.admin_audit_logs(actor_id,action,entity,entity_id,details)
 VALUES(auth.uid(),'refund_status_'||p_status,'admin_refund_records',p_refund_id,jsonb_build_object('amount',r.amount,'reference',r.reference));
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_create_vendor_settlement(p_seller_id uuid,p_order_item_ids uuid[],p_method text,p_admin_note text,p_reference text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE batch_id uuid; total_amount numeric(12,2); selected_count integer; valid_count integer; item record;
BEGIN
 IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF p_order_item_ids IS NULL OR cardinality(p_order_item_ids)<1 OR cardinality(p_order_item_ids)>250 OR p_method NOT IN ('cash','bank_transfer','wallet','other') OR p_admin_note IS NULL OR char_length(btrim(p_admin_note))<3 THEN
  RAISE EXCEPTION 'Select payable items and enter a valid payout method and note.' USING ERRCODE='22023';
 END IF;
 SELECT count(*) INTO selected_count FROM (SELECT DISTINCT unnest(p_order_item_ids)) q;
 IF selected_count<>cardinality(p_order_item_ids) THEN RAISE EXCEPTION 'Duplicate order items selected.' USING ERRCODE='23505'; END IF;
 PERFORM 1 FROM public.order_items oi WHERE oi.id=ANY(p_order_item_ids) FOR UPDATE;
 SELECT count(*),round(sum(oi.vendor_base_price_snapshot*oi.quantity),2) INTO valid_count,total_amount
 FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
 WHERE oi.id=ANY(p_order_item_ids) AND oi.seller_id=p_seller_id AND o.order_status='delivered'::public.order_status AND o.payment_status='paid'::public.payment_status
  AND oi.vendor_base_price_snapshot IS NOT NULL AND oi.vendor_base_price_snapshot > 0 AND oi.commission_amount_snapshot IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.vendor_settlement_items si WHERE si.order_item_id=oi.id);
 IF valid_count<>cardinality(p_order_item_ids) OR total_amount IS NULL OR total_amount<=0 THEN
  RAISE EXCEPTION 'Selected lines are not eligible, lack historical commission snapshots, or were already settled.' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.vendor_settlement_batches(seller_id,amount,method,reference,admin_note,created_by)
 VALUES(p_seller_id,total_amount,p_method,nullif(btrim(p_reference),''),btrim(p_admin_note),auth.uid()) RETURNING id INTO batch_id;
 FOR item IN SELECT oi.id,oi.order_id,oi.product_name_snapshot,oi.quantity,oi.line_total,oi.vendor_base_price_snapshot,oi.commission_amount_snapshot
  FROM public.order_items oi WHERE oi.id=ANY(p_order_item_ids) AND oi.seller_id=p_seller_id
 LOOP
  INSERT INTO public.vendor_settlement_items(batch_id,seller_id,order_item_id,order_id,product_name_snapshot,quantity,gross_amount,commission_amount,payout_amount)
  VALUES(batch_id,p_seller_id,item.id,item.order_id,item.product_name_snapshot,item.quantity,round(item.line_total,2),
   round(item.commission_amount_snapshot*item.quantity,2),round(item.vendor_base_price_snapshot*item.quantity,2));
 END LOOP;
 INSERT INTO public.admin_audit_logs(actor_id,action,entity,entity_id,details)
 VALUES(auth.uid(),'vendor_settlement_paid','vendor_settlement_batches',batch_id,jsonb_build_object('seller_id',p_seller_id,'amount',total_amount,'items',selected_count,'method',p_method));
 RETURN batch_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_vendor_settlement_candidates(p_seller_id uuid,p_page integer DEFAULT 0,p_page_size integer DEFAULT 12)
RETURNS TABLE(order_item_id uuid,order_id uuid,order_number text,product_name text,quantity integer,gross_amount numeric,commission_amount numeric,payout_amount numeric,delivered_at timestamptz,total_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 IF p_page<0 OR p_page_size<1 OR p_page_size>100 THEN RAISE EXCEPTION 'Invalid page.' USING ERRCODE='22023'; END IF;
 RETURN QUERY WITH c AS (
  SELECT oi.id,oi.order_id,o.order_number,oi.product_name_snapshot,oi.quantity,round(oi.line_total,2) gross,
   round(oi.commission_amount_snapshot*oi.quantity,2) commission,round(oi.vendor_base_price_snapshot*oi.quantity,2) payout,o.delivered_at
  FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
  WHERE oi.seller_id=p_seller_id AND o.order_status='delivered'::public.order_status AND o.payment_status='paid'::public.payment_status
   AND oi.vendor_base_price_snapshot IS NOT NULL AND oi.vendor_base_price_snapshot > 0 AND oi.commission_amount_snapshot IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM public.vendor_settlement_items si WHERE si.order_item_id=oi.id)
 )
 SELECT c.id,c.order_id,c.order_number,c.product_name_snapshot,c.quantity,c.gross,c.commission,c.payout,c.delivered_at,count(*) OVER()
 FROM c ORDER BY c.delivered_at DESC NULLS LAST,c.id OFFSET p_page*p_page_size LIMIT p_page_size;
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_vendor_settlement_balances()
RETURNS TABLE(seller_id uuid,shop_name text,eligible_items bigint,eligible_amount numeric,paid_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF NOT private.has_role('admin'::public.app_role) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY WITH eligible AS (
  SELECT oi.seller_id,count(*) n,round(sum(oi.vendor_base_price_snapshot*oi.quantity),2) amount
  FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
  WHERE oi.seller_id IS NOT NULL AND o.order_status='delivered'::public.order_status AND o.payment_status='paid'::public.payment_status
   AND oi.vendor_base_price_snapshot IS NOT NULL AND oi.commission_amount_snapshot IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM public.vendor_settlement_items si WHERE si.order_item_id=oi.id) GROUP BY oi.seller_id
 ), paid AS (SELECT seller_id,round(sum(amount),2) amount FROM public.vendor_settlement_batches WHERE status='paid' GROUP BY seller_id)
 SELECT sp.id,sp.shop_name,COALESCE(e.n,0),COALESCE(e.amount,0),COALESCE(p.amount,0)
 FROM public.seller_profiles sp LEFT JOIN eligible e ON e.seller_id=sp.id LEFT JOIN paid p ON p.seller_id=sp.id
 WHERE COALESCE(e.n,0)>0 OR COALESCE(p.amount,0)>0 ORDER BY COALESCE(e.amount,0) DESC,sp.shop_name;
END $$;

REVOKE ALL ON FUNCTION public.admin_record_case_refund(uuid,numeric,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_update_refund_status(uuid,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_create_vendor_settlement(uuid,uuid[],text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_list_vendor_settlement_candidates(uuid,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_list_vendor_settlement_balances() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_record_case_refund(uuid,numeric,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_refund_status(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_vendor_settlement(uuid,uuid[],text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_vendor_settlement_candidates(uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_vendor_settlement_balances() TO authenticated;
