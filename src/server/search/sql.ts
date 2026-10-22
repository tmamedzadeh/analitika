import { and, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  buildSearchVariants,
  normalizeSearchText,
  searchPhrasePattern,
  strictGroupPattern,
  tokenGroupQuery,
  typoPattern,
} from "./lexical";

export function normalizedSearchSql(value: SQLWrapper): SQL<string> {
  return sql<string>`lower(translate(normalize(${value}, NFC), 'ƏİIŞÇĞÖÜ', 'əiışçğöü'))`;
}

export function lexicalSearchSql(
  query: string,
  columns: { title: SQLWrapper; body: SQLWrapper; vector?: SQLWrapper; rawVector?: boolean },
  mode: "all" | "any" = "all",
) {
  const groups = buildSearchVariants(query, mode);
  const active = normalizeSearchText(query).length > 0;
  const title = normalizedSearchSql(columns.title),
    body = normalizedSearchSql(columns.body);
  // Keep this expression identical to daily_briefs_search_gin_idx. Documents
  // currently lack an equivalent index; no schema change is made here.
  const text = sql`${columns.title} || ' || ' || ${columns.body}`;
  const vector =
    columns.vector ?? sql`to_tsvector('simple'::regconfig, ${normalizedSearchSql(text)})`;
  const join = (items: SQL[]) => (mode === "all" ? and(...items) : or(...items)) ?? sql`false`;
  const every = (items: SQL[]) => and(...items) ?? sql`false`;
  const groupParts = groups.map((group) => {
    const pattern = `\\m${strictGroupPattern(group)}\\M`;
    const fts = sql`${vector} @@ to_tsquery('simple'::regconfig, ${tokenGroupQuery(group, columns.rawVector)})`;
    const strictTitle = sql`${title} ~ ${pattern}`;
    const strictBody = sql`${body} ~ ${pattern}`;
    // The raw tsvector uses PostgreSQL casing. A normalized recheck protects the
    // Azerbaijani dotted/dotless I distinction without rebuilding chunks.tsv.
    const strict = sql`(${fts} and (${strictTitle} or ${strictBody}))`;
    const fuzzy = typoPattern(group, true);
    // Chunk titles are a joined coalesce expression without a matching index.
    // Keep the chunk typo branch on its indexed raw text column.
    const typoTitle =
      fuzzy && !columns.rawVector ? sql`${columns.title} ~ ${`\\m${fuzzy}\\M`}` : sql`false`;
    const typoBody = fuzzy ? sql`${columns.body} ~ ${`\\m${fuzzy}\\M`}` : sql`false`;
    // These raw-column regex predicates can use the existing pg_trgm GIN indexes.
    const match = sql`(${strict} or ${typoTitle} or ${typoBody})`;
    const exactPattern = `\\m${group.token}\\M`;
    const exact = sql`(${title} ~ ${exactPattern} or ${body} ~ ${exactPattern})`;
    const morphologyPattern = `\\m(?:${group.variants.join("|")})\\M`;
    const morphology = sql`(${title} ~ ${morphologyPattern} or ${body} ~ ${morphologyPattern})`;
    const tier = sql`case when ${exact} then 4 when ${morphology} then 3 when (${strictTitle} or ${strictBody}) then 2 when (${typoTitle} or ${typoBody}) then 1 else 0 end`;
    return {
      match,
      typo: sql`(${typoTitle} or ${typoBody})`,
      exact,
      morphology,
      strict: sql`(${strictTitle} or ${strictBody})`,
      title: sql`(${strictTitle} or ${typoTitle})`,
      tier,
    };
  });
  const phrase = normalizeSearchText(query.normalize("NFKC"));
  const phrasePattern = searchPhrasePattern(query);
  const phraseMatch = sql`(${title} ~ ${phrasePattern} or ${body} ~ ${phrasePattern})`;
  const score = !groups.length
    ? sql<number>`0`
    : sql<number>`(
    case when ${title} = ${phrase} then 10000 else 0 end +
    case when ${phraseMatch} then 5000 else 0 end +
    case when ${every(groupParts.map((part) => part.title))} then 2000 else 0 end +
    case when ${every(groupParts.map((part) => part.exact))} then 1000 else 0 end +
    case when ${every(groupParts.map((part) => part.morphology))} then 500 else 0 end +
    case when ${every(groupParts.map((part) => part.strict))} then 100 else 0 end +
    ${sql.join(
      groupParts.map((part) => part.tier),
      sql` + `,
    )})::integer`;
  return {
    active,
    match: join(groupParts.map((part) => part.match)),
    typoMatch: join(groupParts.map((part) => part.typo)),
    score,
  };
}

export function afterSearchScore(score: SQL<number>, cursorScore: number, afterPosition: SQL): SQL {
  return sql`(${score} < ${cursorScore} or (${score} = ${cursorScore} and ${afterPosition}))`;
}
