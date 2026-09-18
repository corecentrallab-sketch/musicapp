/**
 * Public catalog API — GET /api/pieces (search) and GET /api/pieces/:id (detail).
 *
 * Search: ?q=<title-or-composer substring> (case-insensitive AND
 * diacritic-insensitive, matches title OR composer), ?composer=<composer
 * substring> (same folding, narrows the search), ?limit=<1-50> (default 20,
 * capped at 50), ?offset=<non-negative> (default 0). All filters combine with
 * AND.
 *
 * Diacritic tolerance (owner-reported discovery gap, 2026-09-18): a musician
 * types "fur elise" and "prelude", not "Fur Elise" and "Prelude" with accents,
 * yet before this change `?q=fur` returned nothing from a catalog whose piece is
 * titled "Bagatelle in A Minor (Fur Elise)" — with an umlaut. Both sides of every
 * search comparison are therefore folded with Postgres' `unaccent` extension
 * (installed by scripts/enable-unaccent.ts). The extension is probed once per
 * server process and cached: if a database ever lacks it the endpoint degrades to
 * plain case-insensitive matching instead of failing, so search keeps working —
 * it just stops being accent-tolerant until the extension is reinstalled. The endpoint is PUBLIC — no auth or
 * entitlement checks — and by the owner's standing rule it only ever returns
 * public-domain pieces (is_public_domain = true), never copyrighted works.
 *
 * Detail: /api/pieces/<uuid> returns the same piece shape plus the piece's
 * sheet_music_sources list (the curation table keyed by piece_id), ordered with
 * the primary arrangement first.
 *
 * Both endpoints also carry `affiliate_url` — the Sheet Music Direct search link
 * for the piece (affiliate ID 67650), built by the shared pure builder in
 * `piece-affiliate.ts`. The site's piece pages use the same builder, so app and
 * site share one attributable CTA path; the field is populated for every piece,
 * including those with no score of our own (`sheet_music_available: false`).
 *
 * Both endpoints use the same field conventions as /api/daily-challenge:
 * difficulty_label is derived from the catalog's 1-10 grade, and
 * sheet_music_available / sheet_music_url are computed from the actual row —
 * never invented.
 */
import { sql } from "~/db";
import { difficultyLabel } from "./daily-challenge-handler";
import { pieceAffiliateUrl } from "./piece-affiliate";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/**
 * Longest accepted `q` / `composer` filter. A search is a substring match, so
 * anything past this is a client bug (or an attempt to make the ILIKE scan
 * expensive); 200 characters is far beyond any real title or composer name.
 */
const MAX_QUERY_CHARS = 200;
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

/**
 * Whether the database has Postgres' `unaccent` extension — probed once per
 * server process, then cached (null = not probed yet). The probe is a plain
 * read, so it is safe on a cold start; a probe failure means "no folding",
 * never a 5xx.
 */
let unaccentReady: boolean | null = null;
async function hasUnaccent(): Promise<boolean> {
  if (unaccentReady !== null) return unaccentReady;
  try {
    const rows = (await sql().query(
      `SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'unaccent'`,
    )) as unknown as Array<{ n: number }>;
    unaccentReady = (rows[0]?.n ?? 0) > 0;
    if (!unaccentReady) {
      console.warn(
        "[catalog] unaccent extension missing — search is not accent-tolerant",
      );
    }
  } catch (err) {
    console.warn("[catalog] unaccent probe failed:", err);
    unaccentReady = false;
  }
  return unaccentReady;
}

/**
 * Wrap a SQL expression (a column name) in the accent folder when the database
 * supports it. Applied to BOTH sides of every search comparison, so an accented
 * query and an unaccented one behave identically.
 */
function folded(expr: string, fold: boolean): string {
  return fold ? `unaccent(${expr})` : expr;
}

/**
 * A bound search parameter ($1, $2, ...), text-cast and optionally folded.
 *
 * The `text` cast is not optional: an untyped placeholder inside `unaccent(...)`
 * leaves the parameter type for the serverless driver to infer, and it infers
 * `integer`, which fails at parse time with
 * `function unaccent(integer) does not exist` (42883) — reproduced against the
 * live database on 2026-09-18, after which this cast was added.
 */
function foldedParam(index: number, fold: boolean): string {
  return folded("$" + index + "::text", fold);
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
    // Retailing (WAVE 1a, owner direction 09-18): the Sheet Music Direct search
    // link for this piece, built by the same shared builder the piece pages use,
    // so the app and the site carry one attributable CTA path. Present for every
    // piece — including the ~85% with no score of our own, which is exactly where
    // "get the official sheet music" is the only thing we can honestly offer.
    // Null only when there is nothing to search for.
    affiliate_url: pieceAffiliateUrl(row.title, row.composer),
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

  if (q.length > MAX_QUERY_CHARS || composer.length > MAX_QUERY_CHARS) {
    return corsJson(
      {
        success: false,
        error: `q and composer must be ${MAX_QUERY_CHARS} characters or fewer`,
      },
      400,
    );
  }

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
  // only interpolated text is the fixed filter skeleton plus the `unaccent(...)`
  // wrapper (a fixed function name, never user input).
  const fold = await hasUnaccent();
  const where: string[] = ["p.is_public_domain = true"];
  const params: Array<string | number> = [];
  if (q !== "") {
    params.push(`%${escapeLike(q)}%`);
    where.push(
      `(${folded("p.title", fold)} ILIKE ${foldedParam(params.length, fold)}` +
        ` OR ${folded("p.composer", fold)} ILIKE ${foldedParam(params.length, fold)})`,
    );
  }
  if (composer !== "") {
    params.push(`%${escapeLike(composer)}%`);
    where.push(
      `${folded("p.composer", fold)} ILIKE ${foldedParam(params.length, fold)}`,
    );
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
