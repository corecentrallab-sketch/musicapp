// ---------------------------------------------------------------------------
// validate-clair-de-lune.ts — Verify the freshly-grounded Clair de Lune landmarks
// against the REAL matching semantics /api/recognize uses.
//
//   1. SELF-MATCH: render the verified Mutopia MIDI (plain + perturbed rendition:
//      different gain + 10dB-SNR noise, 22s segment) and confirm the top match is
//      Clair de Lune at >= the application confidence gate (0.3; ideally ~1.0).
//   2. NEGATIVE CONTROLS: white noise, a sine sweep, and a DIFFERENT catalog piece
//      (Chopin Nocturne Op.9 No.1) must NOT return Clair de Lune at >= gate.
//
// Matcher below is the paginated port of src/services/landmark-matching.ts (same
// hash lookup + time-offset alignment voting, same constants) — identical to what
// validate-library-direct.ts and the live function use.
//
// Usage (from /home/team/shared/site):  export DATABASE_URL=...
//   bun run scripts/validate-clair-de-lune.ts
// Writes /tmp/clair_de_lune_validate.json
// ---------------------------------------------------------------------------
import { neon } from "@neondatabase/serverless";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";

const SQL = neon(process.env.DATABASE_URL!);
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const CDL_MIDI = "/home/team/shared/mutopia-data/L75/debussy_Ste_Bergamesq_Clair/debussy_Ste_Bergamesq_Clair.mid";
const CDL_ID = "9d948e91-9352-4ed3-a310-71777cae68de";
const OTHERS = {
  chopinNocturne9_1: { id: "988a0149-821c-4cb1-b31f-d3d07d28e1b8", midi: "/home/team/shared/mutopia-data/O9/nocturne_in_b-flat_minor/nocturne_in_b-flat_minor.mid" },
};

const MIN_MATCH_CONFIDENCE = 0.3; // recognize-handler.ts application gate
const DELTA_BIN_CS = 40, MERGE_NEIGHBORS = 1, MIN_ALIGN_VOTES = 20, MIN_CONFIDENCE = 0.02, PER_HASH_TIME_CAP = 64, TOP_N = 5;
const PAGE_ROWS = 20000, HASH_BATCH = 4000, SEGMENT_SECS = 22;

function addNoiseSamples(samples: Float32Array, snrDb: number, seed = 42): Float32Array {
  const out = new Float32Array(samples); const signal = samples.reduce((a, b) => a + b * b, 0) / samples.length;
  const np = signal / Math.pow(10, snrDb / 10); let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  for (let i = 0; i < out.length; i++) out[i] += Math.sqrt(np) * 2 * rnd();
  return out;
}
async function renderToMono(midi: string, gain: number): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "vcdl-"));
  const midiFile = join(dir, "in.mid"); const wav = join(dir, "out.wav");
  writeFileSync(midiFile, readFileSync(midi));
  execSync(`fluidsynth -ni -r 16000 -g ${gain} -F "${wav}" "${SF2}" "${midiFile}"`, { timeout: 120000, stdio: "pipe" });
  const buf = readFileSync(wav); const dec = await decode(buf);
  let mono: Float32Array;
  if (dec.channelData.length === 1) mono = dec.channelData[0];
  else { const nc = dec.channelData.length; const n = dec.channelData[0].length; mono = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (const c of dec.channelData) s += c[i] ?? 0; mono[i] = s / nc; } }
  rmSync(dir, { recursive: true, force: true });
  return mono;
}
interface DbRow { piece_id: string; hash: number; tc: number; }
async function fetchLandmarks(hashes: number[]): Promise<DbRow[]> {
  const out: DbRow[] = [];
  for (let i = 0; i < hashes.length; i += HASH_BATCH) {
    const batch = hashes.slice(i, i + HASH_BATCH);
    let cursor: [number, string, number] | null = null;
    for (;;) {
      const rows = (await SQL`
        SELECT l.piece_id, l.hash, l.tc FROM piece_landmarks l
        WHERE l.hash = ANY(${batch}::int[])
          ${cursor ? SQL`AND (l.hash, l.piece_id, l.tc) > (${cursor[0]}::int, ${cursor[1]}::uuid, ${cursor[2]}::int)` : SQL``}
        ORDER BY l.hash, l.piece_id, l.tc LIMIT ${PAGE_ROWS}`) as unknown as DbRow[];
      for (const r of rows) out.push(r);
      if (rows.length < PAGE_ROWS) break;
      const last = rows[rows.length - 1]; cursor = [last.hash, last.piece_id, last.tc];
    }
  }
  return out;
}
function bestCluster(deltas: number[]): number {
  let min = Infinity, max = -Infinity; for (const d of deltas) { if (d < min) min = d; if (d > max) max = d; }
  if (deltas.length === 0) return 0; const span = max - min;
  if (!isFinite(span) || span > 2_000_000) return 1;
  const numBins = Math.ceil(span / DELTA_BIN_CS) + 2; const hist = new Int32Array(Math.max(1, numBins));
  const idx = (d: number) => Math.floor((d - min) / DELTA_BIN_CS);
  for (const d of deltas) hist[idx(d)]++;
  let best = 0;
  for (let b = 0; b < hist.length; b++) { let sum = hist[b]; for (let m = 1; m <= MERGE_NEIGHBORS; m++) { if (b - m >= 0) sum += hist[b - m]; if (b + m < hist.length) sum += hist[b + m]; } if (sum > best) best = sum; }
  return best;
}
async function match(queryLms: { hash: number; timeCs: number }[]) {
  const queryByHash = new Map<number, number[]>();
  for (const lm of queryLms) { let arr = queryByHash.get(lm.hash); if (!arr) { arr = []; queryByHash.set(lm.hash, arr); } if (arr.length < PER_HASH_TIME_CAP) arr.push(lm.timeCs); }
  const queryLandmarkCount = queryLms.length;
  if (queryLandmarkCount === 0) return { gated: [], raw: [] };
  const rows = await fetchLandmarks(Array.from(queryByHash.keys()));
  const piecesById = new Map<string, number[]>();
  for (const row of rows) { const qTimes = queryByHash.get(row.hash); if (!qTimes) continue; let d = piecesById.get(row.piece_id); if (!d) { d = []; piecesById.set(row.piece_id, d); } for (const qt of qTimes) d.push(qt - row.tc); }
  if (piecesById.size === 0) return { gated: [], raw: [] };
  const results: any[] = [];
  for (const [pid, deltas] of piecesById) { const best = bestCluster(deltas); if (best < MIN_ALIGN_VOTES) continue; const confidence = Math.min(1, best / queryLandmarkCount); if (confidence < MIN_CONFIDENCE) continue; results.push({ piece_id: pid, confidence, overlap_count: best }); }
  results.sort((a, b) => b.confidence - a.confidence || b.overlap_count - a.overlap_count);
  const raw = results.slice(0, TOP_N);
  return { gated: raw.filter((m) => m.confidence >= MIN_MATCH_CONFIDENCE), raw };
}
async function landmarksFromWavSamples(mono: Float32Array) { return extractLandmarks(mono, 16000); }
function describe(m: any) { return m ? { piece_id: m.piece_id, confidence: +m.confidence.toFixed(4), overlap_count: m.overlap_count, is_clair: m.piece_id === CDL_ID } : null; }

