/**
 * tier1.ts — pure parsing + decision helpers for the two Tier-1 recognition
 * surfaces: hum/whistle/sing-to-search (POST /api/hum) and modern-song
 * recognition (POST /api/recognize-modern).
 *
 * Kept FREE of any react-native / expo imports so it compiles and runs under
 * plain Node (see scripts/tier1.test.ts) — these helpers centralise the
 * response-shape validation and the honest match-vs-no-match decision so the
 * UI never has to reinvent either, and the tests lock both down.
 */
import type {
  HumResponse,
  HumMatch,
  HumContourStats,
  ModernResponse,
  ModernMatch,
} from "../types";

/**
 * A hummed phrase is only worth matching if the server actually extracted a
 * usable melodic contour. If the contour is non-empty but shorter than this,
 * tell the user to hum a longer phrase rather than showing a guess.
 */
export const MIN_HUM_PHRASE_DELTAS = 3;

// ─── /api/hum — validate + normalize ─────────────────────────

/** Validate + normalize a POST /api/hum JSON payload. Returns null when the
 *  payload isn't the expected shape (callers surface a generic error). Never
 *  throws. */
export function parseHumResponse(raw: unknown): HumResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.success !== true || !Array.isArray(r.matches)) return null;

  const matches: HumMatch[] = [];
  for (const m of r.matches) {
    if (!m || typeof m !== "object") continue;
    const mm = m as Record<string, unknown>;
    if (typeof mm.piece_id !== "string" || !mm.piece_id) continue;
    matches.push({
      piece_id: mm.piece_id,
      title: typeof mm.title === "string" && mm.title ? mm.title : mm.piece_id,
      composer: typeof mm.composer === "string" ? mm.composer : "",
      confidence: typeof mm.confidence === "number" ? mm.confidence : 0,
    });
  }

  const cs = (typeof r.contour_stats === "object" && r.contour_stats
    ? r.contour_stats
    : null) as Record<string, unknown> | null;

  let contourStats: HumContourStats | undefined;
  if (cs) {
    contourStats = {
      notes: typeof cs.notes === "number" ? cs.notes : 0,
      deltas: typeof cs.deltas === "number" ? cs.deltas : 0,
      voiced_frames: typeof cs.voiced_frames === "number" ? cs.voiced_frames : 0,
      total_frames: typeof cs.total_frames === "number" ? cs.total_frames : 0,
      extracted_pitches: Array.isArray(cs.extracted_pitches)
        ? (cs.extracted_pitches as number[])
        : undefined,
      extracted_deltas: Array.isArray(cs.extracted_deltas)
        ? (cs.extracted_deltas as number[])
        : undefined,
    };
  }

  const unclearReasons: string[] = [];
  if (Array.isArray(r.input_unclear_reasons)) {
    for (const reason of r.input_unclear_reasons) {
      if (typeof reason === "string" && reason) unclearReasons.push(reason);
    }
  }
  const message =
    typeof r.message === "string" && r.message ? r.message : undefined;
  const hint = typeof r.hint === "string" && r.hint ? r.hint : undefined;

  return {
    success: true,
    matches,
    query_duration_ms:
      typeof r.query_duration_ms === "number" ? r.query_duration_ms : 0,
    db_available: r.db_available !== false,
    contour_stats: contourStats,
    no_confident_match_reason:
      typeof r.no_confident_match_reason === "string"
        ? r.no_confident_match_reason
        : undefined,
    input_unclear: r.input_unclear === true,
    input_unclear_reasons: unclearReasons,
    message,
    hint,
  };
}

export interface HumOutcome {
  /** true = confident match to present; false = honest no-match (with reason). */
  ok: boolean;
  matches: HumMatch[];
  topMatch?: HumMatch;
  reason?: string;
  /** true when the server flagged the capture as degraded (unstable pitch etc.)
   *  and sent coaching guidance — the reason then holds the server's message. */
  inputUnclear?: boolean;
  contourStats?: HumContourStats;
}

