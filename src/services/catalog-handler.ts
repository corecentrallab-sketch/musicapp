/**
 * Public catalog API — GET /api/pieces (search) and GET /api/pieces/:id (detail).
 *
 * Search: ?q=<title-or-composer substring> (case-insensitive, matches title OR
 * composer), ?composer=<composer substring> (case-insensitive, narrows the
 * search), ?limit=<1-50> (default 20, capped at 50), ?offset=<non-negative>
 * (default 0). All filters combine with AND. The endpoint is PUBLIC — no auth or
 * entitlement checks — and by the owner's standing rule it only ever returns
 * public-domain pieces (is_public_domain = true), never copyrighted works.
 *
 * Detail: /api/pieces/<uuid> returns the same piece shape plus the piece's
 * sheet_music_sources list (the curation table keyed by piece_id), ordered with
 * the primary arrangement first.
 *
 * Both endpoints use the same field conventions as /api/daily-challenge:
 * difficulty_label is derived from the catalog's 1-10 grade, and
 * sheet_music_available / sheet_music_url are computed from the actual row —
 * never invented.
 */
import { sql } from "~/db";
import { difficultyLabel } from "./daily-challenge-handler";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^\d+$/;

/** Shape of a pieces row as selected by the shared catalog queries. */
interface PieceRow {
  id: string;
  title: string;
  composer: string;
  catalog: string | null;
  difficulty: number | null;
  is_public_domain: boolean | null;
  sheet_music_url: string | null;
  album_art_url: string | null;
}

/** Shape of a sheet_music_sources row (curated arrangements for a piece). */
interface SheetSourceRow {
  id: string;
  piece_id: string;
  source_platform: string;
  source_url: string;
  format: string;
  arrangement_type: string;
  rating: number | null;
  vote_count: number | null;
  download_count: number | null;
  source_trust: number | null;
  curation_score: number | null;
  is_primary: boolean;
  is_flagged: boolean;
  flag_reason: string | null;
  curated_at: Date | string;
  created_at: Date | string;
}

