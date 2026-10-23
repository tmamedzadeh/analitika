-- Requires empty documents and daily_briefs. No backfill, reset or deletion is performed.
-- Mirrors projectRichText(): paragraphs/headings in tree order, separated by two LF.
CREATE FUNCTION public.rich_text_plain(doc jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  WITH RECURSIVE nodes(node, path) AS (
    SELECT doc, ARRAY[]::integer[]
    UNION ALL
    SELECT child.value, nodes.path || child.ordinality::integer
    FROM nodes
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(nodes.node->'content', '[]'::jsonb))
      WITH ORDINALITY AS child(value, ordinality)
  ), blocks AS (
    SELECT path, coalesce((
      SELECT string_agg(CASE part.value->>'type'
        WHEN 'text' THEN part.value->>'text'
        WHEN 'hardBreak' THEN E'\n'
        ELSE '' END, '' ORDER BY part.ordinality)
      FROM jsonb_array_elements(coalesce(node->'content', '[]'::jsonb))
        WITH ORDINALITY AS part(value, ordinality)
    ), '') AS body
    FROM nodes WHERE node->>'type' IN ('paragraph', 'heading')
  )
  SELECT coalesce(string_agg(body, E'\n\n' ORDER BY path), '') FROM blocks;
$$;--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD COLUMN "body_rich" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "body_rich" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD CONSTRAINT "daily_briefs_rich_projection_check" CHECK (body = public.rich_text_plain(body_rich) AND jsonb_typeof(body_rich) = 'object' AND body_rich->>'type' = 'doc' AND octet_length(body_rich::text) <= 4000000);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_rich_projection_check" CHECK (body = public.rich_text_plain(body_rich) AND jsonb_typeof(body_rich) = 'object' AND body_rich->>'type' = 'doc' AND octet_length(body_rich::text) <= 4000000);
