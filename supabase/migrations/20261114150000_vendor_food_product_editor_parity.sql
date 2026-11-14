-- Secure vendor Food & Groceries editor: selling units and daily dish status.
CREATE OR REPLACE FUNCTION public.vendor_update_food_product_details(
  p_product_id uuid,
  p_selling_unit text,
  p_unit_price numeric,
  p_quantity_increment integer,
  p_minimum_quantity integer,
  p_is_daily_item boolean,
  p_daily_status text,
  p_daily_available_quantity integer
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seller public.seller_profiles%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_category_id uuid;
  v_is_food boolean := false;
  v_divisor numeric;
  v_final_unit_price numeric(12,2);
  v_price_per_increment numeric(12,2);
  v_daily_quantity integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Sign in required.';
  END IF;
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role'
     AND (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2'
     AND (private.has_role('admin'::public.app_role) OR private.has_verified_totp_factor()) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='JTBazar authenticator verification is required.';
  END IF;
  IF p_selling_unit NOT IN ('kg','g','l','ml','piece','dozen','pack')
     OR p_unit_price IS NULL OR p_unit_price < 0
     OR p_quantity_increment IS NULL OR p_quantity_increment < 1
     OR p_minimum_quantity IS NULL OR p_minimum_quantity < 1
     OR p_daily_status NOT IN ('available','not_today','coming_soon')
     OR p_daily_available_quantity IS NULL OR p_daily_available_quantity < 0 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Enter valid food unit, price, quantity steps and daily availability.';
  END IF;
  SELECT * INTO v_seller
  FROM public.seller_profiles
  WHERE user_id=(SELECT auth.uid()) AND status='approved' AND NOT COALESCE(vendor_locked,false)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='An unlocked, approved vendor account is required to edit this product.';
  END IF;
  SELECT * INTO v_product
  FROM public.products
  WHERE id=p_product_id AND seller_id=v_seller.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='This product does not belong to your vendor account.';
  END IF;
  v_category_id:=v_product.category_id;
  WHILE v_category_id IS NOT NULL LOOP
    SELECT c.is_food_category,c.parent_id INTO v_is_food,v_category_id
    FROM public.categories c WHERE c.id=v_category_id;
    EXIT WHEN v_is_food OR v_category_id IS NULL;
  END LOOP;
  IF NOT v_is_food THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Food selling details are only available for Food & Groceries categories.';
  END IF;
  v_divisor:=CASE WHEN p_selling_unit IN ('kg','l') THEN 1000 ELSE 1 END;
  IF p_selling_unit IN ('kg','l') AND (p_quantity_increment>1000 OR 1000 % p_quantity_increment<>0) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='For kg or litre, choose a step that divides 1000, such as 50, 100, 250 or 500.';
  END IF;
  v_daily_quantity:=CASE WHEN p_is_daily_item AND p_daily_status='available' THEN p_daily_available_quantity ELSE 0 END;
  v_final_unit_price:=round(p_unit_price*(1+COALESCE(v_product.commission_percent,0)/100),2);
  v_price_per_increment:=round(v_final_unit_price*p_quantity_increment/v_divisor,2);
  UPDATE public.products
  SET food_selling_unit=p_selling_unit,
      food_unit_price=v_final_unit_price,
      food_quantity_increment=p_quantity_increment,
      food_minimum_quantity=p_minimum_quantity,
      price=v_price_per_increment,
      commission_amount=round(p_unit_price*COALESCE(commission_percent,0)/100,2),
      is_daily_item=p_is_daily_item,
      daily_status=CASE WHEN p_is_daily_item THEN p_daily_status ELSE 'available' END,
      daily_available_quantity=v_daily_quantity,
      daily_minimum_quantity=p_minimum_quantity,
      daily_available_on=CASE WHEN p_is_daily_item AND p_daily_status='available' THEN (now() AT TIME ZONE 'Asia/Karachi')::date ELSE NULL END,
      updated_at=now()
  WHERE id=p_product_id
  RETURNING * INTO v_product;
  IF p_is_daily_item THEN
    UPDATE public.product_inventory SET quantity=v_daily_quantity,updated_at=now()
    WHERE product_id=p_product_id AND variant_id IS NULL;
    IF NOT FOUND THEN
      INSERT INTO public.product_inventory(product_id,variant_id,quantity)
      VALUES(p_product_id,NULL,v_daily_quantity);
    END IF;
  END IF;
  RETURN v_product;
END;
$$;
REVOKE ALL ON FUNCTION public.vendor_update_food_product_details(uuid,text,numeric,integer,integer,boolean,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vendor_update_food_product_details(uuid,text,numeric,integer,integer,boolean,text,integer) TO authenticated;
