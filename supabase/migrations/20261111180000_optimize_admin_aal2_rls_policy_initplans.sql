DO $migration$
DECLARE
  pol record;
  predicate text := $predicate$
    ((SELECT auth.jwt()) ->> 'aal') = 'aal2'
    OR (
      NOT (SELECT private.has_role('admin'::public.app_role))
      AND NOT (SELECT private.has_verified_totp_factor())
    )
  $predicate$;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname='public'
      AND policyname='require_admin_aal2_for_authenticated_access'
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
      pol.policyname, pol.schemaname, pol.tablename, predicate, predicate
    );
  END LOOP;
END
$migration$;
