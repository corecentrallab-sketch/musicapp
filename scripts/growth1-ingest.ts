#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// growth1-ingest.ts — CATALOG GROWTH SPRINT 1
//
// Ingest landmark fingerprints for a curated manifest of NEW public-domain
// pieces (pieces already catalogued in `pieces` but with NO piece_landmarks row).
// Same production pipeline as scripts/ingest-landmarks-capped.ts
// (fluidsynth -ni -r 16000 -g 2.0 + FluidR3_GM.sf2 -> extractLandmarks), but:
//   * never TRUNCATEs — it only touches the manifest's piece ids
//   * caps landmarks per piece at CAP (default 12000) to protect Neon storage
//   * also upserts a `sheet_music_sources` row recording the verified
//     Mutopia provenance (typeset licence + arrangement + source URL)
//
// Usage: DATABASE_URL=... bun scripts/growth1-ingest.ts <manifest.json> [--dry-run]
// ---------------------------------------------------------------------------
import { neon } from "@neondatabase/serverless";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";
import { extractLandmarks } from "../src/services/landmark";
import type { Landmark } from "../src/services/landmark";

const SQL = neon(process.env.DATABASE_URL!);
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const MANIFEST = process.argv[2];
const DRY = process.argv.includes("--dry-run");
const CAP = 12000;

interface MEntry {
  piece_id: string; db_title: string; db_catalog: string | null; composer: string;
  mutopia_title: string; mutopia_pid: string; licence: string; source_url: string;
  rdf_url: string; rdf_title: string; rdf_composer: string; rdf_licence: string;
  midi_file: string; midi_md5: string; midi_bytes: number; arrangement: string;
}

async function renderMono(midiPath: string): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "g1-"));
  try {
    const wav = join(dir, "out.wav");
    execSync(`fluidsynth -ni -r 16000 -g 2.0 -F "${wav}" "${SF2}" "${midiPath}"`, { timeout: 180000, stdio: "pipe" });
    const dec = await decode(readFileSync(wav));
    const ch = dec.channelData;
    if (!ch || !ch.length || !ch[0].length) throw new Error("silent render");
    if (ch.length === 1) return ch[0];
    const n = ch[0].length;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (const c of ch) s += c[i] ?? 0; mono[i] = s / ch.length; }
    return mono;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function capLandmarks(lms: Landmark[], cap: number): Landmark[] {
  if (lms.length <= cap) return lms;
  const stride = lms.length / cap;
  const out: Landmark[] = new Array(cap);
  for (let i = 0; i < cap; i++) out[i] = lms[Math.min(lms.length - 1, Math.floor(i * stride))];
  return out;
}

async function main() {
  const manifest: MEntry[] = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const results: any[] = [];
  for (const m of manifest) {
    const rec: any = { ...m, midi_file: undefined };
    try {
      if (!existsSync(m.midi_file)) throw new Error("midi missing");
      const existing = (await SQL`SELECT count(*)::int AS c FROM piece_landmarks WHERE piece_id=${m.piece_id}::uuid`)[0] as { c: number };
      let didLms = false;
      if (existing.c === 0) {
        const mono = await renderMono(m.midi_file);
        const dur = mono.length / 16000;
        const lms = extractLandmarks(mono, 16000);
        if (!lms.length) throw new Error("0 landmarks");
        const capped = capLandmarks(lms, CAP);
        rec.duration_s = Math.round(dur * 10) / 10;
        rec.landmarks_raw = lms.length; rec.landmarks_stored = capped.length;
        if (DRY) { rec.status = "DRY"; results.push(rec); console.log(`DRY ${m.db_title} dur=${dur.toFixed(0)}s lms=${capped.length}`); continue; }
        await SQL`INSERT INTO piece_landmarks (piece_id, hash, tc)
          SELECT ${m.piece_id}::uuid, * FROM unnest(${capped.map(l => l.hash)}::int[], ${capped.map(l => l.timeCs)}::int[])`;
        didLms = true;
      } else {
        // Never overwrite an existing fingerprint (guard for re-runs) — but the
        // provenance row below is still (re)conciled.
        rec.skipped_existing_landmarks = existing.c;
      }
      // Provenance row: verified Mutopia typeset (licence + arrangement recorded).
      // arrangement_type is kept distinct ("(Mutopia typeset)") so the
      // one_primary_per_type uniqueness constraint can never clash with an
      // existing curation row for the same piece.
      const plat = "mutopia";
      const arr = /mutopia/i.test(m.arrangement) ? m.arrangement : `${m.arrangement} (Mutopia typeset)`;
      const flagReason = `typeset licence: ${m.licence}; Mutopia piece #${m.mutopia_pid}; midi md5 ${m.midi_md5}; rdf: ${m.rdf_title} / ${m.rdf_composer}`;
      const existingSrc = (await SQL`SELECT id FROM sheet_music_sources WHERE piece_id=${m.piece_id}::uuid AND source_url=${m.source_url}`) as unknown as any[];
      if (!existingSrc.length) {
        await SQL`INSERT INTO sheet_music_sources
          (piece_id, source_platform, source_url, format, arrangement_type, rating, vote_count,
           download_count, source_trust, curation_score, is_primary, is_flagged, flag_reason, curated_at)
          VALUES (${m.piece_id}::uuid, ${plat}, ${m.source_url}, 'midi', ${arr},
                  0, 0, 0, 0.9, 0.85, false, false, ${flagReason}, now())`;
        rec.sms_row = "inserted";
      } else {
        await SQL`UPDATE sheet_music_sources SET is_flagged=false, flag_reason=${flagReason}, curated_at=now()
          WHERE piece_id=${m.piece_id}::uuid AND source_url=${m.source_url}`;
        rec.sms_row = "updated";
      }
      rec.status = didLms ? "OK" : "OK_SMS_ONLY";
      results.push(rec);
      console.log(`${rec.status} ${m.db_catalog || ""}\t${m.db_title}\t lms=${rec.landmarks_stored ?? existing.c} ${rec.sms_row}`);
    } catch (e: any) {
      rec.status = "ERR"; rec.error = String(e?.message || e);
      results.push(rec);
      console.log(`ERR ${m.db_title}: ${rec.error}`);
    }
  }
  writeFileSync("/tmp/g1/ingest-result.json", JSON.stringify(results, null, 1));
  const ok = results.filter(r => r.status === "OK").length;
  const [{ c }] = (await SQL`SELECT count(DISTINCT piece_id)::int AS c FROM piece_landmarks`) as unknown as { c: number }[];
  const [{ h }] = (await SQL`SELECT count(*)::int AS h FROM piece_landmarks`) as unknown as { h: number }[];
  console.log(`\nSUMMARY ingested=${ok} / ${manifest.length}; piece_landmarks now ${h} rows over ${c} pieces`);
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