function corsJson(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

/** Escape LIKE wildcards so user input matches literally, never as patterns. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Map a DB row to the public piece shape shared by list and detail endpoints. */
function serializePiece(row: PieceRow): Record<string, unknown> {
  const sheetAvailable = !!row.sheet_music_url && row.sheet_music_url !== "";
  return {
    id: row.id,
    title: row.title,
    composer: row.composer,
    catalog: row.catalog ?? null,
    difficulty: row.difficulty ?? null,
    difficulty_label: difficultyLabel(row.difficulty),
    is_public_domain: !!row.is_public_domain,
    sheet_music_available: sheetAvailable,
    sheet_music_url: sheetAvailable ? row.sheet_music_url : null,
    album_art_url: row.album_art_url ?? null,
  };
}

/** Map a sheet_music_sources row to JSON (timestamps coerced to strings). */
function serializeSource(row: SheetSourceRow): Record<string, unknown> {
  return {
    id: row.id,
    piece_id: row.piece_id,
    source_platform: row.source_platform,
    source_url: row.source_url,
    format: row.format,
    arrangement_type: row.arrangement_type,
    rating: row.rating ?? null,
    vote_count: row.vote_count ?? null,
    download_count: row.download_count ?? null,
    source_trust: row.source_trust ?? null,
    curation_score: row.curation_score ?? null,
    is_primary: !!row.is_primary,
    is_flagged: !!row.is_flagged,
    flag_reason: row.flag_reason ?? null,
    curated_at: String(row.curated_at),
    created_at: String(row.created_at),
  };
}

/**
 * Parse a limit/offset query param. Returns the parsed value, or an error
 * message when the value is present but not a valid non-negative integer.
 */
function parsePageParam(
  raw: string | null,
  fallback: number,
  label: string,
): { value: number } | { error: string } {
  if (raw === null || raw === "") return { value: fallback };
  if (!INT_RE.test(raw)) {
    return { error: `${label} must be a non-negative integer` };
  }
  return { value: Number(raw) };
}

/** GET /api/pieces — public catalog search. */
export async function handleCatalogList(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return corsJson(
      { success: false, error: "Method not allowed. Use GET." },
      405,
    );
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const composer = (url.searchParams.get("composer") ?? "").trim();

  const limitParsed = parsePageParam(
    url.searchParams.get("limit"),
    DEFAULT_LIMIT,
    "limit",
  );
  if ("error" in limitParsed) {
    return corsJson({ success: false, error: limitParsed.error }, 400);
  }
  const offsetParsed = parsePageParam(url.searchParams.get("offset"), 0, "offset");
  if ("error" in offsetParsed) {
    return corsJson({ success: false, error: offsetParsed.error }, 400);
  }
  // Provided limits clamp into [1, MAX_LIMIT]; the default stays DEFAULT_LIMIT.
  const limit = Math.min(Math.max(limitParsed.value, 1), MAX_LIMIT);
  const offset = offsetParsed.value;

  // WHERE is built from user input but every value is a bound parameter; the
  // only interpolated text is the fixed filter skeleton.
  const where: string[] = ["p.is_public_domain = true"];
  const params: Array<string | number> = [];
  if (q !== "") {
    params.push(`%${escapeLike(q)}%`);
    where.push(
      `(p.title ILIKE $${params.length} OR p.composer ILIKE $${params.length})`,
    );
  }
  if (composer !== "") {
    params.push(`%${escapeLike(composer)}%`);
    where.push(`p.composer ILIKE $${params.length}`);
  }
  const whereSql = where.join(" AND ");

  try {
    const countRows = (await sql().query(
      `SELECT count(*)::int AS total FROM pieces p WHERE ${whereSql}`,
      params,
    )) as unknown as Array<{ total: number }>;
    const total = countRows[0]?.total ?? 0;

    const rows = (await sql().query(
      `SELECT p.id, p.title, p.composer, p.catalog, p.difficulty,
              p.is_public_domain, p.sheet_music_url, p.album_art_url
       FROM pieces p
       WHERE ${whereSql}
       ORDER BY p.title, p.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    )) as unknown as PieceRow[];

    return corsJson({
      success: true,
      total,
      offset,
      limit,
      pieces: rows.map(serializePiece),
    });
  } catch (err) {
    console.error("[catalog] search failed:", err);
    return corsJson({ success: false, error: "catalog unavailable" }, 503);
  }
}

/** GET /api/pieces/:id — public catalog detail with curated sheet sources. */
export async function handleCatalogDetail(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return corsJson(
      { success: false, error: "Method not allowed. Use GET." },
      405,
    );
  }

  const { pathname } = new URL(req.url);
  const match = pathname.match(/^\/api\/pieces\/([0-9a-f-]{36})$/i);
  if (!match || !UUID_RE.test(match[1])) {
    return corsJson({ success: false, error: "piece id must be a UUID" }, 400);
  }
  const id = match[1].toLowerCase();

  try {
    const rows = (await sql().query(
      `SELECT p.id, p.title, p.composer, p.catalog, p.difficulty,
              p.is_public_domain, p.sheet_music_url, p.album_art_url
       FROM pieces p
       WHERE p.id = $1 AND p.is_public_domain = true`,
      [id],
    )) as unknown as PieceRow[];
    if (rows.length === 0) {
      return corsJson({ success: false, error: "piece not found" }, 404);
    }

    const sources = (await sql().query(
      `SELECT s.id, s.piece_id, s.source_platform, s.source_url, s.format,
              s.arrangement_type, s.rating, s.vote_count, s.download_count,
              s.source_trust, s.curation_score, s.is_primary, s.is_flagged,
              s.flag_reason, s.curated_at, s.created_at
       FROM sheet_music_sources s
       WHERE s.piece_id = $1
       ORDER BY s.is_primary DESC, s.curation_score DESC NULLS LAST,
                s.source_trust DESC, s.source_url`,
      [id],
    )) as unknown as SheetSourceRow[];

    return corsJson({
      success: true,
      piece: {
        ...serializePiece(rows[0]),
        sheet_music_sources: sources.map(serializeSource),
      },
    });
  } catch (err) {
    console.error("[catalog] detail lookup failed:", err);
    return corsJson({ success: false, error: "catalog unavailable" }, 503);
  }
}
