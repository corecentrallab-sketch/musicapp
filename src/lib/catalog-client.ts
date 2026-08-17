/**
 * Client for the public catalog API (Part 1 — already deployed):
 *   GET /api/pieces       — search (q = title/composer substring, limit, offset)
 *   GET /api/pieces/:id   — detail incl. sheet_music_sources
 *
 * The API is public-domain-only and returns the same field conventions as the
 * recognition and daily-challenge endpoints. In the browser we call the
 * same-origin /api/pieces (served by the site itself in preview and prod); on
 * the server (SSR route loaders) we use CATALOG_API_BASE, the live deployed
 * API, since relative URLs are not fetchable from Node.
 */
export const CATALOG_API_BASE = "https://site-notesnap.vercel.app";

export interface CatalogPiece {
  id: string;
  title: string;
  composer: string;
  catalog: string | null;
  difficulty: number | null;
  difficulty_label: string | null;
  is_public_domain: boolean;
  sheet_music_available: boolean;
  sheet_music_url: string | null;
  album_art_url: string | null;
}

export interface SheetSource {
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
  curated_at: string;
  created_at: string;
}

export type CatalogListResult =
  | { success: true; total: number; offset: number; limit: number; pieces: CatalogPiece[] }
  | { success: false; error: string };

export type CatalogDetailResult =
  | { success: true; piece: CatalogPiece & { sheet_music_sources: SheetSource[] } }
  | { success: false; error: string };

function buildQuery(
  params: Record<string, string | number | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  const encoded = qs.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toPiece(value: unknown): CatalogPiece | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    title: typeof value.title === "string" ? value.title : "",
    composer: typeof value.composer === "string" ? value.composer : "",
    catalog: typeof value.catalog === "string" ? value.catalog : null,
    difficulty: typeof value.difficulty === "number" ? value.difficulty : null,
    difficulty_label:
      typeof value.difficulty_label === "string" ? value.difficulty_label : null,
    is_public_domain: value.is_public_domain === true,
    sheet_music_available: value.sheet_music_available === true,
    sheet_music_url: typeof value.sheet_music_url === "string" ? value.sheet_music_url : null,
    album_art_url: typeof value.album_art_url === "string" ? value.album_art_url : null,
  };
}

function toSheetSource(value: unknown): SheetSource | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    piece_id: typeof value.piece_id === "string" ? value.piece_id : "",
    source_platform: typeof value.source_platform === "string" ? value.source_platform : "",
    source_url: typeof value.source_url === "string" ? value.source_url : "",
    format: typeof value.format === "string" ? value.format : "",
    arrangement_type:
      typeof value.arrangement_type === "string" ? value.arrangement_type : "",
    rating: typeof value.rating === "number" ? value.rating : null,
    vote_count: typeof value.vote_count === "number" ? value.vote_count : null,
    download_count:
      typeof value.download_count === "number" ? value.download_count : null,
    source_trust: typeof value.source_trust === "number" ? value.source_trust : null,
    curation_score:
      typeof value.curation_score === "number" ? value.curation_score : null,
    is_primary: value.is_primary === true,
    is_flagged: value.is_flagged === true,
    flag_reason: typeof value.flag_reason === "string" ? value.flag_reason : null,
    curated_at: typeof value.curated_at === "string" ? value.curated_at : "",
    created_at: typeof value.created_at === "string" ? value.created_at : "",
  };
}

/**
 * GET /api/pieces — search the public-domain catalog.
 * `base` is only provided on the server (SSR); browsers use the same origin.
 */
export async function fetchCatalogList(opts: {
  q?: string;
  limit?: number;
  offset?: number;
  base?: string;
}): Promise<CatalogListResult> {
  const base = opts.base ?? "";
  const query = buildQuery({ q: opts.q, limit: opts.limit, offset: opts.offset });
  let json: unknown;
  try {
    const res = await fetch(`${base}/api/pieces${query}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { success: false, error: `catalog request failed (HTTP ${res.status})` };
    }
    json = await res.json();
  } catch {
    return { success: false, error: "catalog unavailable — please try again" };
  }
  if (
    !isRecord(json) ||
    json.success !== true ||
    !Array.isArray(json.pieces) ||
    typeof json.total !== "number"
  ) {
    const message =
      isRecord(json) && typeof json.error === "string"
        ? json.error
        : "catalog unavailable — please try again";
    return { success: false, error: message };
  }
  const pieces = json.pieces
    .map((p: unknown) => toPiece(p))
    .filter((p: CatalogPiece | null): p is CatalogPiece => p !== null);
  return {
    success: true,
    total: json.total,
    offset: typeof json.offset === "number" ? json.offset : 0,
    limit: typeof json.limit === "number" ? json.limit : opts.limit ?? 20,
    pieces,
  };
}

/** GET /api/pieces/:id — detail incl. curated sheet-music sources. */
export async function fetchCatalogPiece(
  id: string,
  base = "",
): Promise<CatalogDetailResult> {
  let json: unknown;
  try {
    const res = await fetch(`${base}/api/pieces/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      if (res.status === 404) {
        return { success: false, error: "piece not found" };
      }
      return { success: false, error: `catalog request failed (HTTP ${res.status})` };
    }
    json = await res.json();
  } catch {
    return { success: false, error: "catalog unavailable — please try again" };
  }
  if (!isRecord(json) || json.success !== true || !isRecord(json.piece)) {
    const message =
      isRecord(json) && typeof json.error === "string"
        ? json.error
        : "catalog unavailable — please try again";
    return { success: false, error: message };
  }
  const piece = toPiece(json.piece);
  if (!piece) return { success: false, error: "catalog unavailable — please try again" };
  const sources = Array.isArray(json.piece.sheet_music_sources)
    ? json.piece.sheet_music_sources
        .map((s: unknown) => toSheetSource(s))
        .filter((s: SheetSource | null): s is SheetSource => s !== null)
    : [];
  return { success: true, piece: { ...piece, sheet_music_sources: sources } };
}
