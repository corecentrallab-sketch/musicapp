#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// validate-library-direct.ts — Fast library-wide recognition validation (FIXED).
//
// Same goal as validate-library.ts: prove the landmark matcher works across the
// whole ~113-piece fingerprinted catalog. Pipeline:
//   1. Resolve each piece's local MIDI (mirrors ingest-landmarks-capped.ts).
//   2. Render a DIFFERENT/perturbed rendition (different gain + noise) than the
//      stored reference.
//   3. Extract query landmarks.
//   4. Match with the SAME landmark-matcher logic /api/recognize uses, then
//      apply the SAME application-level confidence gate (>= 0.3) POST
//      /api/recognize applies, and classify.
//   5. Count true positives, misses and false positives (wrong piece returned at
//      or above the gate), plus non-catalog controls that must match nothing.
//
// FIX (2026-08): the previous version called the shared matchLandmarks() which
// runs `WHERE l.hash = ANY(<all query hashes>)` as ONE Neon HTTP query. For
// pieces whose query hashes collide with a large share of the ~2.6M piece
// landmark rows, that single response exceeds Neon's 64 MB cap and the query
// dies with `HTTP 507 response is too large`. This version does NOT change the
// matcher's semantics (same hash lookup, same time-offset alignment voting, same
// thresholds/constants). It only makes the DB read able to absorb huge landmark
// sets by fetching the candidate rows in BOUNDED PAGES (LIMIT + keyset cursor on
// (hash, piece_id, tc)), accumulating them across pages. Each neon response is
// therefore small, so large/common pieces no longer 507.
//
// The shared src/services/landmark-matching.ts is intentionally left untouched
// (the task scopes this change to the harness). NOTE for the lead: the same 507
// can therefore still occur in the live /api/recognize path on these same
// pieces — see final report; a like-for-like pagination port into
// landmark-matching.ts is a separate, small follow-up.
//
// Usage (from /home/team/shared/site):  export DATABASE_URL=...
//   bun run scripts/validate-library-direct.ts [--limit N] [--shuffle]
// Writes /tmp/validate_direct_results.json
// ---------------------------------------------------------------------------
import { neon } from "@neondatabase/serverless";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, statSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";

const DATABASE_URL = process.env.DATABASE_URL!;
const SQL = neon(DATABASE_URL);
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const ROOT = "/home/team/shared/mutopia-data";
const RENDER_CONCURRENCY = 3;
const RENDER_GAIN = 1.0;
const NOISE_SNR_DB = 10;
const SEGMENT_SECS = 22;
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG >= 0 ? parseInt(process.argv[LIMIT_ARG + 1], 10) || Infinity : Infinity;

// --- Application-level confidence gate (must match recognize-handler.ts) ----
const MIN_MATCH_CONFIDENCE = 0.3;

// --- Matcher constants (MUST mirror src/services/landmark-matching.ts) -------
const DELTA_BIN_CS = 40;
const MERGE_NEIGHBORS = 1;
const MIN_ALIGN_VOTES = 20;
const MIN_CONFIDENCE = 0.02;
const PER_HASH_TIME_CAP = 64;
const TOP_N = 5;
// --- Pagination tunables for the DB read (the 507 fix) ----------------------
const PAGE_ROWS = 20000;      // bounded rows per neon response (<=~4MB)
const HASH_BATCH = 4000;      // bounded hash IN-list per query

