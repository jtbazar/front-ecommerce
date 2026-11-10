DO $optimize$
DECLARE
  pol record;
  new_qual text;
  new_check text;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname='public'
      AND policyname IN (
        'promotions_vendor_insert_own',
        'promotions_vendor_read_own',
        'buyer_complaints_buyer_insert',
        'buyer_complaints_buyer_read',
        'buyer_complaints_seller_read',
        'buyer_complaints_seller_update',
        'product_reviews_buyer_insert',
        'seller_reviews_buyer_insert'
      )
  LOOP
    new_qual := replace(replace(pol.qual, 'auth.uid()', '(SELECT auth.uid())'), 'auth.jwt()', '(SELECT auth.jwt())');
    new_check := replace(replace(pol.with_check, 'auth.uid()', '(SELECT auth.uid())'), 'auth.jwt()', '(SELECT auth.jwt())');
    IF pol.cmd='INSERT' THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', pol.policyname, pol.schemaname, pol.tablename, new_check);
    ELSIF pol.cmd='SELECT' OR pol.cmd='DELETE' THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', pol.policyname, pol.schemaname, pol.tablename, new_qual);
    ELSIF pol.cmd='UPDATE' THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)', pol.policyname, pol.schemaname, pol.tablename, new_qual, COALESCE(new_check,new_qual));
    END IF;
  END LOOP;
END
$optimize$;
