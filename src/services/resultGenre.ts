/**
 * resultGenre.ts — the CATEGORY a recognition result is allowed to claim.
 *
 * Owner-reported (09-23, re-confirmed 09-24 with a repro): the recognition result
 * card labelled a modern/AudD match (ZZ Top) as "classical". A category mistake:
 * a copyrighted modern song is not a classical piece, and a learner who sees that
 * label stops trusting every other label the app shows.
 *
 * Where the old label came from — three copies of the same fallback, all in the
 * result-card path:
 *
 *   • src/components/RecognitionResultView.tsx — `genre: match.catalog ?? 'Classical'`
 *     (so a match with no catalog number — i.e. every non-library/modern song —
 *     became "Classical" on the piece page the card opens);
 *   • src/services/historyPiece.ts — `HISTORY_DEFAULT_GENRE = 'Classical'`, the
 *     default for EVERY saved recognition that carried no genre, which is exactly
 *     the record the modern flow writes (ModernSearchScreen saved song + artist
 *     and no genre);
 *   • src/services/api.ts / src/screens/HumSearchScreen.tsx — the same literal as
 *     the "no genre in the payload" default.
 *
 * The rule this module owns, and the only place these strings may live:
 *
 *   • a match that is NOT public domain (recognised through the licensed
 *     fingerprint service — a modern, copyrighted song) shows the PROVIDER'S
 *     genre when the backend carries one ("Hard Rock", "Ambient", … — owner
 *     request 09-25) and OTHERWISE SHOWS NO GENRE LINE AT ALL (`modernGenreLabel`
 *     → null; owner 09-25 build #3 — the neutral "Modern song" fallback is
 *     retired, because an invented category is what the owner stopped trusting).
 *     Never "Classical".
 *   • a public-domain match shows the catalog's OWN genre when the payload has
 *     one (the backend sends `genre`; the app used to drop it and print the
 *     catalog NUMBER in the genre slot instead), else the honest
 *     "Public domain" — a fact the app knows for certain.
 *   • a record with no genre information at all (a legacy History row) is
 *     "Uncategorised". We do not know, so we do not claim.
 *
 * The scanner at the bottom is the regression guard: it reads the app's own
 * source and fails the tier1 gate if any surface hardcodes a genre value or
 * defaults a genre to "Classical" again. See scripts/resultGenreContract.test.ts.
 *
 * Pure by design (no react / react-native / fs / path) so the tier1 gate can
 * compile it with node_modules absent (see tsconfig.tier1.json).
 */
import { maskComments } from './modalBackContract';

/**
 * RETIRED (build #3, owner 09-25): the neutral "Modern song" fallback label.
 *
 * It is deliberately GONE rather than kept as a default. The card omits its
 * genre line when the provider sent none (`modernGenreLabel` → null); a
 * hardcoded neutral category re-appearing anywhere in the result path would
 * re-create the exact label the owner rejected, so the guard suite asserts the
 * literal never comes back (scripts/resultGenreContract.test.ts).
 */
export const FALLBACK_MODERN_GENRE_RETIRED = 'Modern song';

/**
 * The category for a piece served from our own free library. A fact the app
 * knows for certain (`is_public_domain === true`), never an invented genre.
 */
export const PUBLIC_DOMAIN_GENRE = 'Public domain';

/**
 * The category for a record that carries no genre information — an old History
 * row, or a legacy saved recognition. Honest about the gap.
 */
export const UNCATEGORISED_GENRE = 'Uncategorised';

/** This module's own repo-relative path (it names the strings in its patterns). */
export const RESULT_GENRE_MODULE_PATH = 'src/services/resultGenre.ts';