async function main() {
  const report: any = { cases: [], controls: [] };
  // Verify CDL landmarks exist.
  const cnt = (await SQL`SELECT count(*)::int AS n FROM piece_landmarks WHERE piece_id=${CDL_ID}::uuid`) as unknown as { n: number }[];
  report.landmarkRows = cnt[0].n;

  // ---- SELF-MATCH: plain render ----
  const plain = await renderToMono(CDL_MIDI, 2.0);
  const plainLms = await landmarksFromWavSamples(plain.slice(0, SEGMENT_SECS * 16000));
  const mPlain = await match(plainLms);
  report.cases.push({ label: "self-match (plain render)", queryLms: plainLms.length, top: describe(mPlain.gated[0] ?? mPlain.raw[0]), gatedCount: mPlain.gated.length });

  // ---- SELF-MATCH: perturbed rendition (gain 1.0 + 10dB noise) ----
  const pert = addNoiseSamples(await renderToMono(CDL_MIDI, 1.0), 10, 1234).slice(0, SEGMENT_SECS * 16000);
  const pertLms = await landmarksFromWavSamples(pert);
  const mPert = await match(pertLms);
  report.cases.push({ label: "self-match (perturbed rendition, noise)", queryLms: pertLms.length, top: describe(mPert.gated[0] ?? mPert.raw[0]), gatedCount: mPert.gated.length });

  // ---- NEGATIVE CONTROLS ----
  // Control 1: white noise
  const noise = new Float32Array(SEGMENT_SECS * 16000); let s1 = 7; const rnd1 = () => { s1 = (s1 * 1103515245 + 12345) & 0x7fffffff; return s1 / 0x7fffffff - 0.5; };
  for (let i = 0; i < noise.length; i++) noise[i] = rnd1() * 0.5;
  const n1 = await match(await landmarksFromWavSamples(noise));
  report.controls.push({ label: "white-noise", gated: n1.gated.map(describe), matchesClair: n1.gated.some((m) => m.piece_id === CDL_ID) });
  // Control 2: rising sine sweep
  const sine = new Float32Array(SEGMENT_SECS * 16000);
  for (let i = 0; i < sine.length; i++) { const f = 200 + (i / sine.length) * 3000; sine[i] = 0.5 * Math.sin(2 * Math.PI * f * i / 16000); }
  const n2 = await match(await landmarksFromWavSamples(sine));
  report.controls.push({ label: "sine-sweep", gated: n2.gated.map(describe), matchesClair: n2.gated.some((m) => m.piece_id === CDL_ID) });
  // Control 3: DIFFERENT catalog piece (Chopin Nocturne Op.9 No.1) must not match Clair de Lune
  const chmidi = OTHERS.chopinNocturne9_1.midi;
  if (existsSync(chmidi)) {
    const chop = addNoiseSamples(await renderToMono(chmidi, 1.0), 10, 99).slice(0, SEGMENT_SECS * 16000);
    const chopLms = await landmarksFromWavSamples(chop);
    const nc = await match(chopLms);
    report.controls.push({ label: "different-catalog-piece (Chopin Op.9 No.1)", gated: nc.gated.map(describe), matchesClair: nc.gated.some((m) => m.piece_id === CDL_ID) });
  }

  writeFileSync("/tmp/clair_de_lune_validate.json", JSON.stringify(report, null, 2));
  const first = (c: any) => { if (!c) return null; return c; };
  const selfPlain = report.cases[0]; const selfPert = report.cases[1];
  console.log(`landmark_rows=${report.landmarkRows}`);
  console.log(`SELF plain:  top=${JSON.stringify(selfPlain.top)} gated=${selfPlain.gatedCount}`);
  console.log(`SELF pert:   top=${JSON.stringify(selfPert.top)} gated=${selfPert.gatedCount}`);
  console.log(`CONTROLS: ${report.controls.map((c) => `${c.label}->gated=${c.gated.length} clair=${c.matchesClair}`).join(" | ")}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
