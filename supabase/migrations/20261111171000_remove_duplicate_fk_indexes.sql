DO $cleanup$
DECLARE
  item record;
BEGIN
  FOR item IN
    WITH candidates AS (
      SELECT i.indexrelid, n.nspname, idx.relname,
             row_number() OVER (
               PARTITION BY i.indrelid, i.indkey, i.indisunique, coalesce(pg_get_expr(i.indpred,i.indrelid),'')
               ORDER BY (idx.relname LIKE '%_fk_idx') ASC, coalesce(s.idx_scan,0) DESC, idx.relname
             ) AS keep_rank
      FROM pg_index i
      JOIN pg_class tbl ON tbl.oid=i.indrelid
      JOIN pg_namespace n ON n.oid=tbl.relnamespace
      JOIN pg_class idx ON idx.oid=i.indexrelid
      LEFT JOIN pg_stat_user_indexes s ON s.indexrelid=i.indexrelid
      WHERE n.nspname='public' AND i.indisvalid
    )
    SELECT nspname, relname FROM candidates
    WHERE keep_rank > 1 AND relname LIKE '%_fk_idx'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', item.nspname, item.relname);
  END LOOP;
END
$cleanup$;
