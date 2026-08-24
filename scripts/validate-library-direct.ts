#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// validate-library-direct.ts — Fast library-wide recognition validation.
//
// Same goal as validate-library.ts (prove the landmark matcher works across the
// breadth of the library) but WITHOUT the HTTP round-trip:
//   1. Resolve each piece's local MIDI (mirrors ingest-landmarks-capped.ts).
//   2. Render a DIFFERENT/perturbed rendition (different gain + noise) than the
//      stored reference.
//   3. Extract query landmarks and pass them DIRECTLY to the real matcher +
//      piece_landmarks DB (the exact same code POST /api/recognize calls).
//   4. Confirm the TOP match is the expected piece; record confidence.
//
// Rendering (fluidsynth) is parallelized (see RENDER_CONCURRENCY) to cut wall
// clock; matching runs sequentially in-process reusing the DB connection.
//
// Usage (from /home/team/shared/site):  export DATABASE_URL=... 
//   bun run scripts/validate-library-direct.ts [--limit N] [--shuffle]
// Writes /tmp/validate_direct_results.json
// ---------------------------------------------------------------------------
import { neon } from "@neondatabase/serverless";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, statSync, readFileSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
const SQL = neon(process.env.DATABASE_URL!);
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const ROOT = "/home/team/shared/mutopia-data";
const RENDER_CONCURRENCY = 3;
const RENDER_GAIN = 1.0;
const NOISE_SNR_DB = 10;
const SEGMENT_SECS = 22;
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG >= 0 ? parseInt(process.argv[LIMIT_ARG + 1], 10) || Infinity : Infinity;

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
    const p = spawn("fluidsynth", ["-ni", "-r", "16000", "-g", String(RENDER_GAIN), "-F", wav, SF2, midiFile], { stdio: "inherit" });
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

async function main() {
  const pieces = (await SQL`SELECT DISTINCT p.id, p.title, p.composer, p.catalog
    FROM piece_landmarks pl JOIN pieces p ON p.id = pl.piece_id ORDER BY p.title`) as unknown as { id: string; title: string; composer: string; catalog: string | null }[];
  console.log(`[1/4] ${pieces.length} fingerprinted pieces`);
  const midis = walkMidis(ROOT); const keyByLocal = new Map<string, string>();
  for (const abs of midis) keyByLocal.set(abs, `scores/${abs.replace(ROOT + "/", "")}`);
  console.log(`[2/4] ${midis.length} midis indexed; rendering with concurrency ${RENDER_CONCURRENCY}...`);
  const tasks: { idx: number; midi: string }[] = [];
  const meta: any[] = [];
  for (let i = 0; i < Math.min(pieces.length, LIMIT); i++) {
    const p = pieces[i]; let best: string | null = null; let bestScore = -1;
    for (const [abs, key] of keyByLocal) { const m = matchPieceFromList(key, [p]); if (m && m.id === p.id) { const s = scoreKey(key, p); if (s > bestScore) { bestScore = s; best = abs; } } }
    meta.push({ idx: i, p, midi: best });
    if (best) tasks.push({ idx: i, midi: best });
  }
  const wavs = await runPool(tasks, RENDER_CONCURRENCY);
  console.log(`[3/4] rendered ${wavs.size} WAVs; matching in-process...`);
  const results: any[] = []; let pass = 0, fail = 0; const failures: string[] = [];
  for (const { idx, p, midi } of meta) {
    const w = midi ? wavs.get(idx) : null;
    if (!w) { results.push({ catalog: p.catalog, title: p.title, status: "NO_MIDI" }); continue; }
    try {
      const buf = readFileSync(w); const dec = await decode(buf);
      let mono: Float32Array;
      if (dec.channelData.length === 1) mono = dec.channelData[0];
      else { const nc = dec.channelData.length; const n = dec.channelData[0].length; mono = new Float32Array(n);
        for (let i = 0; i < n; i++) { let s = 0; for (const c of dec.channelData) s += c[i] ?? 0; mono[i] = s / nc; } }
      const lms = extractLandmarks(mono, 16000);
      const matches = lms.length ? await matchLandmarks(lms) : [];
      const top = matches[0] ?? null;
      const ok = !!top && top.piece_id === p.id;
      results.push({ catalog: p.catalog, title: p.title, status: ok ? "PASS" : "FAIL", got: top ? (top.catalog ?? top.title) : null, conf: top?.confidence ?? null, n_matches: matches.length });
      if (ok) pass++; else { fail++; failures.push(`${p.catalog || p.title}: got=${top ? (top.catalog ?? top.title) : "none"} conf=${top?.confidence ?? "n/a"}`); }
    } catch (e:any) { fail++; results.push({ catalog: p.catalog, title: p.title, status: "ERR" }); failures.push(`${p.catalog || p.title}: ${e?.message || e}`); }
    rmSync(w, { force: true });
  }
  writeFileSync("/tmp/validate_direct_results.json", JSON.stringify({ summary: { total: pieces.length, tested: Math.min(pieces.length, LIMIT), pass, fail }, results }, null, 2));
  console.log(`\n[4/4] SUMMARY pass=${pass} fail=${fail} (tested=${Math.min(pieces.length, LIMIT)})`);
  const confs = results.filter(r => r.conf != null).map(r => r.conf).sort((a, b) => a - b);
  if (confs.length) console.log(`conf: min=${confs[0]} median=${confs[Math.floor(confs.length/2)]} max=${confs[confs.length-1]} n=${confs.length}`);
  if (failures.length) console.log("TOTALFAIL", failures.length, "\n", failures.slice(0, 60).join("\n"));
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
