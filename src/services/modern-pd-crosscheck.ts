// ---------------------------------------------------------------------------
// PD cross-check for the modern-song route (backlog 43c1c500 / 718da1e9).
//
// THE BUG THIS FIXES (owner-reproduced 09-25, RC v26 follow-up probe): the owner
// played Lang Lang's recording of Für Elise; the hero button identified it
// correctly and the card came up as "Fur Elise (Piano Version) — Beethoven —
// Modern Song" with retailer CTAs. A 200-year-old public-domain work whose free
// score this app already catalogues was presented as a modern copyrighted song
// to be BOUGHT. The pipeline was honest (pass 2 = the licensed music-ID provider
// identified the RECORDING), but the ROUTING was missing: nothing asked whether
// the identified work is one we already hold.
//
// WHAT THIS MODULE OWNS: the backend half. Given the provider's match
// (`{title, artist, composer}`) it decides whether that recording is of a work
// in OUR public-domain catalog and, when the mapping is CONFIDENT, returns the
// `pd_match` block the app already consumes (app half: PR #134, master 8558419 —
// `src/services/pdRouting.ts` + `PdMatchWire` in `src/types/index.ts`; the app
// then renders the PD-library card instead of the modern interstitial).
//
// THE HONESTY RULES (the same ones that govern every other surface here):
//   • NEVER guess. No title, no candidate, an unreadable catalog, two candidates
//     that fit equally well → NO `pd_match` key at all. The modern match stays
//     exactly what it is today: an honest modern result.
//   • PUBLIC DOMAIN ONLY. The candidate query is `is_public_domain = true` AND
//     the matcher re-checks the flag, so a copyrighted row can never be routed to
//     a "free score" card even if a future query forgets the filter.
//   • COMPOSER AGREEMENT WHEN WE HAVE ONE TO CHECK. The provider's `composer`
//     metadata (Apple Music's `composerName`) must contain the candidate's
//     composer surname as a whole word, otherwise no match — that is what stops
//     a modern title from being read as a classical work.
//   • THE PERFORMER IS NOT A COMPOSER. `artist` is deliberately NOT used as
//     composer evidence: the owner's own case has `artist: "Lang Lang"`, and
//     reading the performer as the composer would veto the correct mapping
//     (surname "lang" ≠ "beethoven"). With no composer metadata the TITLE
//     relation carries the decision alone — the same documented behaviour as
//     `resolvePieceMelody()` in `piece-melody.ts`.
//
// TITLE KEY (why it is cleaned before it is normalised): providers hand back
// release metadata inside the title — the owner's card literally read
// `Fur Elise (Piano Version)`. `cleanSmdQuery()` (the money path's own title
// cleaner) drops bracketed/version-descriptor noise, then `normalizePieceKey()`
// folds case, diacritics and punctuation, so BOTH sides of the comparison are
// the work title a musician would say out loud. Matching rules, strongest first:
//   title-exact         the whole normalised titles are equal;
//   title-leading-words the shorter title is EXACTLY two words and the other
//                       title starts with them ("fur elise" vs "fur elise woo
//                       59") — the two-word floor is what keeps a shared generic
//                       prefix ("piano sonata", shared by ~30 catalog rows) from
//                       turning a correct exact mapping into an "ambiguous" one;
//   title-contained     one title is a whole-word substring of the other AND the
//                       shorter one has at least two words — this is what maps
//                       the owner's `Für Elise` onto our catalogued
//                       `Bagatelle in A Minor (Für Elise)`. The two-word floor
//                       keeps a single generic word ("Home") from latching onto
//                       an unrelated longer PD title.
// Every rule requires a non-empty provider title, so an empty/absent title is
// never a match.
//
// KNOWN, BOUNDED LIMIT (documented, not hidden): composer agreement is by
// SURNAME, the same rule `piece-melody.ts` uses for reference melodies. Two
// composers of the same surname (Bach père et fils) can therefore agree — the
// consequence is a PD card for a PD work of the same family, never a
// copyrighted work offered as free.
//
// The module is pure apart from `loadPdCandidates()`: `matchPdWork()` and
// `toPdMatchWire()` take plain data and are testable under plain `bun test`.
// Evidence: `/home/team/shared/RC-V26-RESULTS.md` (owner's card) and the app's
// `src/services/pdRouting.ts` (the wire contract this must satisfy).
// ---------------------------------------------------------------------------
import { sql } from "~/db";
import { normalizePieceKey } from "./piece-melody";
import { cleanSmdQuery } from "./modern-retailer";
import { pieceAffiliateUrl } from "./piece-affiliate";
import { difficultyLabel } from "./daily-challenge-handler";

