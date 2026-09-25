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
 *     request 09-25), else the honest generic "Modern song", and gets the
 *     official-sheet-music CTA. Never "Classical".
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
 * The FALLBACK category for a modern (copyrighted, non-library) match — used
 * only when the provider gave us no genre of its own.
 *
 * Owner request 09-25: the hardcoded "Modern song" label had to go. A modern
 * match now shows the PROVIDER'S genre ("Hard Rock", "Modern Jazz", "Ambient")
 * when the backend sends one (see modernGenreLabel below), and only falls back
 * to this honest generic category when it does not.
 */
export const FALLBACK_MODERN_GENRE = 'Modern song';

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
 * The category label for a MODERN match: the provider's own genre when the
 * backend carried one (`/api/recognize-modern` maps AudD's Apple Music /
 * Spotify genre — see the site's modern-genre.ts), else the honest generic
 * FALLBACK_MODERN_GENRE. Never "Classical", and never an invented genre.
 *
 * This is the ONLY place a modern match's genre string may be produced; the
 * interstitial, the History save and the search screen all resolve through it.
 */
export function modernGenreLabel(
  result: { genre?: string | null } | null | undefined,
): string {
  return clean(result?.genre) ?? FALLBACK_MODERN_GENRE;
}

/**
 * The category label for a recognition match.
 *
 * Modern → its provider genre, else "Modern song" (never "Classical"); public
 * domain → the catalog's own genre, else "Public domain".
 */
export function resultGenreLabel(match: GenreSource | null | undefined): string {
  if (isModernResult(match)) return modernGenreLabel(match);
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
  kind: 'classical-fallback' | 'classical-genre-value';
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
