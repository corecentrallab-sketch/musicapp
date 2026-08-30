// ---------------------------------------------------------------------------
// skeleton.ts — build a melodic REFERENCE contour ("skeleton") from the ABC /
// MIDI sources we already hold for public-domain pieces, or from a raw pitch
// list. The skeleton is the same RELATIVE-INTERVAL delta representation as a
// hummed query, so the matcher can align them directly.
//
// Source of truth for Phase 1: the bundled public-domain ABC scores (mirrored
// from the app's notation-editor bundle) — see melody-seeds.ts. A DB population
// script (scripts/build-melody-skeletons.ts) can also ingest ABC into Neon
// (`melody_skeletons` table, migration 006), and the runtime store loader
// (store.ts) prefers the DB when available and falls back to the bundled seeds.
// ---------------------------------------------------------------------------
import { parseAbc } from "../abc/abc-parser";

/** A reference melody contour for one piece. */
export interface MelodySkeleton {
  pieceId: string;
  title: string;
  composer: string;
  /** Relative-interval contour: deltas[i] = midi[i+1] - midi[i], in semitones. */
  deltas: number[];
  /** Absolute MIDI pitches (for diagnostics / optional duration scoring). */
  pitches: number[];
  /** Normalized note durations (0..1) parallel to pitches (rhythm cue). */
  durations: number[];
}

/**
 * Build a skeleton from an ABC body string reusing the existing pure-TS ABC
 * parser (src/services/abc/abc-parser.ts). Chords are reduced to their median
 * pitch; rests are dropped (they carry no pitch-contour information).
 */
export function skeletonFromAbc(
  abc: string,
  meta: { pieceId: string; title: string; composer: string },
): MelodySkeleton {
  const parsed = parseAbc(abc);
  const pitches: number[] = [];
  const durations: number[] = [];
  for (const ev of parsed.events) {
    if (!ev.pitches || ev.pitches.length === 0) continue; // rest
    const p = ev.pitches.slice().sort((a, b) => a - b);
    pitches.push(p[Math.floor(p.length / 2)]);
    durations.push(Math.max(ev.durationQb, 0.01));
  }
  return buildSkeleton(pitches, durations, meta);
}

/** Build a skeleton from an explicit MIDI pitch list (unit-test/seed helper). */
export function buildSkeleton(
  pitches: number[],
  durations: number[] = [],
  meta: { pieceId: string; title: string; composer: string },
): MelodySkeleton {
  const durs = durations.length === pitches.length ? durations : pitches.map(() => 1);
  // Normalize durations so total = number of notes (tempo-invariant scale).
  const normDurs = durs.map((d) => d);
  const deltas: number[] = [];
  for (let i = 1; i < pitches.length; i++) deltas.push(pitches[i] - pitches[i - 1]);
  return { pieceId: meta.pieceId, title: meta.title, composer: meta.composer, deltas, pitches, durations: normDurs };
}
