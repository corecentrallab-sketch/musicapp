/**
 * Stage 1 ingest: store the NOTES of the public-domain single-guitar pieces.
 *
 * The catalogue has never stored notes — `/api/pieces` returned eleven fields and none of them
 * was a note. A TAB engine cannot render a PDF, so this script is the path that creates: for
 * every Mutopia row that clears the licence gate, download the Standard MIDI File, VALIDATE it,
 * upload it to our R2 bucket, and write a `piece_notes` row that the catalogue serves.
 *
 * The decision is NOT made here. `src/services/pd-notes-gate.ts` decides, in one pure, tested
 * place, and this script only executes its verdict:
 *   - only a row whose own licence field reads "Public Domain" may pass (CC-BY / CC-BY-SA and
 *     anything else are rejected AND COUNTED, never silently skipped);
 *   - a composer with no death year is refused, and Mutopia id 2201 is refused by name as well;
 *   - only single-guitar rows (`for Guitar` / `for Classical Guitar`) are in scope;
 *   - a `.mid` must validate as a Standard MIDI File by content-type AND magic bytes — HTTP 200
 *     is not evidence (a Mutopia *directory* URL answers 200);
 *   - one work, one row (dedupe on composer+title+opus, and the DB's UNIQUE constraints).
 *
 * Run — DRY RUN (the default; downloads + validates everything, writes NOTHING):
 *   cd /home/team/shared/site-fresh && set -a && . ./.env && set +a
 *   bun run scripts/pd-guitar-notes-ingest.ts --out /tmp/pd-guitar-notes-ledger.json
 *
 * Run — APPLY (idempotent; re-runs are safe):
 *   ... bun run scripts/pd-guitar-notes-ingest.ts --write --out /tmp/pd-guitar-notes-ledger.json
 *
 * Prerequisite for --write: `bun run scripts/migrate-piece-notes.ts` (adds pieces.instrument and
 * the piece_notes table). The script refuses to write if the table is missing.
 *
 * Where the notes live: R2 object `notes/<piece-id>.mid`, content-type `audio/sp-midi`, served
 * publicly at `https://site-notesnap.vercel.app/api/notes/<piece-id>.mid` (notes-handler.ts
 * proxies it, because R2 answers 400 to an anonymous GET). The catalogue row references it via
 * `piece_notes.public_url`, which `/api/pieces` exposes as `notes_url` / `notes_available`.
 * NOTHING is added to the app bundle — the app fetches notes over the network.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  NOTES_CONTENT_TYPE,
  notesObjectKey,
  notesUrlForPieceId,
  parseComposerLife,
  planNotesIngest,
  validateMidiPayload,
  type MutopiaRow,
} from "../src/services/pd-notes-gate";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const value = (f: string, fallback: string): string => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const WRITE = has("--write");
const INVENTORY = value("--inventory", join(SCRIPT_DIR, "data", "mutopia-guitar-inventory.json"));
const OUT = value("--out", "/tmp/pd-guitar-notes-ledger.json");
const LIMIT = Number(value("--limit", "0"));
const BUCKET = process.env.R2_BUCKET_NAME || "notesnapscores";

interface Inventory {
  generatedAt: string;
  uniqueEntries: number;
  rows: MutopiaRow[];
}

type Action =
  | "dry-run"
  | "stored"
  | "already-present"
  | "rejected-licence-gate"
  | "rejected-midi-validation"
  | "failed-upload";

interface LedgerRow {
  mutopiaId: number;
  title: string;
  composer: string;
  instrument: string;
  licence: string;
  licenceKey: string;
  composerDied: number | null;
  verdict: "accepted" | "rejected";
  reason: string;
  detail: string;
  action: Action;
  pieceId: string | null;
  pieceAction: "inserted" | "attached" | null;
  r2Key: string | null;
  publicUrl: string | null;
  contentType: string | null;
  bytes: number | null;
  sha256: string | null;
  midiFormat: number | null;
  midiTracks: number | null;
  sourceUrl: string;
  engravingUrl: string;
}

function getR2(): S3Client | null {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

/**
 * Download a `.mid` and measure it. A plain GET would already carry the bytes we need; the
 * `Range: bytes=0-` header is used deliberately so this is a *ranged GET*, the shape the
 * 2026-09-22 link audit established (HEAD lies about content and some hosts answer a directory
 * with 200). The status code is logged but never trusted: `validateMidiPayload` decides.
 */
