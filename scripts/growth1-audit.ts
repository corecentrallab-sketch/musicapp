#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// growth1-audit.ts — CATALOG GROWTH SPRINT 1 verification gate.
//
// Reproduces the audit method in scripts/audit-full-sweep.ts (verified-correct
// Mutopia MIDI -> fluidsynth 16k -> +10dB noise 22s rendition -> extractLandmarks
// -> matchLandmarks against the LIVE DB) for:
//   A) every NEW piece in the growth manifest  => self must be top & conf>=0.3,
//      and NO other piece may appear at conf>=0.3 (no cross-fingerprint).
//   B) every PRE-EXISTING fingerprinted piece with a verified source (parsed out
//      of audit-full-sweep.ts) => a NEW piece must NOT appear at conf>=0.3
//      (regression check: growth must not steal old pieces' audio).
//   C) non-catalog controls (white noise, sine sweep) => must return EMPTY.
// Writes /tmp/g1/audit-growth-1.json
// ---------------------------------------------------------------------------
import { neon } from "@neondatabase/serverless";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import { matchLandmarks } from "../src/services/landmark-matching";
import { applyMatchPolicy } from "../src/services/match-policy";

const SQL = neon(process.env.DATABASE_URL!);
const MUTOPIA = "/home/team/shared/mutopia-data";
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const SEGMENT_SECS = 22;
const CROSS_THRESHOLD = 0.3;

