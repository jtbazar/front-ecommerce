-- Add indexes for public foreign keys that do not already have a usable leading-column index.
DO $$
DECLARE
  fk record;
  idx_name text;
BEGIN
  FOR fk IN
    SELECT
      c.conrelid,
      n.nspname AS schema_name,
      t.relname AS table_name,
      c.conkey,
      string_agg(format('%I', a.attname), ', ' ORDER BY u.ord) AS columns_sql,
      string_agg(a.attname, '_' ORDER BY u.ord) AS column_suffix
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
    GROUP BY c.conrelid, n.nspname, t.relname, c.conkey
    HAVING NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = c.conrelid
        AND i.indisvalid
        AND i.indisready
        AND i.indpred IS NULL
        AND i.indnkeyatts >= cardinality(c.conkey)
        AND (i.indkey::smallint[])[1:cardinality(c.conkey)] = c.conkey::smallint[]
    )
  LOOP
    idx_name := left(fk.table_name || '_' || fk.column_suffix || '_fk_idx', 63);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',
      idx_name, fk.schema_name, fk.table_name, fk.columns_sql);
  END LOOP;
END;
$$;

-- Evaluate the administrator AAL2 claim once per statement rather than once per row.
DO $$
DECLARE
  p record;
  using_expr text;
  check_expr text;
  role_list text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'require_admin_aal2_for_authenticated_access'
      AND (COALESCE(qual, '') LIKE '%auth.jwt()%' OR COALESCE(with_check, '') LIKE '%auth.jwt()%')
  LOOP
    using_expr := CASE WHEN p.qual IS NULL THEN NULL ELSE replace(p.qual, 'auth.jwt()', '(select auth.jwt())') END;
    check_expr := CASE WHEN p.with_check IS NULL THEN NULL ELSE replace(p.with_check, 'auth.jwt()', '(select auth.jwt())') END;
    role_list := array_to_string(p.roles, ', ');
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
      p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd, role_list,
      CASE WHEN using_expr IS NULL THEN '' ELSE format(' USING (%s)', using_expr) END,
      CASE WHEN check_expr IS NULL THEN '' ELSE format(' WITH CHECK (%s)', check_expr) END
    );
  END LOOP;
END;
$$;
