/**
 * render-score-audio.ts — Render curated practice audio for the daily challenge.
 *
 * For each piece in the VERIFIED manifest below, synthesises its public-domain
 * Mutopia MIDI to a WAV (fluidsynth — the SAME production pipeline the matcher
 * uses), uploads it to R2 at `audio/<piece_id>.wav`, and writes the canonical
 * `audio_url` onto the piece row. GET /api/audio/<piece_id>.wav serves it.
 *
 * Honesty rule (from the task): a piece only gets an audio_url after a verified
 * correct public-domain MIDI has been rendered and the object actually uploaded
 * to R2. Nothing is fabricated. Only clearly public-domain (Mutopia) sources.
 *
 * Usage (from /home/team/shared/site):
 *   export DATABASE_URL=...   (R2 creds come from .env via import)
 *   bun run scripts/render-score-audio.ts [--dry-run]
 * Writes /tmp/render-score-audio-report.json
 */
import { neon } from "@neondatabase/serverless";
import { execSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const SQL = neon(process.env.DATABASE_URL!);
const SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const MUTOPIA = "/home/team/shared/mutopia-data";
const RENDER_RATE = 22050; // 16-bit PCM mono WAV — good practice-play quality, modest size
const PUBLIC_BASE = "https://site-notesnap.vercel.app/api/audio";

const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// VERIFIED CORRECT source manifest: piece_id -> exact Mutopia MIDI (relative to
// MUTOPIA). These are the same 10 pieces re-grounded with byte-exact md5
// evidence in PR #53 (fix/reground-wrong-matched-landmarks) — each MIDI's
// filename unambiguously identifies the piece and self-matches. 2026-08-25.
// ---------------------------------------------------------------------------
const MANIFEST: Record<string, string> = {
  // Chopin Nocturnes Op.9
  "988a0149-821c-4cb1-b31f-d3d07d28e1b8": "O9/nocturne_in_b-flat_minor/nocturne_in_b-flat_minor.mid", // Op.9 No.1
  "5e74d931-ee6c-4ab5-a92b-3293fe7c7b95": "O9/chopin_nocturne_op9_n2/chopin_nocturne_op9_n2.mid",     // Op.9 No.2
  "6643a062-5db8-4ece-a7b9-bf3b876c2d7e": "O9/chopin_nocturne_op9_n3/chopin_nocturne_op9_n3.mid",     // Op.9 No.3
  // Chopin Études Op.10
  "f3b263bc-4100-402b-a87f-8c21d1853943": "O10/chp-10-01/chp-10-01.mid",                               // Op.10 No.1
  "014b481b-fdcc-4b62-b63c-1170732e8f87": "O10/chp-10-05/chp-10-05.mid",                               // Op.10 No.5
  "afa80d59-e32b-444b-9bfc-2955f92a1a63": "O10/chopin-op-10-09-wfi/chopin-op-10-09-wfi.mid",           // Op.10 No.9
  "13615737-9b42-4b09-9f79-1207b83241d2": "O10/op-10-12-wfi/op-10-12-wfi.mid",                         // Op.10 No.12
  // Schumann Kinderszenen Op.15
  "bc4b7071-ff55-416c-84ba-d11bd90ac748": "O15/SchumannOp15No01/SchumannOp15No01.mid",                 // Op.15 No.1
  "f5efc866-10e5-48ec-82c7-3241210755f3": "O15/SchumannOp15No02/SchumannOp15No02.mid",                 // Op.15 No.2
  "61068bff-232d-4dad-abe8-6d576bbc90e7": "O15/SchumannOp15No07/SchumannOp15No07.mid",                 // Op.15 No.7
};

function s3() {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
}

function renderWav(midiAbs: string, outWav: string): void {
  execSync(
    `fluidsynth -ni -r ${RENDER_RATE} -g 2.0 -F "${outWav}" "${SF2}" "${midiAbs}"`,
    { timeout: 120000, stdio: "pipe" },
  );
}

async function main() {
  const report: {
    piece_id: string;
    title?: string;
    midi?: string;
    rendered?: boolean;
    uploaded?: boolean;
    audio_url?: string | null;
    error?: string;
  }[] = [];

  if (DRY_RUN) console.log("[render-score-audio] DRY RUN — no uploads, no DB writes");

  const rows = (await SQL`
    SELECT id, title, composer, catalog FROM pieces
  `) as unknown as { id: string; title: string; composer: string; catalog: string | null }[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const [pieceId, rel] of Object.entries(MANIFEST)) {
    const piece = byId.get(pieceId);
    const entry: (typeof report)[number] = { piece_id: pieceId, title: piece?.title };
    report.push(entry);

    const midiAbs = join(MUTOPIA, rel);

    if (!existsSync(midiAbs)) {
      entry.error = `MIDI missing: ${midiAbs}`;
      console.error(`[render-score-audio] SKIP ${pieceId} (${piece?.title}) — MIDI missing: ${midiAbs}`);
      continue;
    }
    entry.midi = midiAbs;

    try {
      if (!DRY_RUN) {
        const dir = mkdtempSync(join(tmpdir(), "rsa-"));
        const outWav = join(dir, "out.wav");
        try {
          renderWav(midiAbs, outWav);
          const wav = readFileSync(outWav);
          const key = `audio/${pieceId}.wav`;
          await s3().send(
            new PutObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME || "notesnapscores",
              Key: key,
              Body: wav,
              ContentType: "audio/wav",
              CacheControl: "public, max-age=31536000, immutable",
            }),
          );
          const audioUrl = `${PUBLIC_BASE}/${pieceId}.wav`;
          await SQL`UPDATE pieces SET audio_url=${audioUrl} WHERE id=${pieceId}::uuid`;
          entry.rendered = true;
          entry.uploaded = true;
          entry.audio_url = audioUrl;
          console.log(`[render-score-audio] OK ${pieceId} (${piece?.title}) ${key} ${wav.length} bytes -> ${audioUrl}`);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      } else {
        entry.audio_url = `${PUBLIC_BASE}/${pieceId}.wav`;
        console.log(`[render-score-audio] DRY ${pieceId} (${piece?.title}) → would render+upload ${midiAbs}`);
      }
    } catch (err) {
      entry.error = String(err).slice(0, 300);
      console.error(`[render-score-audio] ERROR ${pieceId} (${piece?.title}):`, entry.error);
    }
  }

  writeFileSync("/tmp/render-score-audio-report.json", JSON.stringify(report, null, 2));
  console.log("[render-score-audio] report -> /tmp/render-score-audio-report.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
