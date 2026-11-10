-- Remove only the redundant indexes created by the preceding FK-index pass.
-- Existing equivalent indexes are retained; no constraints or data are changed.
DO $$
DECLARE
  fk record;
  candidate_name text;
  candidate_oid oid;
  has_equivalent boolean;
BEGIN
  FOR fk IN
    SELECT
      n.nspname AS schema_name,
      t.relname AS table_name,
      string_agg(a.attname, '_' ORDER BY u.ord) AS column_suffix
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
    WHERE c.contype = 'f' AND n.nspname = 'public'
    GROUP BY n.nspname, t.relname, c.conkey
  LOOP
    candidate_name := left(fk.table_name || '_' || fk.column_suffix || '_fk_idx', 63);
    SELECT ic.oid INTO candidate_oid
    FROM pg_class ic
    JOIN pg_namespace ns ON ns.oid = ic.relnamespace
    WHERE ns.nspname = fk.schema_name AND ic.relname = candidate_name AND ic.relkind = 'i';

    IF candidate_oid IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM pg_index candidate
        JOIN pg_index existing
          ON existing.indrelid = candidate.indrelid
         AND existing.indexrelid <> candidate.indexrelid
         AND existing.indkey = candidate.indkey
         AND existing.indclass = candidate.indclass
         AND existing.indcollation = candidate.indcollation
         AND existing.indoption = candidate.indoption
         AND existing.indpred IS NULL
         AND existing.indisvalid
         AND existing.indisready
        WHERE candidate.indexrelid = candidate_oid
          AND candidate.indpred IS NULL
          AND candidate.indisvalid
          AND candidate.indisready
      ) INTO has_equivalent;

      IF has_equivalent THEN
        EXECUTE format('DROP INDEX %I.%I', fk.schema_name, candidate_name);
      END IF;
    END IF;
    candidate_oid := NULL;
  END LOOP;
END;
$$;
