/**
 * fuzzySearch.ts — the find-a-piece search's typo tolerance (v33 slice F, owner
 * 10-04 email batch: "Toccata & Fugue in D minor (BWV 565) does not surface, even
 * when typed as a common misspelling like 'toccatta and fugue'").
 *
 * WHY IT EXISTS. The catalog search is a server-side match on title/composer
 * tokens: a misspelled token simply matches nothing, and the user gets the
 * no-match line for a piece the library actually holds. The fix is honest and
 * local — the app keeps the user's own words, but when the server finds nothing
 * it retries with a small, deterministic ladder of VARIANTS of what was typed
 * (filler words dropped, one doubled letter halved — "toccatta" → "toccata"),
 * and says which query produced the results it shows. Nothing is invented and
 * nothing is hidden: the surface prints the query that actually matched.
 *
 * PURE (no react / react-native / fs / network): the normalisation, the variant
 * ladder and the ranking are asserted by scripts/v33TakeEditor.test.ts.
 */

/** Words that carry no retrieval weight in a title ("Toccata AND Fugue"). */
export const SEARCH_FILLER_WORDS: readonly string[] = [
  'a',
  'an',
  'and',
  'the',
  'in',
  'of',
  'for',
  'by',
  'no',
  'op',
  'opus',
];

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeSearchText(text: string | null | undefined): string {
  return (typeof text === 'string' ? text : '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function searchTokens(text: string | null | undefined): string[] {
  const normalized = normalizeSearchText(text);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

/** Levenshtein distance, bounded (returns `max + 1` once it is exceeded). */
export function editDistance(a: string, b: string, max = 3): number {
  const left = a ?? '';
  const right = b ?? '';
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > max) return max + 1;
  let previous = new Array<number>(right.length + 1);
  let current = new Array<number>(right.length + 1);
  for (let j = 0; j <= right.length; j++) previous[j] = j;
  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    let rowBest = current[0];
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowBest) rowBest = current[j];
    }
    if (rowBest > max) return max + 1;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[right.length];
}

/** The tolerated distance for a token of this length (typos scale with length). */
export function tokenTolerance(token: string): number {
  if (token.length <= 3) return 0;
  if (token.length <= 6) return 1;
  return 2;
}

/** Does one query token hit one candidate token (exact, prefix, or near)? */
export function tokenMatches(queryToken: string, candidateToken: string): boolean {
  if (!queryToken || !candidateToken) return false;
  if (candidateToken === queryToken) return true;
  if (candidateToken.startsWith(queryToken) && queryToken.length >= 3) return true;
  const tolerance = tokenTolerance(queryToken);
  if (tolerance === 0) return false;
  return editDistance(queryToken, candidateToken, tolerance) <= tolerance;
}

export interface FuzzyCandidate {
  title: string;
  composer?: string | null;
  catalog?: string | null;
}

/**
 * How well one candidate answers the query: the share of the query's significant
 * tokens that hit the title, the composer or the catalog number, with a bonus for
 * the title. 0..1 — 0 means "no evidence at all".
 */
export function fuzzyScore(query: string, candidate: FuzzyCandidate): number {
  const queryTokens = searchTokens(query).filter(
    (token) => !SEARCH_FILLER_WORDS.includes(token),
  );
  if (queryTokens.length === 0) return 0;
  const titleTokens = searchTokens(candidate?.title);
  const otherTokens = [
    ...searchTokens(candidate?.composer),
    ...searchTokens(candidate?.catalog),
  ];
  let hits = 0;
  let titleHits = 0;
  for (const token of queryTokens) {
    if (titleTokens.some((candidateToken) => tokenMatches(token, candidateToken))) {
      hits += 1;
      titleHits += 1;
      continue;
    }
    if (otherTokens.some((candidateToken) => tokenMatches(token, candidateToken))) {
      hits += 1;
    }
  }
  if (hits === 0) return 0;
  const coverage = hits / queryTokens.length;
  const titleWeight = titleHits / queryTokens.length;
  return Math.min(1, coverage * 0.7 + titleWeight * 0.3);
}

