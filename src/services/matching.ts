import { sql } from "~/db";
/**
 * Score represents the overlap between a query fingerprint and a stored fingerprint.
 */
interface FingerprintMatch {
  fingerprint_id: string;
  piece_id: string;
  title: string;
  composer: string;
  catalog: string | null;
  genre: string | null;
  difficulty: number | null;
  album_art_url: string | null;
  sheet_music_url: string | null;
  tab_url: string | null;
  is_public_domain: boolean | null;
  segment_start_s: number;
  segment_end_s: number;
  overlap_count: number;
  total_overlap: number;
  confidence: number;
}
/**
 * Match a raw fingerprint (number[]) against the database.
 *
 * Fingerprints are stored as BIGINT[] because chromaprint values are unsigned
 * 32-bit (they overflow INTEGER). PostgreSQL's intarray extension ONLY works on
 * int4[], so we must use native bigint[] operators:
 *
 *   - Candidate filter: `f.fingerprint && $1::bigint[]` (native array overlap)
 *   - Overlap count: an unnest-based count instead of `icount(f.fingerprint & ...)`
 *   - stored_count: `cardinality(f.fingerprint)`
 *   - query_count: `array_length($1::bigint[], 1)`
 *
 * Returns top-5 matches with confidence scores normalized to 0-1.
 */
export async function matchFingerprint(
  queryFingerprint: number[],
): Promise<FingerprintMatch[]> {
  // Convert the fingerprint array to a PostgreSQL bigint[] literal
  const fpLiteral = `{${queryFingerprint.join(",")}}`;
  const query = await sql()`
    WITH candidates AS (
      SELECT
        f.id AS fingerprint_id,
        f.piece_id,
        f.segment_start_s,
        f.segment_end_s,
        f.fingerprint,
        (
          SELECT count(*)
          FROM unnest(f.fingerprint) u
          WHERE u = ANY(${fpLiteral}::bigint[])
        ) AS overlap_count,
        cardinality(f.fingerprint) AS stored_count,
        array_length(${fpLiteral}::bigint[], 1) AS query_count
      FROM fingerprints f
      WHERE f.fingerprint && ${fpLiteral}::bigint[]
    ),
    scored AS (
      SELECT
        o.*,
        -- Jaccard-like: overlap / (|A| + |B| - |A ∩ B|)
        o.overlap_count::float /
          GREATEST(1, o.stored_count + o.query_count - o.overlap_count)::float
          AS confidence
      FROM candidates o
    )
    SELECT
      s.fingerprint_id,
      s.piece_id,
      p.title,
      p.composer,
      p.catalog,
      p.genre,
      p.difficulty,
      p.album_art_url,
      p.sheet_music_url,
      p.tab_url,
      p.is_public_domain,
      s.segment_start_s,
      s.segment_end_s,
      s.overlap_count,
      s.overlap_count AS total_overlap,
      s.confidence
    FROM scored s
    JOIN pieces p ON p.id = s.piece_id
    ORDER BY s.overlap_count DESC, s.confidence DESC
    LIMIT 5
  `;
  return query as unknown as FingerprintMatch[];
}