const normCat = (s: string) => (s || "").toLowerCase().replace(/[.\-\s]+/g, " ").trim();
function extractNumbers(s: string): string { const m = s.match(/\d+/); return m ? m[0] : ""; }
function extractLetterPrefix(s: string): string { const m = s.match(/^[a-zA-Z]+/); return m ? m[0].toLowerCase() : ""; }
function extractCatalogFromKey(key: string): string {
  const rel = key.replace(/^scores\//, ""); const parts = rel.split("/");
  let start = 0;
  if (parts[0] === "fresh5" && parts.length >= 3) start = 2; else if (parts[0] === "fresh5") start = 1;
  for (let i = start; i < parts.length; i++) if (/\d/.test(parts[i])) return parts[i];
  return parts[start] || "";
}
function matchPieceFromList(key: string, allPieces: { id: string; title: string; composer: string; catalog: string | null }[]): any {
  const r2Catalog = extractCatalogFromKey(key); if (!r2Catalog) return null;
  const r2Norm = normCat(r2Catalog); const r2Nums = extractNumbers(r2Catalog); const r2Prefix = extractLetterPrefix(r2Catalog);
  const filename = key.split("/").pop()?.replace(/\.midi?$/i, "").toLowerCase() || "";
  const fileWords = filename.split(/[_\-\s]+/).filter((w) => w.length > 1);
  for (const piece of allPieces) {
    const dbCat = piece.catalog || ""; const dbNorm = normCat(dbCat);
    const dbNums = extractNumbers(dbCat); const dbPrefix = extractLetterPrefix(dbCat);
    const dbTitle = piece.title.toLowerCase(); const dbTitleWords = dbTitle.split(/\s+/).filter((w) => w.length > 2);
    let score = 0;
    if (dbNorm === r2Norm) score += 100;
    if (r2Prefix && dbPrefix && r2Nums && dbNums) {
      if (r2Prefix === dbPrefix && r2Nums === dbNums) score += 80;
      else if (r2Nums === dbNums && dbPrefix.startsWith(r2Prefix)) score += 60;
    }
    if (r2Nums && r2Nums === dbNums && r2Nums.length >= 2) score += 40;
    const titleOverlap = dbTitleWords.filter((tw) => fileWords.some((fw) => fw.includes(tw) || tw.includes(fw)));
    score += titleOverlap.length * 15;
    if (dbNorm.length > 1 && r2Norm.includes(dbNorm)) score += 20;
    if (score > 0) return piece;
  }
  return null;
}
function scoreKey(key: string, piece: { catalog: string | null; title: string }): number {
  const cat = extractCatalogFromKey(key); const c = normCat(piece.catalog || ""); const k = normCat(cat);
  const cn = extractNumbers(cat); const pn = extractNumbers(piece.catalog || "");
  let base = c && c === k ? 1000 : cn && cn === pn && cn.length >= 2 ? 500 : 0;
  const tok = k.replace(/[^a-z0-9]/g, ""); const leaf = key.split("/").slice(-2).join(" ").toLowerCase().replace(/[._\-\s]+/g, "");
  if (tok && tok.length >= 2 && leaf.includes(tok)) base += 300;
  return base;
}
function walkMidis(dir: string, out: string[] = []): string[] {
  let entries: string[]; try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) { const p = join(dir, e); let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walkMidis(p, out); else if (/\.midi?$/i.test(e)) out.push(p); }
  return out;
}
function addNoiseSamples(samples: Float32Array, snrDb: number): Float32Array {
  const out = new Float32Array(samples); const signal = samples.reduce((a, b) => a + b * b, 0) / samples.length;
  const np = signal / Math.pow(10, snrDb / 10); let s = 42;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  for (let i = 0; i < out.length; i++) out[i] += Math.sqrt(np) * 2 * rnd();
  return out;
}
function writeWav16(path: string, samples: Float32Array, sampleRate = 16000): void {
  const n = samples.length; const buffer = Buffer.alloc(44 + n * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + n * 2, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { let v = Math.max(-1, Math.min(1, samples[i])); buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2); }
  writeFileSync(path, buffer);
}
/** Render one MIDI to a perturbed mono WAV at /tmp/vd_<idx>.wav (returns sample data). */
async function renderPerturbed(midiPath: string, idx: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "vd-")); const midiFile = join(dir, "in.mid"); const wav = join(dir, "out.wav");
  writeFileSync(midiFile, readFileSync(midiPath));
  await new Promise<void>((res) => {
    const p = spawn("fluidsynth", ["-ni", "-r", "16000", "-g", String(RENDER_GAIN), "-F", wav, SF2, midiFile], { stdio: "ignore" });
    const to = setTimeout(() => { p.kill("SIGKILL"); res(); }, 120000);
    p.on("exit", () => { clearTimeout(to); res(); });
  });
  const buf = readFileSync(wav); const dec = await decode(buf);
  let mono: Float32Array;
  if (dec.channelData.length === 1) mono = dec.channelData[0];
  else { const nc = dec.channelData.length; const n = dec.channelData[0].length; mono = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (const c of dec.channelData) s += c[i] ?? 0; mono[i] = s / nc; } }
  rmSync(dir, { recursive: true, force: true });
  const seg = addNoiseSamples(mono, NOISE_SNR_DB).slice(0, SEGMENT_SECS * 16000);
  const out = `/tmp/vd_${idx}.wav`; writeWav16(out, seg); return out;
}
async function runPool(tasks: { idx: number; midi: string }[], pool: number): Promise<Map<number, string>> {
  const result = new Map<number, string>(); let i = 0;
  async function worker() {
    while (i < tasks.length) { const t = tasks[i++]; try { result.set(t.idx, await renderPerturbed(t.midi, t.idx)); } catch (e:any) { result.set(t.idx, ""); console.error(`   render fail idx ${t.idx}: ${e?.message || e}`); } }
  }
  await Promise.all(Array.from({ length: pool }, worker));
  return result;
}