// --- Old-piece verified source manifest: parsed from audit-full-sweep.ts -----
function parseOldSrc(): Record<string, string> {
  const txt = readFileSync(join(import.meta.dir, "audit-full-sweep.ts"), "utf8");
  const block = txt.slice(txt.indexOf("const SRC: Record<string, string> = {"), txt.indexOf("};", txt.indexOf("const SRC")));
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*"([^"]+)":\s*"([^"]+)",/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

interface MEntry { piece_id: string; db_title: string; db_catalog: string | null; composer: string; midi_file: string; midi_md5: string; source_url: string; licence: string; mutopia_pid: string; }

function addNoise(samples: Float32Array, snrDb: number): Float32Array {
  const out = new Float32Array(samples);
  const signal = samples.reduce((a, b) => a + b * b, 0) / samples.length;
  const np = signal / Math.pow(10, snrDb / 10);
  let s = 42; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  for (let i = 0; i < out.length; i++) out[i] += Math.sqrt(np) * 2 * rnd();
  return out;
}

async function renderNoisy(midiPath: string): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "g1a-"));
  try {
    const wav = join(dir, "out.wav");
    execSync(`fluidsynth -ni -r 16000 -g 2.0 -F "${wav}" "${SF2}" "${midiPath}"`, { timeout: 180000, stdio: "pipe" });
    const dec = await decode(readFileSync(wav));
    const ch = dec.channelData;
    let mono: Float32Array;
    if (ch.length === 1) mono = ch[0];
    else { const n = ch[0].length; mono = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const c of ch) s += c[i] ?? 0; mono[i] = s / ch.length; } }
    return addNoise(mono, 10).slice(0, SEGMENT_SECS * 16000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function summarize(raw: any[]) {
  const gated = raw.filter(m => m.confidence >= CROSS_THRESHOLD).map(m => ({
    piece_id: m.piece_id, catalog: m.catalog, title: m.title, conf: Math.round(m.confidence * 1000) / 1000,
  }));
  return { top5: raw.slice(0, 5).map(m => ({ catalog: m.catalog, title: m.title, conf: Math.round(m.confidence * 1000) / 1000 })), gated };
}

async function main() {
  const manifest: MEntry[] = JSON.parse(readFileSync("/tmp/g1/manifest.json", "utf8"));
  const newIds = new Map(manifest.map(m => [m.piece_id, m]));
  const oldSrc = parseOldSrc();
  const db = (await SQL`SELECT id, title, composer, catalog,
      (SELECT count(*)::int FROM piece_landmarks pl WHERE pl.piece_id=p.id) lms
    FROM pieces p ORDER BY title`) as unknown as any[];
  const byId = new Map(db.map(r => [r.id, r]));

  const newResults: any[] = [];
  for (const m of manifest) {
    const rec: any = { piece_id: m.piece_id, catalog: m.db_catalog, title: m.db_title, composer: m.composer, src_md5: m.midi_md5, source_url: m.source_url, licence: m.licence, mutopia_pid: m.mutopia_pid };
    try {
      const mono = await renderNoisy(m.midi_file);
      const lms = extractLandmarks(mono, 16000);
      const raw = await matchLandmarks(lms);
      const pol = applyMatchPolicy(raw);
      const s = summarize(raw as any[]);
      rec.queryLms = lms.length; rec.gated = s.gated; rec.rawTop5 = s.top5;
      rec.policyOk = pol.ok; rec.policyTop = pol.ok ? pol.top.catalog : null;
      const others = s.gated.filter(g => g.piece_id !== m.piece_id);
      const self = s.gated.find(g => g.piece_id === m.piece_id);
      rec.selfConf = self ? self.conf : (s.top5[0] ? s.top5[0].conf : 0);
      rec.selfIsTop = !!s.top5[0] && s.top5[0].conf === (self ? self.conf : -1);
      rec.crossMatches = others;
      rec.status = (self && rec.selfIsTop && others.length === 0) ? "PASS" : (others.length ? "CROSS_FP" : (!self ? "MISS" : (rec.selfIsTop ? "PASS" : "WRONG")));
      console.log(`${rec.status}\t${m.db_catalog || ""}\t${m.db_title}\tself=${rec.selfConf} top=${s.top5[0]?.catalog}@${s.top5[0]?.conf} gated=${s.gated.length} policy=${pol.ok ? "OK" : (pol as any).reason}`);
    } catch (e: any) { rec.status = "ERR"; rec.error = String(e?.message || e); console.log(`ERR ${m.db_title}: ${rec.error}`); }
    newResults.push(rec);
  }

  // (B) regression: old verified pieces must not now hit a NEW piece
  const regressions: any[] = [];
  for (const [cat, rel] of Object.entries(oldSrc)) {
    const abs = join(MUTOPIA, rel);
    const rec: any = { catalog: cat, src: rel };
    if (!existsSync(abs)) { rec.status = "NOT_SOURCED"; regressions.push(rec); continue; }
    try {
      const mono = await renderNoisy(abs);
      const lms = extractLandmarks(mono, 16000);
      const raw = await matchLandmarks(lms);
      const s = summarize(raw as any[]);
      const top = s.top5[0];
      const selfRow = db.find(r => r.catalog === cat && Number(r.lms) > 0);
      rec.top = top; rec.gated = s.gated;
      const newHit = s.gated.find(g => newIds.has(g.piece_id));
      rec.newPieceAtOrAbove03 = newHit || null;
      rec.selfTop = top && selfRow ? (top.title === selfRow.title) : null;
      rec.status = newHit ? "REGRESSION" : (rec.selfTop === false ? "PREEXISTING_WRONG_TOP" : "OK");
      console.log(`OLD ${rec.status}\t${cat}\ttop=${top?.catalog}@${top?.conf}${newHit ? " NEWHIT=" + newHit.catalog + "@" + newHit.conf : ""}`);
    } catch (e: any) { rec.status = "ERR"; rec.error = String(e?.message || e); console.log(`OLD ERR ${cat}: ${rec.error}`); }
    regressions.push(rec);
  }

  // (C) controls
  const controls: any[] = [];
  const noise = new Float32Array(SEGMENT_SECS * 16000); let s1 = 7;
  const rnd1 = () => { s1 = (s1 * 1103515245 + 12345) & 0x7fffffff; return s1 / 0x7fffffff - 0.5; };
  for (let i = 0; i < noise.length; i++) noise[i] = rnd1() * 0.5;
  const nraw = await matchLandmarks(extractLandmarks(noise, 16000)) as any[];
  controls.push({ label: "white-noise", gated: summarize(nraw).gated, policyOk: applyMatchPolicy(nraw).ok });
  const sine = new Float32Array(SEGMENT_SECS * 16000);
  for (let i = 0; i < sine.length; i++) { const f = 200 + (i / sine.length) * 3000; sine[i] = 0.5 * Math.sin(2 * Math.PI * f * i / 16000); }
  const sraw = await matchLandmarks(extractLandmarks(sine, 16000)) as any[];
  controls.push({ label: "sine-sweep", gated: summarize(sraw).gated, policyOk: applyMatchPolicy(sraw).ok });

  const summary = {
    newPieces: newResults.length,
    newPass: newResults.filter(r => r.status === "PASS").length,
    newCrossFp: newResults.filter(r => r.status === "CROSS_FP").length,
    newMiss: newResults.filter(r => r.status === "MISS").length,
    newWrong: newResults.filter(r => r.status === "WRONG").length,
    newErr: newResults.filter(r => r.status === "ERR").length,
    oldChecked: regressions.length,
    oldRegressions: regressions.filter(r => r.status === "REGRESSION").length,
    controlFalsePositives: controls.filter(c => c.gated.length > 0).length,
    recognizablePiecesTotal: db.filter(r => Number(r.lms) > 0).length,
  };
  const payload = { generatedAt: new Date().toISOString(), summary, controls, newResults, oldRegressions: regressions };
  writeFileSync("/tmp/g1/audit-growth-1.json", JSON.stringify(payload, null, 1));
  writeFileSync("/home/team/shared/audit-growth-1.json", JSON.stringify(payload, null, 1));
  console.log("\n=========== SUMMARY ===========");
  console.log(JSON.stringify(summary, null, 1));
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
