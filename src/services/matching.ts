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
  segment_start_s: number;
  segment_end_s: number;
  overlap_count: number;
  total_overlap: number;
  confidence: number;
}

/**
 * Match a raw fingerprint (int[]) against the database using PostgreSQL intarray
 * operators for fast overlap scoring.
 *
 * The query:
 * 1. Computes the overlap (intersection) between the query fingerprint array
 *    and each stored fingerprint using the `&` intarray operator
 * 2. Counts the number of matching elements via `icount()`
 * 3. Orders by total_overlap DESC and returns the top 5
 * 4. Joins to pieces for metadata
 *
 * Returns top-5 matches with confidence scores normalized to 0-1.
 */
export async function matchFingerprint(
  queryFingerprint: number[],
): Promise<FingerprintMatch[]> {
  // Convert the fingerprint array to PostgreSQL int[] literal
  const fpLiteral = `{${queryFingerprint.join(",")}}`;

  const query = await sql()`
    WITH overlaps AS (
      SELECT
        f.id AS fingerprint_id,
        f.piece_id,
        f.segment_start_s,
        f.segment_end_s,
        f.fingerprint,
        icount(f.fingerprint & ${fpLiteral}::int[]) AS overlap_count,
        icount(f.fingerprint) AS stored_count,
        array_length(${fpLiteral}::int[], 1) AS query_count
      FROM fingerprints f
      WHERE f.fingerprint && ${fpLiteral}::int[]
    ),
    scored AS (
      SELECT
        o.*,
        -- Jaccard-like: overlap / (|A| + |B| - |A ∩ B|)
        o.overlap_count::float /
          GREATEST(1, o.stored_count + o.query_count - o.overlap_count)::float
          AS confidence
      FROM overlaps o
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
