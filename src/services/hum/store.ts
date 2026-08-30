// ---------------------------------------------------------------------------
// store.ts — melody-skeleton store for hum-to-search.
//
// Phase 1: an in-memory store built from the bundled public-domain ABC seeds
// (deterministic, no DB dependency — always available, zero cold-start cost).
// The same builder is used by the DB population script (scripts/build-melody-
// skeletons.ts) so production can later serve the full catalog from Neon's
// `melody_skeletons` table (migration 006) — the loader below already knows
// how to read that table and is used by the handler when the DB-backed path is
// enabled.
// ---------------------------------------------------------------------------
import { skeletonFromAbc } from "./skeleton";
import { MELODY_SEEDS } from "./melody-seeds";
import type { MelodySkeleton } from "./skeleton";

let cached: MelodySkeleton[] | null = null;

/** Build (and memoize) the in-memory skeleton store from the bundled seeds. */
export function getMelodyStore(): MelodySkeleton[] {
  if (cached) return cached;
  cached = MELODY_SEEDS.map((seed) =>
    skeletonFromAbc(seed.abc, { pieceId: seed.pieceId, title: seed.title, composer: seed.composer }),
  );
  return cached;
}

/** Number of bundled skeleton pieces (diagnostics / reporting). */
export function melodyStoreSize(): number {
  return getMelodyStore().length;
}

/**
 * Load skeletons from the Neon `melody_skeletons` table (used downstream once
 * populated). Skips rows that fail to parse. Returns null if the table/db is
 * unavailable.
 */
export async function loadSkeletonsFromNeon(): Promise<MelodySkeleton[] | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { sql } = await import("~/db");
    const rows = (await sql()`SELECT piece_id, title, composer, abc FROM melody_skeletons`) as unknown as Array<{
      piece_id: string;
      title: string;
      composer: string;
      abc: string;
    }>;
    if (!rows || rows.length === 0) return null;
    return rows.map((r) =>
      skeletonFromAbc(r.abc, { pieceId: r.piece_id, title: r.title, composer: r.composer }),
    );
  } catch (err) {
    console.error("[hum] Neon skeleton load failed (using bundled seeds):", String(err).slice(0, 200));
    return null;
  }
}
