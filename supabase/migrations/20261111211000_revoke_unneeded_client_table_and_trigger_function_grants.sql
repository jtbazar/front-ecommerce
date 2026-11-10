-- The push-token table is written/read only by the service-role Edge Function.
-- Client RLS has no policies by design, so remove unnecessary direct grants.
REVOKE ALL ON TABLE public.user_push_tokens FROM anon, authenticated;

-- Trigger functions are invoked by PostgreSQL triggers, not by client RPC.
-- Revoke their default PUBLIC execute grants to keep them out of the client API.
DO $block$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype = 'pg_catalog.trigger'::regtype
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      fn.signature
    );
  END LOOP;
END;
$block$;
