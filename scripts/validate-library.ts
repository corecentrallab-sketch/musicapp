#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// validate-library.ts — Library-wide recognition validation (owner-asked).
//
// Proves the robust landmark matcher genuinely works across the ENTIRE
// fingerprinted library, not just the single Für Elise case used in earlier
// smoke tests. For each of the ~113 pieces with a piece_landmarks row we:
//   1. Resolve its local mutopia-data MIDI (mirrors ingest-landmarks-capped).
//   2. Render a DIFFERENT/perturbed rendition (lower gain + added noise) than
//      the stored reference (which was gain 2.0, clean).
//   3. POST it through the live /api/recognize endpoint (using the internal
//      QA identity so the free-tier 5/month cap is bypassed — NOT touched).
//   4. Check that the TOP match is the expected piece, and record confidence.
//
// Usage (from /home/team/shared/site, with the server up on :3000 armed with
//   RECOGNITION_QA_BYPASS=1):
//   export DATABASE_URL=...
//   bun run scripts/validate-library.ts [--limit N]
// Output: per-piece table + summary; writes /tmp/validate_results.json
// ---------------------------------------------------------------------------
import { neon } from "@neondatabase/serverless";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, statSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
const SQL = neon(process.env.DATABASE_URL!);
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const ROOT = "/home/team/shared/mutopia-data";
const ENDPOINT = "http://127.0.0.1:3000/api/recognize";
const QA_ID = "qa-internal-test-device-0000";
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG >= 0 ? parseInt(process.argv[LIMIT_ARG + 1], 10) || Infinity : Infinity;
// Distinct "different rendition" vs stored ref (gain 2.0 clean): lower gain +
// additive noise. Deliberately not identical to the reference render.
const RENDER_GAIN = 1.0;
const NOISE_SNR_DB = 10;
const SEGMENT_SECS = 22; // keep each upload well under the 4 MB endpoint cap

// ---- catalog helpers (mirror ingest-landmarks-capped.ts) ----
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
function matchPieceFromList(key: string, allPieces: { id: string; title: string; composer: string; catalog: string | null }[]) {
  const r2Catalog = extractCatalogFromKey(key);
  if (!r2Catalog) return null;
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
async function synthPerturbed(midiPath: string): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "vl-")); const midiFile = join(dir, "in.mid"); const wav = join(dir, "out.wav");
  writeFileSync(midiFile, readFileSync(midiPath));
  execSync(`fluidsynth -ni -r 16000 -g ${RENDER_GAIN} -F "${wav}" "${SF2}" "${midiFile}"`, { timeout: 120000, stdio: "pipe" });
  const buf = readFileSync(wav); const dec = await decode(buf);
  let mono: Float32Array;
  if (dec.channelData.length === 1) mono = dec.channelData[0];
  else { const nc = dec.channelData.length; const n = dec.channelData[0].length; mono = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (const c of dec.channelData) s += c[i] ?? 0; mono[i] = s / nc; } }
  rmSync(dir, { recursive: true, force: true });
  return addNoiseSamples(mono, NOISE_SNR_DB);
}
async function postRecognize(wavPath: string): Promise<any> {
  const proc = Bun.spawn(["curl", "-s", "-m", "120", "-X", "POST", ENDPOINT,
    "-H", `x-user-id: ${QA_ID}`, "-F", `audio=@${wavPath};type=audio/wav`]);
  const out = await new Response(proc.stdout).text();
  try { return JSON.parse(out); } catch { return { success: false, error: "bad resp", raw: out.slice(0, 200) }; }
}

async function main() {
  const pieces = (await SQL`
    SELECT DISTINCT p.id, p.title, p.composer, p.catalog
    FROM piece_landmarks pl JOIN pieces p ON p.id = pl.piece_id
    ORDER BY p.title`) as unknown as { id: string; title: string; composer: string; catalog: string | null }[];
  console.log(`[1/4] ${pieces.length} fingerprinted pieces to validate`);
  const midis = walkMidis(ROOT);
  const keyByLocal = new Map<string, string>();
  for (const abs of midis) keyByLocal.set(abs, `scores/${abs.replace(ROOT + "/", "")}`);
  console.log(`[2/4] ${midis.length} local midis indexed`);
  const results: any[] = [];
  let pass = 0, fail = 0, midiFail = 0;
  const failures: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (i >= LIMIT) break;
    const p = pieces[i];
    let best: string | null = null; let bestScore = -1;
    for (const [abs, key] of keyByLocal) {
      const m = matchPieceFromList(key, [p]);
      if (m && m.id === p.id) { const s = scoreKey(key, p); if (s > bestScore) { bestScore = s; best = abs; } }
    }
    if (!best) { midiFail++; failures.push(`${p.catalog || p.title}: no MIDI`); results.push({ catalog: p.catalog, title: p.title, status: "NO_MIDI" }); continue; }
    let mono: Float32Array;
    try { mono = await synthPerturbed(best); } catch (e: any) { fail++; failures.push(`${p.catalog || p.title}: synth fail ${e?.message || e}`); results.push({ catalog: p.catalog, title: p.title, status: "SYNTH_FAIL" }); continue; }
    const seg = mono.slice(0, SEGMENT_SECS * 16000);
    const wavPath = `/tmp/vl_${i}.wav`;
    writeWav16(wavPath, seg);
    const r = await postRecognize(wavPath);
    const top = (r && Array.isArray(r.matches) && r.matches.length) ? r.matches[0] : null;
    const ok = !!top && top.piece_id === p.id;
    results.push({ catalog: p.catalog, title: p.title, expected: p.id, status: ok ? "PASS" : "FAIL", top_piece: top?.catalog ?? top?.title ?? null, top_conf: top?.confidence ?? null, n_matches: r?.matches?.length ?? 0 });
    if (ok) pass++; else { fail++; failures.push(`${p.catalog || p.title}: got=${top?.catalog ?? top?.title ?? "none"} conf=${top?.confidence ?? "n/a"}`); }
    rmSync(wavPath, { force: true });
    if ((i + 1) % 10 === 0 || i === pieces.length - 1) console.log(`   [${i + 1}/${pieces.length}] pass=${pass} fail=${fail}`);
  }
  const summary = { total: pieces.length, tested: Math.min(pieces.length, LIMIT), pass, fail, midiFail, failures: failures.slice(0, 50) };
  writeFileSync("/tmp/validate_results.json", JSON.stringify({ summary, results }, null, 2));
  console.log(`\n[3/4] SUMMARY pass=${pass} fail=${fail} midiFail=${midiFail} (tested=${Math.min(pieces.length, LIMIT)})`);
  if (failures.length) console.log("   Issues:", failures.slice(0, 50));
  let confs = results.filter(r => r.top_conf != null).map(r => r.top_conf);
  if (confs.length) {
    confs.sort((a, b) => a - b);
    console.log(`[4/4] top-confidence min=${confs[0]} p25=${confs[Math.floor(confs.length*0.25)]} median=${confs[Math.floor(confs.length/2)]} max=${confs[confs.length-1]} n=${confs.length}`);
  }
}
main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