async function fetchMidi(url: string): Promise<
  | { ok: true; bytes: Uint8Array; contentType: string; status: number }
  | { ok: false; detail: string; contentType: string | null; status: number | null }
> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "user-agent": "NoteSnap catalog curation (PD notes ingest)",
        range: "bytes=0-",
      },
    });
  } catch (err) {
    return { ok: false, detail: `fetch failed: ${String(err).slice(0, 140)}`, contentType: null, status: null };
  }
  const contentType = res.headers.get("content-type");
  if (!res.ok && res.status !== 206) {
    return {
      ok: false,
      detail: `source answered HTTP ${res.status} (status alone is not evidence, but a non-2xx body is not a file)`,
      contentType,
      status: res.status,
    };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { ok: true, bytes, contentType: String(contentType ?? ""), status: res.status };
}

/** The instrument name we store: Mutopia's "for X" cell without the preposition. */
function instrumentName(cell: string): string {
  return cell.replace(/^for\s+/i, "").trim();
}

/** Mutopia's style column maps onto the catalogue's era bucket vocabulary. */
function genreFor(style: string): string | null {
  const s = style.trim().toLowerCase();
  if (!s) return null;
  const known = ["renaissance", "baroque", "classical", "romantic", "impressionist", "modern"];
  return known.includes(s) ? style.trim() : null;
}