interface DbRow { piece_id: string; hash: number; tc: number; title: string; composer: string; catalog: string | null; genre: string | null; difficulty: number | null; album_art_url: string | null; sheet_music_url: string | null; tab_url: string | null; is_public_domain: boolean | null; }

/**
 * Paginated reader: fetches ALL piece_landmarks rows whose hash is in `hashes`,
 * in bounded pages so no single neon response exceeds Neon's 64 MB cap.
 * Mirrors the WHERE clause of the shared matcher exactly; identical row set.
 */
async function fetchLandmarks(hashes: number[]): Promise<DbRow[]> {
  const out: DbRow[] = [];
  for (let i = 0; i < hashes.length; i += HASH_BATCH) {
    const batch = hashes.slice(i, i + HASH_BATCH);
    // keyset cursor over (hash, piece_id, tc); loop until a short page.
    let cursor: [number, string, number] | null = null;
    for (;;) {
      const rows = (await SQL`
        SELECT l.piece_id, l.hash, l.tc,
          p.title, p.composer, p.catalog, p.genre, p.difficulty,
          p.album_art_url, p.sheet_music_url, p.tab_url, p.is_public_domain
        FROM piece_landmarks l JOIN pieces p ON p.id = l.piece_id
        WHERE l.hash = ANY(${batch}::int[])
          ${cursor ? SQL`AND (l.hash, l.piece_id, l.tc) > (${cursor[0]}::int, ${cursor[1]}::uuid, ${cursor[2]}::int)` : SQL``}
        ORDER BY l.hash, l.piece_id, l.tc
        LIMIT ${PAGE_ROWS}
      `) as unknown as DbRow[];
      for (const r of rows) out.push(r);
      if (rows.length < PAGE_ROWS) break;
      const last = rows[rows.length - 1];
      cursor = [last.hash, last.piece_id, last.tc];
    }
  }
  return out;
}

/**
 * Local port of the shared matcher (src/services/landmark-matching.ts) with the
 * EXACT same semantics — only the DB read is paginated instead of one big query.
 */
async function matchLandmarksPaginated(queryLandmarks: { hash: number; timeCs: number }[]) {
  const queryByHash = new Map<number, number[]>();
  for (const lm of queryLandmarks) {
    let arr = queryByHash.get(lm.hash);
    if (!arr) { arr = []; queryByHash.set(lm.hash, arr); }
    if (arr.length < PER_HASH_TIME_CAP) arr.push(lm.timeCs);
  }
  const queryHashSet = Array.from(queryByHash.keys());
  const queryLandmarkCount = queryLandmarks.length;
  if (queryLandmarkCount === 0) return [];

  const rows = await fetchLandmarks(queryHashSet);

  const piecesById = new Map<string, number[]>();
  const pieceMeta: Record<string, Omit<DbRow, "piece_id" | "hash" | "tc">> = {};
  for (const row of rows) {
    pieceMeta[row.piece_id] = { title: row.title, composer: row.composer, catalog: row.catalog, genre: row.genre, difficulty: row.difficulty, album_art_url: row.album_art_url, sheet_music_url: row.sheet_music_url, tab_url: row.tab_url, is_public_domain: row.is_public_domain };
    const qTimes = queryByHash.get(row.hash);
    if (!qTimes) continue;
    let deltas = piecesById.get(row.piece_id);
    if (!deltas) { deltas = []; piecesById.set(row.piece_id, deltas); }
    for (const qt of qTimes) deltas.push(qt - row.tc);
  }
  if (piecesById.size === 0) return [];

  const results: any[] = [];
  for (const [pieceId, deltas] of piecesById) {
    const best = bestCluster(deltas);
    if (best < MIN_ALIGN_VOTES) continue;
    const confidence = Math.min(1, best / queryLandmarkCount);
    if (confidence < MIN_CONFIDENCE) continue;
    const meta = pieceMeta[pieceId];
    results.push({ piece_id: pieceId, catalog: meta.catalog, title: meta.title, composer: meta.composer, confidence, overlap_count: best });
  }
  results.sort((a, b) => b.confidence - a.confidence || b.overlap_count - a.overlap_count);
  return results.slice(0, TOP_N);
}

