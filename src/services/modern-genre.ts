/**
 * modern-genre.ts — the REAL genre label for a modern-song match (owner
 * request 09-25: the hardcoded "Modern song" was not good enough — a ZZ Top
 * result must be able to say "Hard Rock").
 *
 * The genre comes from the music-ID provider's own metadata, never from a
 * taxonomy we invent. AudD returns the Apple Music and Spotify blocks; both can
 * carry genres, and the Apple Music block is asked for explicitly (see the
 * `return=apple_music,spotify` parameter in modern-recognize-handler.ts).
 *
 * Rules, deliberately conservative:
 *   • Apple Music wins over Spotify (it is the block we request for metadata).
 *   • The FIRST non-empty genre of the preferred block wins; provider wording is
 *     kept, only trimmed and title-cased ("hard rock" → "Hard Rock"), so a
 *     provider that already says "Modern Jazz" or "R&B/Soul" is untouched.
 *   • No genre anywhere → undefined, and the caller OMITS the field. The app then
 *     falls back to its honest generic category — we never guess a genre.
 *
 * Pure by design (no I/O), so the site test gate covers it directly.
 */

/**
 * Title-case a provider genre WITHOUT rewriting it: a word is only touched when
 * it is entirely lower-case, so "hip hop" → "Hip Hop" while "R&B/Soul" and
 * "Modern Jazz" are left exactly as the provider wrote them.
 */
export function cleanModernGenre(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return undefined;
  return trimmed
    .split(" ")
    .map((word) => (/^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** The genres array of a provider block, as a plain array (or []). */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The first usable genre out of one provider block. Tolerates the shapes a
 * vendor can return: a plain string, a list of strings, or a list of objects
 * carrying `name` / `genreName` (Apple Music's own `genreNames`).
 */
function firstGenreOf(block: unknown, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = (block as Record<string, unknown> | null | undefined)?.[key];
    if (typeof value === "string") {
      const cleaned = cleanModernGenre(value);
      if (cleaned) return cleaned;
    }
    for (const entry of asArray(value)) {
      const candidate =
        typeof entry === "string"
          ? entry
          : ((entry as Record<string, unknown> | null)?.name ??
            (entry as Record<string, unknown> | null)?.genreName);
      const cleaned = cleanModernGenre(candidate);
      if (cleaned) return cleaned;
    }
  }
  return undefined;
}

/**
 * The genre for a provider result: Apple Music first (both the `genres` field
 * and Apple Music's own `genreNames`), then Spotify. Undefined when neither
 * block carries a genre — the caller omits the field.
 */
export function pickModernGenre(result: unknown): string | undefined {
  const r = (result ?? {}) as Record<string, unknown>;
  return (
    firstGenreOf(r.apple_music, ["genres", "genreNames"]) ??
    firstGenreOf(r.spotify, ["genres", "genreNames"])
  );
}