/** The `pieces` columns the cross-check compares against. */
export interface PdCandidate {
  id: string;
  title: string;
  composer: string;
  catalog?: string | null;
  genre?: string | null;
  difficulty?: number | null;
  is_public_domain?: boolean | null;
  sheet_music_url?: string | null;
  album_art_url?: string | null;
}

/** The provider (AudD) side of the comparison. */
export interface PdCrossCheckInput {
  title?: string | null;
  /**
   * The RECORDING's performer ("Lang Lang"). Carried for diagnostics only —
   * never treated as composer evidence (see the header).
   */
  artist?: string | null;
  /** Provider composer metadata (Apple Music `composerName`), when present. */
  composer?: string | null;
}

/** How the title relation was established, for diagnostics. */
export type PdMatchKind =
  | "title-exact"
  | "title-leading-words"
  | "title-contained";

/**
 * Rule strength per relation, reported to the app as `match_confidence`. These
 * express how STRONG the evidence is — they are not a provider score, and the
 * app only uses them for the card's confidence figure.
 */
export const MATCH_CONFIDENCE: Record<PdMatchKind, number> = {
  "title-exact": 1,
  "title-leading-words": 0.9,
  "title-contained": 0.85,
};

export interface PdMatch {
  candidate: PdCandidate;
  kind: PdMatchKind;
  confidence: number;
}

/**
 * The `pd_match` block on the /api/recognize-modern response. Field-by-field
 * this mirrors the app's `PdMatchWire`/`PdMatchPayload` (app master 8558419):
 * every key but `id`/`sheet_music_available` is optional, the app validates them
 * again on arrival, and `is_public_domain: true` is the flag the app needs to
 * route the PD card (an explicit `false` would veto it).
 */
export interface PdMatchWire {
  id: string;
  title: string;
  composer: string;
  catalog?: string;
  genre?: string;
  difficulty_label?: string;
  is_public_domain: true;
  sheet_music_available: boolean;
  sheet_music_url?: string;
  album_art_url?: string;
  /** SECONDARY retailer CTA (our own free score is primary). */
  affiliate_url?: string;
  match_confidence: number;
}

/**
 * The catalog read behind the cross-check: every public-domain piece with the
 * columns the PD card needs. 525 rows today, a few tens of KB — small enough to
 * compare in memory, which keeps the matching rules pure and testable. The flag
 * filter is part of the contract, not a convenience: the cross-check must never
 * even see a copyrighted work.
 */
export const PD_CANDIDATE_SQL = `
  SELECT p.id, p.title, p.composer, p.catalog, p.genre, p.difficulty,
         p.is_public_domain, p.sheet_music_url, p.album_art_url
  FROM pieces p
  WHERE p.is_public_domain = true
  ORDER BY p.title, p.id
  LIMIT 2000`;