/** Mirror of bestCluster() in the shared matcher. */
function bestCluster(deltas: number[]): number {
  let min = Infinity, max = -Infinity;
  for (const d of deltas) { if (d < min) min = d; if (d > max) max = d; }
  if (deltas.length === 0) return 0;
  const span = max - min;
  if (!isFinite(span) || span > 2_000_000) return 1;
  const numBins = Math.ceil(span / DELTA_BIN_CS) + 2;
  const hist = new Int32Array(Math.max(1, numBins));
  const idx = (d: number) => Math.floor((d - min) / DELTA_BIN_CS);
  for (const d of deltas) hist[idx(d)]++;
  let best = 0;
  for (let b = 0; b < hist.length; b++) {
    let sum = hist[b];
    for (let m = 1; m <= MERGE_NEIGHBORS; m++) {
      if (b - m >= 0) sum += hist[b - m];
      if (b + m < hist.length) sum += hist[b + m];
    }
    if (sum > best) best = sum;
  }
  return best;
}

async function classify(queryLandmarks: { hash: number; timeCs: number }[], expectedPieceId: string) {
  const raw = await matchLandmarksPaginated(queryLandmarks);
  // Apply the API's confidence gate exactly like recognize-handler.ts.
  const gated = raw.filter((m) => m.confidence >= MIN_MATCH_CONFIDENCE);
  const top = gated[0] ?? null;
  const rawTop = raw[0] ?? null;
  return { top, rawTop, nGated: gated.length, nRaw: raw.length };
}

