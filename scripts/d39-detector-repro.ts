/**
 * D39 — THE PITCH PASS REPORTS THE ROOM, NOT THE HUM.
 *
 * Proof harness. Runs the REAL route handler (`handleCoachPcm`, the same code
 * `/api/coach/pcm` serves) over the three synthetic clips in
 * `/home/team/shared/detector-repro/` — identical 220 Hz hum, only the rumble
 * differing — and over the real piano preview, and prints the median MIDI of the
 * returned `notes`.
 *
 *   a-hum-only.wav      → must be 57 (A3)
 *   b-hum-rumble55.wav  → must be 57 (was 33 — 55 Hz, the rumble)
 *   c-hum-rumble80.wav  → must be 57 (was 38 — the rumble)
 *   preview-fur-elise   → its notes must not move
 *
 * Run: bun run scripts/d39-detector-repro.ts [--json]
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { handleCoachPcm } from "../src/services/coach-pcm-handler.ts";

const REPRO_DIR = "/home/team/shared/detector-repro";
const PREVIEW = "/home/team/shared/musicapp-update/assets/audio/preview-fur-elise.wav";

interface Probe {
  file: string;
  status: number;
  frames: number;
  pitched: number;
  medianMidi: number | null;
  distinctMidi: number[];
  firstMidi: number | null;
  /** Every frame's midi — the snapshot that proves the preview did not move. */
  midi: Array<number | null>;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

async function probe(file: string): Promise<Probe> {
  const bytes = await readFile(file);
  const form = new FormData();
  form.append("audio", new File([bytes], basename(file), { type: "audio/wav" }));
  const res = await handleCoachPcm(
    new Request("http://localhost/api/coach/pcm", { method: "POST", body: form }),
  );
  const json = (await res.json()) as {
    notes?: Array<{ midi: number | null }>;
  };
  const notes = Array.isArray(json.notes) ? json.notes : [];
  const midis = notes.map((f) => f.midi).filter((m): m is number => typeof m === "number");
  const distinct = [...new Set(midis.map((m) => Math.round(m)))].sort((a, b) => a - b);
  return {
    file: basename(file),
    status: res.status,
    frames: notes.length,
    pitched: midis.length,
    medianMidi: median(midis),
    distinctMidi: distinct.slice(0, 8),
    firstMidi: midis.length > 0 ? Math.round(midis[0]!) : null,
    midi: notes.map((f) => (typeof f.midi === "number" ? Number(f.midi.toFixed(4)) : null)),
  };
}

const files = [
  `${REPRO_DIR}/a-hum-only.wav`,
  `${REPRO_DIR}/b-hum-rumble55.wav`,
  `${REPRO_DIR}/c-hum-rumble80.wav`,
  PREVIEW,
];

const results: Probe[] = [];
for (const file of files) results.push(await probe(file));

const asJson = process.argv.includes("--json");
if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    console.log(
      `${r.file}: HTTP ${r.status} · ${r.frames} frames (${r.pitched} pitched) · ` +
        `median midi ${r.medianMidi === null ? "—" : r.medianMidi.toFixed(2)} · ` +
        `distinct ${r.distinctMidi.join(",") || "—"}`,
    );
  }
}