/** A non-empty, trimmed string — or undefined. Never empty whitespace. */
function clean(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The genre-bearing fields a result can carry, from any of the app's shapes. */
export interface GenreSource {
  /** `true` only for a piece we serve from our own public-domain library. */
  is_public_domain?: boolean | null;
  /** The catalog's own genre, when the payload carries one. */
  genre?: string | null;
  /**
   * The piece's catalog NUMBER (e.g. "WoO 59", "BWV 971"). Accepted so a whole
   * match can be passed straight in — and deliberately NOT treated as a genre:
   * printing it in the genre slot is the defect the old card had.
   */
  catalog?: string | null;
}

/**
 * True when a match is a MODERN (copyrighted, non-library) result: anything the
 * backend did not mark public domain. The flag is explicit — absence of
 * `is_public_domain: true` means we cannot call it a library piece, and that is
 * exactly the case that must never be labelled classical.
 */
export function isModernResult(match: GenreSource | null | undefined): boolean {
  return match != null && match.is_public_domain !== true;
}

/**
 * The provider's own genre for a modern match, or null when the provider sent
 * none.
 *
 * OWNER 09-25 (build #3): the neutral "Modern song" fallback had to go. The owner
 * reported it on Otis Redding's "Just One More Day" and Roxy Music's "More Than
 * This" — both provider matches with NO genre — and again on Lang Lang's
 * recording of Für Elise, where "Modern Song" on a 200-year-old public-domain
 * work was a category error. The rule is now the strictest one: SHOW WHAT THE
 * PROVIDER SAID, ELSE SHOW NOTHING. The card omits its genre line rather than
 * inventing a category, because an invented category is the thing the owner
 * stopped trusting.
 */
export function modernGenreLabel(
  result: { genre?: string | null } | null | undefined,
): string | null {
  return clean(result?.genre) ?? null;
}

/**
 * The genre label to RENDER on a modern card, or null when the line must be
 * omitted (the provider sent no genre). Named so the screens read the rule from
 * here rather than re-deciding it — `{modernGenreLabel(result) && <Text …>}` is
 * exactly the shape this returns for.
 */
export function modernGenreLine(
  result: { genre?: string | null } | null | undefined,
): string | null {
  return modernGenreLabel(result);
}

/**
 * The category label for a recognition match, as a NON-EMPTY string (this is the
 * value stamped on a saved recognition and on the piece page a result opens, so
 * it can never be blank).
 *
 * Public domain → the catalog's own genre, else "Public domain" (a fact). Modern
 * → the PROVIDER'S genre, else "Uncategorised" — we do not know, so we say so;
 * the modern CARD omits the line entirely through `modernGenreLabel` (this
 * string is the stored/derived value, not the card's line).
 */
export function resultGenreLabel(match: GenreSource | null | undefined): string {
  if (isModernResult(match)) return modernGenreLabel(match) ?? UNCATEGORISED_GENRE;
  return clean(match?.genre) ?? PUBLIC_DOMAIN_GENRE;
}

/**
 * The category label for a SAVED recognition (a History row), which carries only
 * what was stored at save time. A modern save stores its genre (or
 * FALLBACK_MODERN_GENRE), so it survives; a legacy row with no genre is
 * "Uncategorised" — not classical.
 */
export function savedGenreLabel(genre: string | null | undefined): string {
  return clean(genre) ?? UNCATEGORISED_GENRE;
}

// ─── Source-contract scanner ────────────────────────────────────

/**
 * A genre value or default written into the app source as the literal
 * "Classical" — the defect this module exists to prevent
 * (`genre: match.catalog ?? 'Classical'`, `genre: 'Classical'`,
 * `HISTORY_DEFAULT_GENRE = 'Classical'`).
 */
export const CLASSICAL_GENRE_LITERAL_PATTERN = /['"][Cc]lassical['"]/;

/**
 * The genre TOKENS a line must carry to be a genre assignment: the lowercase
 * property (`genre:`, `genre =`) or an all-caps constant suffix (`_GENRE`).
 * Deliberately NOT a case-insensitive "genre": the onboarding genre PICKER
 * (`label: 'Classical'` next to `as Genre`) names a real user-facing genre and
 * is not a claim about a recognised piece.
 */
export const GENRE_ASSIGNMENT_TOKEN_PATTERN = /(?:genre\b|GENRE\b)/;

/**
 * A fallback to "Classical" (`?? 'Classical'`, `|| "Classical"`) — a default by
 * construction, wherever it appears.
 */
export const CLASSICAL_FALLBACK_PATTERN = /(?:\?\?|\|\|)\s*['"][Cc]lassical['"]/;

export interface GenreLabelOffender {
  path: string;
  /** 1-based line number. */
  line: number;
  /** Why the line was flagged. */
  kind: 'classical-fallback' | 'classical-genre-value' | 'modern-song-genre-invented';
  text: string;
}

/** Pure source scanner (the team's source-contract pattern). */
export function scanSourcesForClassicalGenreDefaults(
  files: readonly { path: string; source: string }[],
  allow: readonly string[] = [RESULT_GENRE_MODULE_PATH],
): GenreLabelOffender[] {
  const allowed = new Set(allow);
  const offenders: GenreLabelOffender[] = [];
  for (const file of files) {
    if (allowed.has(file.path)) continue;
    // Comments are blanked (length- and newline-preserving) before matching, so
    // a comment that DOCUMENTS the old bug can never fail the gate, while real
    // code — including the string literal itself — still does.
    const lines = maskComments(file.source).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      if (!CLASSICAL_GENRE_LITERAL_PATTERN.test(text)) continue;
      const isFallback = CLASSICAL_FALLBACK_PATTERN.test(text);
      if (!isFallback && !GENRE_ASSIGNMENT_TOKEN_PATTERN.test(text)) continue;
      offenders.push({
        path: file.path,
        line: i + 1,
        kind: isFallback ? 'classical-fallback' : 'classical-genre-value',
        text: text.trim().slice(0, 160),
      });
    }
  }
  return offenders;
}

/** One-line report per offender, ready to print in a test failure. */
export function formatGenreLabelOffenders(
  offenders: readonly GenreLabelOffender[],
): string[] {
  return offenders.map(
    (o) =>
      `${o.path}:${o.line} — a result genre is hardcoded/defaulted to "Classical" (${o.kind}); use resultGenreLabel() / modernGenreLabel() / PUBLIC_DOMAIN_GENRE instead: ${o.text}`,
  );
}

// ─── the retired neutral modern label (owner 09-25, build #3) ───────────────

/**
 * The retired literal, as a genre VALUE or a genre DEFAULT in source text: the
 * `'Modern song'` string assigned to a genre, or used as a `??` / `||` default.
 * A mention in prose (a comment, this module's own note) is not an offence —
 * comments are blanked before matching, exactly like the classical scanner.
 */
export const INVENTED_MODERN_GENRE_LITERAL_PATTERN = /['"][Mm]odern\s+[Ss]ong['"]/;
export const INVENTED_MODERN_GENRE_DEFAULT_PATTERN =
  /(?:\?\?|\|\|)\s*['"][Mm]odern\s+[Ss]ong['"]/;

/**
 * Every place a genre is assigned or defaulted to the retired neutral label.
 *
 * Why this exists: the owner rejected "Modern Song" twice — on provider matches
 * that carried no genre at all, and (worse) on Lang Lang's recording of a
 * public-domain work. The fix is omission, and omission is invisible in a
 * passing build, so the guard has to be a source scan: a screen that
 * re-introduces `genre: modernGenreLabel(m) ?? 'Modern song'` fails the gate.
 */
export function scanSourcesForInventedModernGenre(
  files: readonly { path: string; source: string }[],
  allow: readonly string[] = [RESULT_GENRE_MODULE_PATH],
): GenreLabelOffender[] {
  const allowed = new Set(allow);
  const offenders: GenreLabelOffender[] = [];
  for (const file of files) {
    if (allowed.has(file.path)) continue;
    const lines = maskComments(file.source).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      if (!INVENTED_MODERN_GENRE_LITERAL_PATTERN.test(text)) continue;
      const isFallback = INVENTED_MODERN_GENRE_DEFAULT_PATTERN.test(text);
      if (!isFallback && !GENRE_ASSIGNMENT_TOKEN_PATTERN.test(text)) continue;
      offenders.push({
        path: file.path,
        line: i + 1,
        kind: 'modern-song-genre-invented',
        text: text.trim().slice(0, 160),
      });
    }
  }
  return offenders;
}

/** One-line report per invented-genre offender, ready to print in a failure. */
export function formatInventedModernGenreOffenders(
  offenders: readonly GenreLabelOffender[],
): string[] {
  return offenders.map(
    (o) =>
      `${o.path}:${o.line} — a genre is set to the retired neutral label "Modern song" (${o.kind}); a modern match shows the PROVIDER's genre or NO genre line at all (modernGenreLabel() → null): ${o.text}`,
  );
}