/** The honest match-vs-no-match decision for a hum search. NEVER fabricates a
 *  title: empty matches (the server's "no confident-wrong" gate) → no-match
 *  with the server's reason (or a sensible default). When the server flagged
 *  the recording as unclear (input_unclear:true), that reason is surfaced
 *  verbatim so the UI can coach instead of showing a bare miss. */
export function humOutcome(resp: HumResponse): HumOutcome {
  if (resp.matches.length === 0) {
    if (resp.input_unclear) {
      return {
        ok: false,
        matches: [],
        inputUnclear: true,
        reason:
          resp.message ??
          resp.hint ??
          "We couldn't hear a clear melody — move closer to the mic, find a quieter room, and record a steady, slower, clearly-phrased tune, then try again.",
      };
    }
    return {
      ok: false,
      matches: [],
      reason:
        resp.no_confident_match_reason ??
        "We couldn't identify that melody — hum or whistle a longer, clearer phrase and try again.",
    };
  }
  return {
    ok: true,
    matches: resp.matches,
    topMatch: resp.matches[0],
    contourStats: resp.contour_stats,
  };
}

/**
 * A short-phrase hint for the UI, independent of whether a match was found.
 * If the server extracted a contour but it's too short to be trustworthy,
 * nudge the user to hum a longer phrase (returned alongside any result).
 */
export function humPhraseHint(resp: HumResponse): string | undefined {
  if (!resp.contour_stats) return undefined;
  const deltas = resp.contour_stats.deltas;
  if (deltas > 0 && deltas < MIN_HUM_PHRASE_DELTAS) {
    return "That phrase was quite short — hum or whistle a longer melody for a more confident match.";
  }
  return undefined;
}

// ─── /api/recognize-modern — validate + normalize ────────────

/** Validate + normalize a POST /api/recognize-modern JSON payload. Returns null
 *  when the payload isn't the expected shape. Never throws. */
export function parseModernResponse(raw: unknown): ModernResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.success !== true) return null;
  if (r.recognized !== "modern" && r.recognized !== "none") return null;

  let modern: ModernMatch | null = null;
  const m = r.modern;
  if (r.recognized === "modern" && m && typeof m === "object") {
    const mm = m as Record<string, unknown>;
    if (typeof mm.song === "string" && mm.song) {
      modern = {
        song: mm.song,
        artist:
          typeof mm.artist === "string" && mm.artist ? mm.artist : "Unknown",
        album: typeof mm.album === "string" ? mm.album : undefined,
        isrc: typeof mm.isrc === "string" ? mm.isrc : undefined,
        albumArtUrl:
          typeof mm.albumArtUrl === "string" ? mm.albumArtUrl : undefined,
        composer: typeof mm.composer === "string" ? mm.composer : undefined,
        matchConfidence:
          typeof mm.matchConfidence === "number" ? mm.matchConfidence : 1,
        source: typeof mm.source === "string" ? mm.source : "unknown",
        retailerUrl:
          typeof mm.retailerUrl === "string" ? mm.retailerUrl : undefined,
      };
    }
  }

  return {
    success: true,
    modern,
    recognized: r.recognized,
    source: typeof r.source === "string" ? r.source : "unknown",
    query_duration_ms:
      typeof r.query_duration_ms === "number" ? r.query_duration_ms : 0,
  };
}

export interface ModernOutcome {
  /** true = a copyrighted song was identified and its metadata is present. */
  recognized: boolean;
  match?: ModernMatch;
}

/** The modern-song outcome: recognized only when the server returned a real
 *  match object (recognized === "modern" AND parse produced one). A null
 *  modern with recognized === "none" is an honest no-match. */
export function modernOutcome(resp: ModernResponse): ModernOutcome {
  if (resp.recognized === "modern" && resp.modern) {
    return { recognized: true, match: resp.modern };
  }
  return { recognized: false };
}
