#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// growth2-liveprobe.ts — CATALOG GROWTH SPRINT 2 live gate.
//
// For every piece in the manifest: render the verified Mutopia MIDI with
// fluidsynth (-r 16000), trim to 30s, encode a STEREO 16-bit WAV (what the app
// uploads, ~1.92 MB, well under the API's 4 MB cap) and POST it to the LIVE
// /api/recognize endpoint with the sanctioned QA identity header so the
// free-tier 5/month cap does not apply. Records the verbatim transcript.
//
// Usage: bun scripts/growth2-liveprobe.ts <manifest.json> [out.json]
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import decode from "audio-decode";

const ENDPOINT = process.env.RECOGNIZE_URL || "https://site-notesnap.vercel.app/api/recognize";
const QA_ID = "qa-internal-test-device-0000";
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const SECS = 30;
const SR = 16000;

interface MEntry { piece_id: string; db_title: string; db_catalog: string | null; composer: string; midi_file: string; midi_md5: string; licence: string; mutopia_pid: string; }

/** 16-bit PCM stereo WAV from one or more Float32 channels. */
function encodeWav(chans: Float32Array[], sampleRate: number): Uint8Array {
  const frames = Math.min(...chans.map(c => c.length));
  const nch = chans.length >= 2 ? 2 : 1;
  const dataBytes = frames * nch * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "latin1");
  buf.write("fmt ", 12, "latin1");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(nch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * nch * 2, 28);
  buf.writeUInt16LE(nch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "latin1");
  buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const s = chans[c] ?? chans[0];
      let v = Math.max(-1, Math.min(1, s[i] ?? 0));
      buf.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

async function renderStereoWav(midi: string): Promise<{ wav: Uint8Array; secs: number }> {
  const dir = mkdtempSync(join(tmpdir(), "g2p-"));
  try {
    const out = join(dir, "out.wav");
    execSync(`fluidsynth -ni -r ${SR} -g 2.0 -F "${out}" "${SF2}" "${midi}"`, { timeout: 180000, stdio: "pipe" });
    const dec = await decode(readFileSync(out));
    const ch = dec.channelData as Float32Array[];
    const trimmed = ch.map(c => c.subarray(0, SECS * SR));
    return { wav: encodeWav(trimmed, SR), secs: Math.min(trimmed[0].length / SR, SECS) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function main() {
  const manifest: MEntry[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const outPath = process.argv[3] || "/tmp/g2/live-probe.json";
  const results: any[] = [];
  for (const m of manifest) {
    const rec: any = { piece_id: m.piece_id, catalog: m.db_catalog, db_title: m.db_title, composer: m.composer, sent_title: m.db_title };
    try {
      if (!existsSync(m.midi_file)) throw new Error("midi missing");
      const { wav, secs } = await renderStereoWav(m.midi_file);
      rec.wav_bytes = wav.length; rec.secs = secs;
      const fd = new FormData();
      fd.append("audio", new File([wav], "probe.wav", { type: "audio/wav" }));
      const res = await fetch(ENDPOINT, { method: "POST", headers: { "x-user-id": QA_ID }, body: fd });
      rec.http = res.status;
      const body: any = await res.json();
      rec.ok = body.success === true;
      rec.db_available = body.db_available;
      rec.matches = body.matches;
      rec.no_confident_match_reason = body.no_confident_match_reason ?? null;
      rec.received_audio = body.received_audio ?? null;
      rec.error = body.error ?? null;
      const top = Array.isArray(body.matches) && body.matches[0] ? body.matches[0] : null;
      rec.served_title = top ? top.title : null;
      rec.served_conf = top ? top.confidence : null;
      if (res.status === 200 && top && String(top.title) === String(m.db_title)) rec.class = "CORRECT";
      else if (res.status === 200 && !top) rec.class = "HONEST-MISS";
      else if (res.status === 200 && top) rec.class = "WRONG-TITLE";
      else rec.class = "ERROR";
      console.log(`${rec.class}\t${m.db_catalog || ""}\t${m.db_title}\t-> ${rec.served_title ?? "(none)"} conf=${rec.served_conf ?? "-"} http=${res.status} bytes=${wav.length}`);
    } catch (e: any) {
      rec.class = "ERROR"; rec.error = String(e?.message || e);
      console.log(`ERROR ${m.db_title}: ${rec.error}`);
    }
    results.push(rec);
    writeFileSync(outPath, JSON.stringify(results, null, 1));
  }
  const tally = (c: string) => results.filter(r => r.class === c).length;
  const summary = { total: results.length, CORRECT: tally("CORRECT"), "HONEST-MISS": tally("HONEST-MISS"), "WRONG-TITLE": tally("WRONG-TITLE"), ERROR: tally("ERROR") };
  writeFileSync(outPath.replace(/\.json$/, "-summary.json"), JSON.stringify({ generatedAt: new Date().toISOString(), endpoint: ENDPOINT, summary, results }, null, 1));
  console.log("\n=== LIVE SUMMARY ===");
  console.log(JSON.stringify(summary, null, 1));
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