async function main() {
  const pieces = (await SQL`SELECT DISTINCT p.id, p.title, p.composer, p.catalog
    FROM piece_landmarks pl JOIN pieces p ON p.id = pl.piece_id ORDER BY p.title`) as unknown as { id: string; title: string; composer: string; catalog: string | null }[];
  console.log(`[1/5] ${pieces.length} fingerprinted pieces`);
  const midis = walkMidis(ROOT); const keyByLocal = new Map<string, string>();
  for (const abs of midis) keyByLocal.set(abs, `scores/${abs.replace(ROOT + "/", "")}`);
  console.log(`[2/5] ${midis.length} midis indexed; rendering with concurrency ${RENDER_CONCURRENCY}...`);
  const tasks: { idx: number; midi: string }[] = [];
  const meta: any[] = [];
  for (let i = 0; i < Math.min(pieces.length, LIMIT); i++) {
    const p = pieces[i]; let best: string | null = null; let bestScore = -1;
    for (const [abs, key] of keyByLocal) { const m = matchPieceFromList(key, [p]); if (m && m.id === p.id) { const s = scoreKey(key, p); if (s > bestScore) { bestScore = s; best = abs; } } }
    meta.push({ idx: i, p, midi: best });
    if (best) tasks.push({ idx: i, midi: best });
  }
  const wavs = await runPool(tasks, RENDER_CONCURRENCY);
  console.log(`[3/5] rendered ${wavs.size} WAVs; matching in-process (paginated, no 507)...`);
  const results: any[] = []; let pass = 0, miss = 0, falsePos = 0, noMidi = 0, err = 0;
  const failures: string[] = []; const falsePositiveList: string[] = [];
  for (const { idx, p, midi } of meta) {
    const w = midi ? wavs.get(idx) : null;
    if (!w) { noMidi++; results.push({ id: p.id, catalog: p.catalog, title: p.title, status: "NO_MIDI" }); failures.push(`${p.catalog||p.title}: no local MIDI found (data issue, not matcher)`); continue; }
    try {
      const buf = readFileSync(w); const dec = await decode(buf);
      let mono: Float32Array;
      if (dec.channelData.length === 1) mono = dec.channelData[0];
      else { const nc = dec.channelData.length; const n = dec.channelData[0].length; mono = new Float32Array(n);
        for (let i = 0; i < n; i++) { let s = 0; for (const c of dec.channelData) s += c[i] ?? 0; mono[i] = s / nc; } }
      const lms = extractLandmarks(mono, 16000);
      const { top, rawTop, nGated, nRaw } = await classify(lms, p.id);
      if (top && top.piece_id === p.id) { pass++; results.push({ id: p.id, catalog: p.catalog, title: p.title, status: "PASS", got: top.catalog ?? top.title, conf: top.confidence }); }
      else if (top) { falsePos++; falsePositiveList.push(`${p.catalog||p.title} -> ${top.catalog ?? top.title} conf=${top.confidence.toFixed(3)}`); results.push({ id: p.id, catalog: p.catalog, title: p.title, status: "WRONG_MATCH", expected: p.catalog, got: top.catalog ?? top.title, conf: top.confidence, rawTop: rawTop ? (rawTop.catalog ?? rawTop.title) : null, rawConf: rawTop?.confidence ?? null }); failures.push(`${p.catalog||p.title}: WRONG_MATCH -> ${top.catalog ?? top.title} conf=${top.confidence.toFixed(3)}`); }
      else { miss++; const rawConf = rawTop ? rawTop.confidence : null; results.push({ id: p.id, catalog: p.catalog, title: p.title, status: "MISS", nGated, rawTop: rawTop ? (rawTop.catalog ?? rawTop.title) : null, rawConf }); failures.push(`${p.catalog||p.title}: MISS (no match >=0.3)` + (rawConf!=null?` rawTop=${rawTop?.catalog} conf=${rawConf.toFixed(3)}`:" rawTop=none")); }
    } catch (e:any) { err++; results.push({ id: p.id, catalog: p.catalog, title: p.title, status: "ERR", error: e?.message || String(e) }); failures.push(`${p.catalog||p.title}: ERR ${e?.message || e}`); }
    rmSync(w, { force: true });
  }

  // --- Non-catalog / control inputs must match NOTHING (false-positive check) --
  console.log(`[4/5] running non-catalog controls (must match nothing >=0.3)...`);
  const controls: any[] = [];
  // Control 1: white noise.
  const noise = new Float32Array(SEGMENT_SECS * 16000);
  let s1 = 7; const rnd1 = () => { s1 = (s1 * 1103515245 + 12345) & 0x7fffffff; return s1 / 0x7fffffff - 0.5; };
  for (let i = 0; i < noise.length; i++) noise[i] = rnd1() * 0.5;
  const nl = extractLandmarks(noise, 16000);
  const nc1 = await classify(nl, "");
  controls.push({ label: "white-noise", nGated: nc1.nGated, matches: nc1.top ? [nc1.top] : [] });
  // Control 2: a rising sine sweep (musical but not in catalog).
  const sine = new Float32Array(SEGMENT_SECS * 16000);
  for (let i = 0; i < sine.length; i++) { const f = 200 + (i / sine.length) * 3000; sine[i] = 0.5 * Math.sin(2 * Math.PI * f * i / 16000); }
  const sl = extractLandmarks(sine, 16000);
  const nc2 = await classify(sl, "");
  controls.push({ label: "sine-sweep", nGated: nc2.nGated, matches: nc2.top ? [nc2.top] : [] });
  const ctrlFps = controls.filter(c => c.nGated > 0).length;

  writeFileSync("/tmp/validate_direct_results.json", JSON.stringify({
    summary: { total: pieces.length, tested: Math.min(pieces.length, LIMIT), pass, miss, false_positive: falsePos, no_midi: noMidi, err, false_positive_controls_triggered: ctrlFps },
    controls, results, failures
  }, null, 2));

  const passPct = ((pass / Math.min(pieces.length, LIMIT)) * 100).toFixed(1);
  console.log(`\n[5/5] SUMMARY total=${pieces.length} tested=${Math.min(pieces.length, LIMIT)} PASS=${pass} (${passPct}%) MISS=${miss} WRONG_MATCH(FP)=${falsePos} NO_MIDI=${noMidi} ERR=${err}`);
  console.log(`      non-catalog controls: ${controls.map(c => `${c.label}->${c.nGated} gated match(es)`).join(", ")}`);
  if (falsePositiveList.length) { console.log("WRONG_MATCH list:"); falsePositiveList.forEach(f => console.log("   ", f)); }
  if (failures.length) console.log("DETAILS:\n" + failures.slice(0, 200).join("\n"));
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
