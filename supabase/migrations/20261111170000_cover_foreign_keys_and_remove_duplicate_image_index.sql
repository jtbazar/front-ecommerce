DO $migration$
DECLARE
  fk record;
  index_name text;
BEGIN
  FOR fk IN
    SELECT c.oid, c.conname, c.conkey, n.nspname, t.relname, t.oid AS table_oid,
           string_agg(format('%I', a.attname), ', ' ORDER BY k.ord) AS cols
    FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN unnest(c.conkey) WITH ORDINALITY k(attnum,ord) ON true
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE c.contype='f' AND n.nspname='public'
    GROUP BY c.oid,c.conname,c.conkey,n.nspname,t.relname,t.oid
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid=fk.table_oid AND i.indisvalid
        AND i.indnkeyatts >= cardinality(fk.conkey)
        AND (i.indkey::smallint[])[0:cardinality(fk.conkey)-1] = fk.conkey
    ) THEN
      index_name := left(fk.relname || '_' || fk.conname || '_idx', 63);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)', index_name, fk.nspname, fk.relname, fk.cols);
    END IF;
  END LOOP;
END
$migration$;

-- The unique (product_id, sort_order) index already covers this exact lookup.
DROP INDEX IF EXISTS public.product_images_product_order_idx;