/** Non-empty trimmed string, or undefined — the app's own wire convention. */
function nonEmpty(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The comparable title key: release metadata stripped (a provider title can
 * carry `(Piano Version)`, `[2003 Remaster]` — the owner's own card did), then
 * diacritics/punctuation/case folded.
 */
export function crossCheckTitleKey(title: string | null | undefined): string {
  if (typeof title !== "string" || title.trim() === "") return "";
  return normalizePieceKey(cleanSmdQuery(title));
}

/** First two words of a title key — "fur elise" from "fur elise woo 59". */
function leadingWords(key: string): string {
  return key.split(" ").slice(0, 2).join(" ");
}

/** Whole-word substring test (`ann` must not match inside `anne`). */
function containsWholeWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/** Composer surname — the last token of the normalised name. */
export function composerSurname(composer: string | null | undefined): string {
  const key = normalizePieceKey(composer);
  if (key === "") return "";
  const parts = key.split(" ");
  return parts[parts.length - 1] ?? "";
}

/**
 * Whether the provider's composer metadata agrees with a candidate's composer.
 *
 * - no provider composer → true (nothing to check; the title relation decides —
 *   the Lang Lang case, see the header);
 * - provider composer but no candidate composer → false (unverifiable);
 * - otherwise the candidate's surname must appear as a whole word in the
 *   provider's string, which tolerates word order ("Beethoven, Ludwig van") and
 *   particles ("van") without ever accepting a different name.
 */
export function composerAgrees(
  candidateComposer: string | null | undefined,
  providerComposer: string | null | undefined,
): boolean {
  const providerKey = normalizePieceKey(providerComposer);
  if (providerKey === "") return true;
  const surname = composerSurname(candidateComposer);
  if (surname === "") return false;
  return containsWholeWords(providerKey, surname);
}

/** The strongest title relation between the provider title and a candidate. */
function titleRelation(
  providerKey: string,
  candidateTitle: string,
): PdMatchKind | null {
  const candidateKey = normalizePieceKey(candidateTitle);
  if (candidateKey === "") return null;
  if (candidateKey === providerKey) return "title-exact";

  const providerWords = providerKey.split(" ").length;
  const candidateWords = candidateKey.split(" ").length;
  // Leading words only when the SHORTER title is exactly two words: that is the
  // "Für Elise" vs "Für Elise WoO 59" shape, where the provider's whole title is
  // the other title's opening. Without the two-word floor this rule fires on any
  // shared generic prefix — a real catalog probe (2026-09-25) found a 7-word
  // provider title ("Piano Sonata No. 14 in C-sharp Minor (Moonlight)") matching
  // every one of the ~30 "Piano Sonata No…" rows on "piano sonata" alone, which
  // then looked AMBIGUOUS and suppressed a correct exact-title mapping.
  if (Math.min(providerWords, candidateWords) === 2 && leadingWords(candidateKey) === leadingWords(providerKey)) {
    return "title-leading-words";
  }

  // Containment is only trustworthy when the CONTAINED title carries at least
  // two words: a single generic word ("home") would otherwise latch onto any
  // longer PD title that happens to include it.
  const shorter = providerWords <= candidateWords ? providerKey : candidateKey;
  if (shorter.split(" ").length < 2) return null;
  if (containsWholeWords(candidateKey, providerKey) || containsWholeWords(providerKey, candidateKey)) {
    return "title-contained";
  }
  return null;
}

/**
 * The confident PD mapping for a provider match, or null.
 *
 * Runs the whole decision: public-domain candidates only, a non-empty provider
 * title, a title relation, composer agreement, and NO AMBIGUITY — two candidates
 * that fit equally well return null, because picking one would be a guess.
 */
export function matchPdWork(
  input: PdCrossCheckInput | null | undefined,
  candidates: readonly PdCandidate[] | null | undefined,
): PdMatch | null {
  const providerKey = crossCheckTitleKey(input?.title);
  if (providerKey === "") return null;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const hits: PdMatch[] = [];
  for (const candidate of candidates) {
    // Belt and braces: the SQL already restricts to public domain, but the
    // decision itself must never be able to route a copyrighted row.
    if (candidate?.is_public_domain !== true) continue;
    if (typeof candidate.id !== "string" || candidate.id === "") continue;
    if (typeof candidate.title !== "string" || candidate.title.trim() === "") continue;
    const kind = titleRelation(providerKey, candidate.title);
    if (kind === null) continue;
    if (!composerAgrees(candidate.composer, input?.composer)) continue;
    hits.push({ candidate, kind, confidence: MATCH_CONFIDENCE[kind] });
  }

  if (hits.length !== 1) return null; // none, or ambiguous → never a guess
  return hits[0];
}

/**
 * Serialize a match to the `pd_match` wire block the app consumes. Keys with no
 * value are OMITTED rather than sent empty, so the app's own `nonEmptyString`
 * validation never has to defend against an empty string.
 */
export function toPdMatchWire(match: PdMatch): PdMatchWire {
  const c = match.candidate;
  const sheetUrl = nonEmpty(c.sheet_music_url);
  const albumArt = nonEmpty(c.album_art_url);
  const catalog = nonEmpty(c.catalog);
  const genre = nonEmpty(c.genre);
  const difficulty = difficultyLabel(c.difficulty ?? null) ?? undefined;
  // The SAME affiliate builder the piece pages and /api/pieces use (Sheet Music
  // Direct, ID 67650) — one attributable CTA path, never a hand-written URL.
  const affiliate = pieceAffiliateUrl(c.title, c.composer) ?? undefined;

  return {
    id: c.id,
    title: c.title,
    composer: c.composer,
    ...(catalog ? { catalog } : {}),
    ...(genre ? { genre } : {}),
    ...(difficulty ? { difficulty_label: difficulty } : {}),
    is_public_domain: true,
    // A fact, not a promise: true only when this piece really has a score of
    // ours. False means the card offers the honest "coming soon" state plus the
    // secondary retailer CTA — never a broken link.
    sheet_music_available: !!sheetUrl,
    ...(sheetUrl ? { sheet_music_url: sheetUrl } : {}),
    ...(albumArt ? { album_art_url: albumArt } : {}),
    ...(affiliate ? { affiliate_url: affiliate } : {}),
    match_confidence: match.confidence,
  };
}

/** Read the public-domain catalog the cross-check compares against. */
export async function loadPdCandidates(): Promise<PdCandidate[]> {
  const rows = (await sql().query(PD_CANDIDATE_SQL)) as unknown as PdCandidate[];
  return Array.isArray(rows) ? rows : [];
}

/** The cross-check's answer for one provider match. */
export type PdCrossCheckFn = (
  input: PdCrossCheckInput,
) => Promise<PdMatchWire | null>;

/**
 * How long the catalog read may take before it is abandoned. The cross-check
 * rides on the recognition response — the app's core action — so a hanging
 * database (Neon scale-to-zero cold start, a stalled HTTP query) must degrade to
 * "no PD route" instead of holding the user's recognition open. Cold starts
 * measured at ~1-2s, so this is generous headroom, not a tight budget.
 */
export const PD_CATALOG_READ_TIMEOUT_MS = 3000;

/** Await a catalog read, abandoning it after `timeoutMs`. */
async function loadWithTimeout(
  load: () => Promise<PdCandidate[]>,
  timeoutMs: number,
): Promise<PdCandidate[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`pd catalog read timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Cross-check a provider match against the public-domain catalog.
 *
 * Returns the `pd_match` block, or null — and NULL IS THE ANSWER FOR EVERY
 * uncertainty, including a catalog read that fails OR TAKES TOO LONG. A modern
 * recognition must never break (or hang) because this enhancement could not run:
 * the route degrades to the honest modern result it returned before this module
 * existed.
 */
export async function crossCheckPdCatalog(
  input: PdCrossCheckInput,
  load: () => Promise<PdCandidate[]> = loadPdCandidates,
  timeoutMs: number = PD_CATALOG_READ_TIMEOUT_MS,
): Promise<PdMatchWire | null> {
  if (crossCheckTitleKey(input?.title) === "") return null;
  let candidates: PdCandidate[];
  try {
    candidates = await loadWithTimeout(load, timeoutMs);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[pd-crosscheck] public-domain catalog read failed — no PD route for this match:",
      err,
    );
    return null;
  }
  const match = matchPdWork(input, candidates);
  return match ? toPdMatchWire(match) : null;
}