async function main(): Promise<void> {
  const inventory = JSON.parse(readFileSync(INVENTORY, "utf8")) as Inventory;
  const rows = LIMIT > 0 ? inventory.rows.slice(0, LIMIT) : inventory.rows;
  console.log(`inventory: ${INVENTORY} (${inventory.uniqueEntries} entries, ${inventory.generatedAt})`);
  console.log(`mode: ${WRITE ? "WRITE" : "DRY RUN (no DB, no R2)"}`);

  const plan = planNotesIngest(rows);
  const ledger: LedgerRow[] = [];

  for (const rej of plan.rejected) {
    const life = parseComposerLife(rej.row.composer);
    ledger.push({
      mutopiaId: rej.row.id,
      title: rej.row.title,
      composer: rej.row.composer,
      instrument: rej.row.instrument,
      licence: rej.row.lic_text,
      licenceKey: rej.row.lic_key,
      composerDied: life.death,
      verdict: "rejected",
      reason: rej.reason,
      detail: rej.detail,
      action: "rejected-licence-gate",
      pieceId: null,
      pieceAction: null,
      r2Key: null,
      publicUrl: null,
      contentType: null,
      bytes: null,
      sha256: null,
      midiFormat: null,
      midiTracks: null,
      sourceUrl: rej.row.mid,
      engravingUrl: rej.row.ly,
    });
  }

  // --- download + validate every gate-accepted row, in gate order -----------------------
  const validated: Array<{ entry: (typeof plan.accepted)[number]; midi: NonNullable<Awaited<ReturnType<typeof fetchMidi>>> & { ok: true }; v: Extract<ReturnType<typeof validateMidiPayload>, { ok: true }> }> = [];
  for (const entry of plan.accepted) {
    const row = entry.row;
    const base: LedgerRow = {
      mutopiaId: row.id,
      title: row.title,
      composer: row.composer,
      instrument: row.instrument,
      licence: row.lic_text,
      licenceKey: row.lic_key,
      composerDied: entry.composerDeathYear,
      verdict: "accepted",
      reason: "public-domain single guitar",
      detail: entry.licenceEvidence.join(" | "),
      action: "dry-run",
      pieceId: null,
      pieceAction: null,
      r2Key: null,
      publicUrl: null,
      contentType: null,
      bytes: null,
      sha256: null,
      midiFormat: null,
      midiTracks: null,
      sourceUrl: row.mid,
      engravingUrl: row.ly,
    };
    ledger.push(base);

    const midi = await fetchMidi(row.mid);
    if (!midi.ok) {
      base.action = "rejected-midi-validation";
      base.reason = "midi-download-failed";
      base.detail = midi.detail;
      base.contentType = midi.contentType;
      console.log(`REJECT | ${row.id} ${row.title} | ${midi.detail}`);
      continue;
    }
    base.contentType = midi.contentType;
    const v = validateMidiPayload(midi.bytes, midi.contentType);
    if (!v.ok) {
      base.action = "rejected-midi-validation";
      base.reason = "midi-invalid-payload";
      base.detail = v.reason;
      console.log(`REJECT | ${row.id} ${row.title} | ${v.reason}`);
      continue;
    }
    base.bytes = v.bytes;
    base.sha256 = v.sha256;
    base.midiFormat = v.format;
    base.midiTracks = v.tracks;
    console.log(
      `VALID  | ${row.id} ${row.title} | ${v.bytes}B ${v.tracks}trk fmt${v.format} ${v.sha256.slice(0, 12)}`,
    );
    validated.push({ entry, midi: midi as never, v });
  }

  // --- write phase -----------------------------------------------------------------------
  let dbState: Record<string, unknown> | null = null;
  if (WRITE) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const sql = neon(url);
    const s3 = getR2();
    if (!s3) throw new Error("R2 env not configured (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");

    const tableCheck = (await sql`
      SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'piece_notes'
    `) as unknown as Array<{ n: number }>;
    if ((tableCheck[0]?.n ?? 0) === 0) {
      throw new Error("piece_notes table is missing — run scripts/migrate-piece-notes.ts first");
    }

    for (const { entry, midi, v } of validated) {
      const row = entry.row;
      const ledgerRow = ledger.find((l) => l.mutopiaId === row.id && l.verdict === "accepted")!;

      // 1. already ingested? (idempotent re-run)
      const existingNotes = (await sql`
        SELECT id, piece_id FROM piece_notes
        WHERE source_platform = 'mutopia' AND source_id = ${String(row.id)}
      `) as unknown as Array<{ id: string; piece_id: string }>;
      if (existingNotes.length > 0) {
        ledgerRow.action = "already-present";
        ledgerRow.pieceId = existingNotes[0].piece_id;
        ledgerRow.publicUrl = notesUrlForPieceId(existingNotes[0].piece_id);
        console.log(`SKIP   | ${row.id} ${row.title} | notes already stored for piece ${existingNotes[0].piece_id}`);
        continue;
      }

      // 2. find-or-create the catalogue piece
      const life = parseComposerLife(row.composer);
      const composerName = life.name;
      const surname = composerName.split(/\s+/).slice(-1)[0] ?? composerName;
      const candidates = (await sql`
        SELECT id, composer FROM pieces
        WHERE lower(title) = lower(${row.title})
        ORDER BY created_at
      `) as unknown as Array<{ id: string; composer: string }>;
      const match = candidates.find((c) => c.composer.toLowerCase().includes(surname.toLowerCase()));

      let pieceId: string;
      if (match) {
        pieceId = match.id;
        ledgerRow.pieceAction = "attached";
        await sql`
          UPDATE pieces SET instrument = COALESCE(instrument, ${instrumentName(row.instrument)})
          WHERE id = ${pieceId}::uuid
        `;
        console.log(`ATTACH | ${row.id} ${row.title} -> existing piece ${pieceId}`);
      } else {
        const inserted = (await sql`
          INSERT INTO pieces (title, composer, catalog, genre, difficulty, is_public_domain, instrument)
          VALUES (${row.title}, ${composerName}, ${row.opus || null}, ${genreFor(row.style)},
                  NULL, true, ${instrumentName(row.instrument)})
          RETURNING id
        `) as unknown as Array<{ id: string }>;
        pieceId = inserted[0].id;
        ledgerRow.pieceAction = "inserted";
        console.log(`INSERT | ${row.id} ${row.title} -> new piece ${pieceId}`);
      }
      ledgerRow.pieceId = pieceId;

      // 3. the notes object
      const key = notesObjectKey(pieceId);
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: midi.bytes,
          ContentType: NOTES_CONTENT_TYPE,
          ContentLength: midi.bytes.byteLength,
          CacheControl: "public, max-age=31536000, immutable",
          Metadata: { sha256: v.sha256, source: "mutopia", mutopia_id: String(row.id) },
        }),
      );
      ledgerRow.r2Key = key;
      ledgerRow.publicUrl = notesUrlForPieceId(pieceId);
      ledgerRow.action = "stored";
      console.log(`R2     | ${key} | ${v.bytes} bytes`);

      // 4. the catalogue row that references it
      await sql`
        INSERT INTO piece_notes (
          piece_id, source_platform, source_id, identity_key, work_key, title, composer,
          composer_died, instrument, licence_label, licence_evidence, source_url, engraving_url,
          r2_key, public_url, content_type, bytes, sha256, midi_format, midi_tracks, midi_division
        ) VALUES (
          ${pieceId}::uuid, 'mutopia', ${String(row.id)}, ${entry.identityKey}, ${entry.workKey},
          ${row.title}, ${composerName}, ${entry.composerDeathYear},
          ${instrumentName(row.instrument)}, ${row.lic_text}, ${JSON.stringify(entry.licenceEvidence)}::jsonb,
          ${row.mid}, ${row.ly || null}, ${key}, ${notesUrlForPieceId(pieceId)}, ${NOTES_CONTENT_TYPE},
          ${v.bytes}, ${v.sha256}, ${v.format}, ${v.tracks}, ${v.division}
        )
      `;

      // 5. provenance, same shape as the other ingests
      await sql`
        INSERT INTO curation_log (piece_id, action, source_platform, details)
        VALUES (${pieceId}::uuid, 'catalog-add', 'mutopia',
                ${JSON.stringify({
                  source: "scripts/pd-guitar-notes-ingest.ts",
                  kind: "notes",
                  mutopia_id: row.id,
                  source_url: row.mid,
                  r2_key: key,
                  public_url: notesUrlForPieceId(pieceId),
                  licence_label: row.lic_text,
                  licence_evidence: entry.licenceEvidence,
                  composer_died: entry.composerDeathYear,
                  sha256: v.sha256,
                  bytes: v.bytes,
                })})
      `;
    }

    dbState = ((
      await sql`
        SELECT
          (SELECT count(*)::int FROM pieces) AS total_pieces,
          (SELECT count(*)::int FROM pieces WHERE instrument IS NOT NULL) AS pieces_with_instrument,
          (SELECT count(*)::int FROM piece_notes) AS note_rows,
          (SELECT count(*)::int FROM pieces WHERE sheet_music_url LIKE '%/api/sheets/%') AS hosted_scores
      `
    ) as unknown as Array<Record<string, number>>)[0];
    console.log("DB now:", JSON.stringify(dbState));
  }

  // --- ledger + report -------------------------------------------------------------------
  const acceptedRows = ledger.filter((l) => l.verdict === "accepted");
  const midiRejected = ledger.filter((l) => l.reason === "midi-invalid-payload" || l.reason === "midi-download-failed");
  const storable = acceptedRows.filter((l) => !midiRejected.includes(l));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: WRITE ? "write" : "dry-run",
    inventory: { path: INVENTORY, generatedAt: inventory.generatedAt, entries: inventory.uniqueEntries },
    examined: plan.examined,
    gateAccepted: plan.accepted.length,
    gateRejected: plan.rejected.length,
    rejectionCounts: plan.rejectionCounts,
    midiRejected: midiRejected.length,
    storable: storable.length,
    collisions: plan.collisions,
    nearCollisions: plan.nearCollisions,
    stored: ledger.filter((l) => l.action === "stored").length,
    alreadyPresent: ledger.filter((l) => l.action === "already-present").length,
    dbState,
    rows: ledger,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 1));

  console.log("\n=== COUNTS ===");
  console.log(`examined (Mutopia rows)      : ${plan.examined}`);
  console.log(`gate accepted                : ${plan.accepted.length}`);
  console.log(`gate rejected                : ${plan.rejected.length}`);
  for (const [reason, n] of Object.entries(plan.rejectionCounts)) console.log(`   ${reason.padEnd(28)}: ${n}`);
  console.log(`midi validation rejected     : ${midiRejected.length}`);
  console.log(`STORABLE (validated notes)   : ${storable.length}`);
  if (plan.collisions.length) console.log(`duplicate-identity collisions: ${JSON.stringify(plan.collisions)}`);
  if (plan.nearCollisions.length) console.log(`near-collisions reported     : ${JSON.stringify(plan.nearCollisions)}`);
  console.log(`ledger -> ${OUT}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("ingest failed:", err);
    process.exit(1);
  });
}
