/**
 * GET /api/daily-challenge — deterministic "piece of the day" for the app's
 * Daily Challenge card.
 *
 * The same date always returns the same piece for every user: the pool is the
 * real curated catalog (pieces that have a fingerprint AND a curated sheet in
 * R2 — i.e. recognisable AND playable today), and the selection index is a
 * djb2 hash of the date string (YYYY-MM-DD) modulo the pool size.
 *
 * Honest availability: is_public_domain and sheet_music_available are computed
 * from the actual catalog row — never invented. If the sheet-available pool
 * were ever empty, the handler falls back to the full recognisable catalog
 * (fingerprints only) and reports sheet_music_available=false so the app shows
 * its "coming soon" state instead of a dead link.
 *
 * Query params:
 *   ?date=YYYY-MM-DD  — override the date (used for determinism testing);
 *                       defaults to the server's UTC date.
 */
import { sql } from "~/db";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** djb2 hash — same algorithm the app's original local picker used. */
function djb2(dateStr: string): number {
  let hash = 5381;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) + hash) + dateStr.charCodeAt(i);
    hash = hash & hash; // 32-bit
  }
  return Math.abs(hash);
}

/** Map the catalog's 1-10 grade to the app's Beginner/Intermediate/Advanced labels. */
export function difficultyLabel(grade: number | null): string | null {
  if (grade == null) return null;
  if (grade <= 3) return "Beginner";
  if (grade <= 7) return "Intermediate";
  return "Advanced";
}

interface CatalogPiece {
  id: string;
  title: string;
  composer: string;
  catalog: string | null;
  genre: string | null;
  difficulty: number | null;
  is_public_domain: boolean | null;
  sheet_music_url: string | null;
}

function corsJson(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

export async function handleDailyChallenge(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return corsJson({ error: "Method not allowed. Use GET." }, 405);
  }

  const url = new URL(req.url);
  const rawDate = url.searchParams.get("date");
  const date = rawDate ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(date)) {
    return corsJson({ error: "date must be YYYY-MM-DD" }, 400);
  }

  // Tier 1: recognisable AND playable (fingerprint + curated sheet in R2).
  let pool: CatalogPiece[] = [];
  try {
    pool = (await sql()`
      SELECT p.id, p.title, p.composer, p.catalog, p.genre, p.difficulty,
             p.is_public_domain, p.sheet_music_url
      FROM pieces p
      WHERE EXISTS (SELECT 1 FROM fingerprints f WHERE f.piece_id = p.id)
        AND p.sheet_music_url IS NOT NULL AND p.sheet_music_url <> ''
      ORDER BY p.title, p.id
    `) as unknown as CatalogPiece[];
  } catch (err) {
    console.error("[daily-challenge] catalog lookup failed:", err);
    return corsJson({ error: "catalog unavailable" }, 503);
  }

  // Tier 2 (defensive): recognisable catalog without curated sheets — the app
  // must show the honest "coming soon" state rather than a broken link.
  if (pool.length === 0) {
    try {
      pool = (await sql()`
        SELECT p.id, p.title, p.composer, p.catalog, p.genre, p.difficulty,
               p.is_public_domain, p.sheet_music_url
        FROM pieces p
        WHERE EXISTS (SELECT 1 FROM fingerprints f WHERE f.piece_id = p.id)
        ORDER BY p.title, p.id
      `) as unknown as CatalogPiece[];
    } catch (err) {
      console.error("[daily-challenge] fallback catalog lookup failed:", err);
      return corsJson({ error: "catalog unavailable" }, 503);
    }
  }

  if (pool.length === 0) {
    return corsJson({ error: "catalog unavailable" }, 503);
  }

  const pick = pool[djb2(date) % pool.length];
  const sheetAvailable = !!pick.sheet_music_url && pick.sheet_music_url !== "";

  return corsJson({
    date,
    piece_id: pick.id,
    title: pick.title,
    composer: pick.composer,
    catalog: pick.catalog ?? null,
    genre: pick.genre ?? null,
    difficulty: pick.difficulty ?? null,
    difficulty_label: difficultyLabel(pick.difficulty),
    is_public_domain: !!pick.is_public_domain,
    sheet_music_available: sheetAvailable,
    sheet_music_url: sheetAvailable ? pick.sheet_music_url : null,
  });
}
