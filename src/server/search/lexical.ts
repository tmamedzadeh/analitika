// Pure, table-independent query understanding, also used to check retrieved
// candidates. This is deliberately conservative V1 morphology, not a stemmer.
export const MAX_SEARCH_TOKENS = 12;
export const MAX_SEARCH_VARIANTS = 16;
const stopWords = new Set([
  "amma",
  "barədə",
  "belə",
  "bir",
  "bu",
  "da",
  "də",
  "ilə",
  "kimi",
  "nə",
  "olan",
  "olaraq",
  "üçün",
  "və",
  "ya",
  "yaxud",
  "tərəfindən",
]);
const aliases: Record<string, readonly string[]> = {
  iran: ["ıran"],
  azərbaycan: ["azerbaycan"],
  müdafiə: ["mudafie", "müdafie"],
  təsdiq: ["tesdiq"],
};
// High-confidence country names only. Ordinary capitalized words must not turn
// a broad semantic question into an entity-constrained search.
const namedEntities = new Set([
  "iran",
  "azərbaycan",
  "rusiya",
  "ukrayna",
  "türkiyə",
  "israil",
  "gürcüstan",
  "ermənistan",
]);

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("az-Latn-AZ")
    .normalize("NFC");
}

export function tokenizeSearchQuery(value: string, mode: "all" | "any" = "all"): string[] {
  return [...new Set(normalizeSearchText(value.normalize("NFKC")).match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((word) => !stopWords.has(word) && (mode === "all" || word.length >= 3))
    .slice(0, MAX_SEARCH_TOKENS);
}

function canonical(word: string): string {
  return (
    Object.entries(aliases).find(
      ([root, spellings]) => root === word || spellings.includes(word),
    )?.[0] ?? word
  );
}

function endings(root: string): string[] {
  const vowel = root.match(/[aıoueəiöü]/gu)?.at(-1);
  if (!vowel) return [];
  const high = "aı".includes(vowel)
    ? "ı"
    : "ou".includes(vowel)
      ? "u"
      : "öü".includes(vowel)
        ? "ü"
        : "i";
  const low = "aıou".includes(vowel) ? "a" : "ə";
  const endsVowel = /[aıoueəiöü]$/u.test(root);
  const possessive = `${endsVowel ? "s" : ""}${high}`;
  return [
    `${endsVowel ? "n" : ""}${high}n`,
    `l${low}`,
    `d${low}`,
    `d${low}n`,
    `${endsVowel ? "n" : ""}${high}`,
    `${endsVowel ? "y" : ""}${low}`,
    `${possessive}n${high}n`,
    `l${low}r`,
    `l${high}`,
    `l${high}${low === "a" ? "q" : "k"}`,
  ];
}

function grammaticalRoot(word: string): string {
  if (!/^\p{L}+$/u.test(word)) return word;
  const roots: string[] = [];
  for (let length = 4; length < word.length; length += 1) {
    const root = word.slice(0, length);
    const suffix = word.slice(length);
    // Bare dative vowels are ambiguous (e.g. Rusiya); reverse them only for a
    // known entity. Short roots never lose a single possessive/accusative vowel.
    if (
      suffix.length === 1 &&
      (!/[ıiuü]/u.test(suffix) || length < 5) &&
      !namedEntities.has(canonical(root))
    )
      continue;
    if (suffix.length === 1 && !/[qkrnmldt]$/u.test(root) && !namedEntities.has(canonical(root)))
      continue;
    if (endings(root).includes(suffix)) roots.push(root);
  }
  return roots[0] ?? word;
}

export type SearchTokenGroup = {
  token: string;
  variants: string[];
  prefixes: string[];
  fuzzy: boolean;
};

export function buildSearchVariants(
  value: string,
  mode: "all" | "any" = "all",
): SearchTokenGroup[] {
  const tokens = tokenizeSearchQuery(value, mode);
  return tokens.map((token) => {
    const root = canonical(grammaticalRoot(token));
    const spellings = [root, ...(aliases[root] ?? [])];
    const forms = spellings
      .filter((spelling) => spelling.length >= 4 && /^\p{L}+$/u.test(spelling))
      .map((spelling) => endings(spelling).map((ending) => spelling + ending));
    const inflections = Array.from({ length: 10 }, (_, index) =>
      forms.flatMap((list) => (list[index] ? [list[index]!] : [])),
    );
    const variants = [...new Set([token, ...spellings, ...inflections.flat()])].slice(
      0,
      MAX_SEARCH_VARIANTS,
    );
    const prefixes = [...new Set([token, root])].filter(
      (word) => word.length >= 6 && /^\p{L}+$/u.test(word) && !namedEntities.has(root),
    );
    return {
      token,
      variants,
      prefixes,
      fuzzy:
        tokens.length <= 3 &&
        token.length >= 6 &&
        token.length <= 20 &&
        /^\p{L}+$/u.test(token) &&
        !namedEntities.has(root),
    };
  });
}

export function tokenGroupQuery(group: SearchTokenGroup, rawIndex = false): string {
  const words = rawIndex
    ? [...new Set(group.variants.flatMap((word) => [word, word.replaceAll("ı", "I")]))]
    : group.variants;
  const terms = [
    ...words.map((word) => `'${word}'`),
    ...group.prefixes.map((word) => `'${word}':*`),
  ];
  return terms.length === 1 ? terms[0]! : `(${terms.join(" | ")})`;
}

export function buildLexicalQuery(
  value: string,
  mode: "all" | "any" = "all",
  rawIndex = false,
): string {
  return buildSearchVariants(value, mode)
    .map((group) => tokenGroupQuery(group, rawIndex))
    .join(mode === "all" ? " & " : " | ");
}

export function strictGroupPattern(group: SearchTokenGroup): string {
  return `(?:${[...group.variants, ...group.prefixes.map((word) => `${word}[[:alpha:]]{0,6}`)].join("|")})`;
}

function casePattern(word: string): string {
  return [...word]
    .map((char) => {
      const upper = char.toLocaleUpperCase("az-Latn-AZ");
      return upper === char ? char : `[${char}${upper}]`;
    })
    .join("");
}

// One insertion, deletion, substitution or adjacent transposition, within a
// whole word. No wildcards across words, short terms, or unbounded edit distance.
export function typoPattern(group: SearchTokenGroup, rawCase = false): string | null {
  if (!group.fuzzy) return null;
  const chars = [...group.token];
  const literal = (value: string[]) => (rawCase ? casePattern(value.join("")) : value.join(""));
  const variants = [literal(chars)];
  for (let i = 0; i < chars.length; i += 1) {
    const before = chars.slice(0, i),
      after = chars.slice(i + 1);
    variants.push(literal(before) + literal(after));
    variants.push(literal(before) + "[[:alpha:]]" + literal(after));
    variants.push(literal(before) + "[[:alpha:]]" + literal(chars.slice(i)));
    if (i + 1 < chars.length)
      variants.push(
        literal(before) + literal([chars[i + 1]!, chars[i]!]) + literal(chars.slice(i + 2)),
      );
  }
  variants.push(literal(chars) + "[[:alpha:]]");
  return `(?:${variants.join("|")})`;
}

function matchesPattern(word: string, pattern: string): boolean {
  return new RegExp(`^(?:${pattern.replaceAll("[[:alpha:]]", "\\p{L}")})$`, "u").test(word);
}

function groupTier(group: SearchTokenGroup, words: string[], typos = true): number {
  if (words.includes(group.token)) return 4;
  if (words.some((word) => group.variants.includes(word))) return 3;
  if (words.some((word) => matchesPattern(word, strictGroupPattern(group)))) return 2;
  const fuzzy = typos ? typoPattern(group) : null;
  return fuzzy && words.some((word) => matchesPattern(word, fuzzy)) ? 1 : 0;
}

function textWords(text: string): string[] {
  return normalizeSearchText(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function rankLexicalMatches(
  query: string,
  record: { title: string; body: string },
  mode: "all" | "any" = "all",
): number {
  const groups = buildSearchVariants(query, mode);
  if (!groups.length) return 0;
  const title = normalizeSearchText(record.title),
    body = normalizeSearchText(record.body);
  const titleWords = textWords(title),
    allWords = [...titleWords, ...textWords(body)];
  const tiers = groups.map((group) => groupTier(group, allWords));
  if (mode === "all" ? tiers.some((tier) => !tier) : tiers.every((tier) => !tier)) return 0;
  const phrase = normalizeSearchText(query.normalize("NFKC"));
  const phraseWords = textWords(phrase).join(" ");
  const hasPhrase = (words: string[]) => ` ${words.join(" ")} `.includes(` ${phraseWords} `);
  return (
    (title === phrase ? 10000 : 0) +
    (hasPhrase(titleWords) || hasPhrase(textWords(body)) ? 5000 : 0) +
    (groups.every((group) => groupTier(group, titleWords) > 0) ? 2000 : 0) +
    (tiers.every((tier) => tier === 4) ? 1000 : 0) +
    (tiers.every((tier) => tier >= 3) ? 500 : 0) +
    (tiers.every((tier) => tier >= 2) ? 100 : 0) +
    tiers.reduce((sum, tier) => sum + tier, 0)
  );
}

export function searchPhrasePattern(query: string): string {
  return `\\m${textWords(query.normalize("NFKC")).join("[^[:alnum:]]+")}\\M`;
}

export function matchesNamedEntities(
  query: string,
  record: { title: string; body: string },
): boolean {
  const groups = buildSearchVariants(query, "any").filter((group) =>
    namedEntities.has(canonical(grammaticalRoot(group.token))),
  );
  const words = textWords(`${record.title} ${record.body}`);
  return !groups.length || groups.some((group) => groupTier(group, words, false) > 0);
}