/** Candidates ranked for a query, best first, below `minScore` dropped. */
export function rankFuzzyMatches<T extends FuzzyCandidate>(
  query: string,
  candidates: ReadonlyArray<T> | null | undefined,
  opts: { limit?: number; minScore?: number } = {},
): { item: T; score: number }[] {
  const list = Array.isArray(candidates) ? candidates : [];
  const minScore = typeof opts.minScore === 'number' ? opts.minScore : 0.5;
  const limit = typeof opts.limit === 'number' && opts.limit > 0 ? Math.floor(opts.limit) : 20;
  return list
    .map((item, order) => ({ item, order, score: fuzzyScore(query, item) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => (b.score === a.score ? a.order - b.order : b.score - a.score))
    .slice(0, limit)
    .map(({ item, score }) => ({ item, score }));
}

/** Halve one doubled letter run ("toccatta" → "toccata"); '' when there is none. */
export function halveDoubledRuns(token: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < token.length - 1; i++) {
    if (token[i] === token[i + 1]) {
      const variant = `${token.slice(0, i)}${token.slice(i + 1)}`;
      if (!out.includes(variant)) out.push(variant);
    }
  }
  return out;
}

/**
 * The queries to try, in order, when the user's own words found nothing.
 *
 *   1. the query as typed (normalised) — always first, so nothing is retried
 *      before it has been tried;
 *   2. the filler words dropped ("toccatta and fugue" → "toccatta fugue");
 *   3. the doubled-letter correction, with the filler words dropped
 *      ("toccatta fugue" → "toccata fugue" — the common typo the owner hit);
 *   4. each significant token on its own, longest first (a single good token
 *      beats a whole wrong phrase).
 *
 * Deduplicated, normalised, and never longer than the field's own limit.
 */
export function queryVariants(query: string | null | undefined, max = 8): string[] {
  const typed = normalizeSearchText(query);
  if (typed.length === 0) return [];
  const tokens = typed.split(' ');
  const significant = tokens.filter((token) => !SEARCH_FILLER_WORDS.includes(token));
  const variants: string[] = [typed];

  const push = (value: string) => {
    const normalized = normalizeSearchText(value);
    if (normalized.length > 0 && !variants.includes(normalized)) variants.push(normalized);
  };

  if (significant.length > 0 && significant.length !== tokens.length) {
    push(significant.join(' '));
  }
  // One doubled letter too many, in each significant token, at most one token at
  // a time (two corrections at once is guesswork, and we do not guess). Both the
  // full phrase and the filler-dropped one are tried: "toccatta and fugue" →
  // "toccata and fugue" (the common typo the owner hit) and "toccata fugue".
  for (let i = 0; i < tokens.length; i++) {
    for (const fixed of halveDoubledRuns(tokens[i])) {
      const corrected = tokens.map((other, position) => (position === i ? fixed : other));
      push(corrected.join(' '));
      const correctedSignificant = corrected.filter(
        (token) => !SEARCH_FILLER_WORDS.includes(token),
      );
      if (correctedSignificant.length !== corrected.length) {
        push(correctedSignificant.join(' '));
      }
    }
  }
  for (const token of [...significant].sort((a, b) => b.length - a.length)) {
    if (token.length >= 4) push(token);
  }
  return variants.slice(0, Math.max(1, max));
}

/** The honest line the surface shows when a variant is what actually matched. */
export function retryNoticeLine(typed: string, matched: string): string | null {
  const typedNormalized = normalizeSearchText(typed);
  const matchedNormalized = normalizeSearchText(matched);
  if (!matchedNormalized || matchedNormalized === typedNormalized) return null;
  return `No exact match for “${typed.trim()}” — showing what “${matched}” found in our library.`;
}
