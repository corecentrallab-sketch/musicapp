/**
 * Verify every stored NOTES object end to end, through the real route handler.
 *
 * The defect class this closes is the one that has bitten this project before: a check that
 * asserts *status* and calls it verified. So this script does not curl a URL and look for 200.
 * For every `piece_notes` row it calls `handleNotesServe` itself — the same function both server
 * entries route to — with the real R2 credentials, and asserts:
 *
 *   1. HTTP 200 from the handler;
 *   2. `Content-Type: audio/sp-midi`;
 *   3. the body starts with `MThd` (a Standard MIDI File, not a directory listing);
 *   4. the body's sha256 equals the sha256 recorded at ingest — the bytes served are the bytes
 *      that passed the gate.
 *
 * Run:
 *   cd /home/team/shared/site-fresh && set -a && . ./.env && set +a
 *   bun run scripts/verify-piece-notes.ts
 *
 * Exit code 0 only when every stored note set verifies. Prints one line per failure.
 */
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { handleNotesServe } from "../src/services/notes-handler";
import { NOTES_CONTENT_TYPE, notesUrlForPieceId } from "../src/services/pd-notes-gate";

interface Row {
  piece_id: string;
  source_id: string;
  title: string;
  public_url: string;
  sha256: string;
  bytes: number;
  content_type: string;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);
  const rows = (await sql`
    SELECT piece_id, source_id, title, public_url, sha256, bytes, content_type
    FROM piece_notes ORDER BY source_id
  `) as unknown as Row[];
  console.log(`stored note sets: ${rows.length}`);

  let ok = 0;
  const failures: string[] = [];
  for (const row of rows) {
    const expectedUrl = notesUrlForPieceId(row.piece_id);
    if (row.public_url !== expectedUrl) {
      failures.push(`${row.source_id} ${row.title}: public_url ${row.public_url} != ${expectedUrl}`);
      continue;
    }
    if (row.content_type !== NOTES_CONTENT_TYPE) {
      failures.push(`${row.source_id} ${row.title}: stored content_type ${row.content_type}`);
      continue;
    }
    const res = await handleNotesServe(new Request(expectedUrl, { method: "GET" }));
    const ct = res.headers.get("content-type");
    const body = new Uint8Array(await res.arrayBuffer());
    const sha = createHash("sha256").update(body).digest("hex");
    const magic = Buffer.from(body.subarray(0, 4)).toString("latin1");
    if (res.status !== 200) {
      failures.push(`${row.source_id} ${row.title}: HTTP ${res.status}`);
    } else if (ct !== NOTES_CONTENT_TYPE) {
      failures.push(`${row.source_id} ${row.title}: served content-type ${ct}`);
    } else if (magic !== "MThd") {
      failures.push(`${row.source_id} ${row.title}: body does not start with MThd (${JSON.stringify(magic)})`);
    } else if (sha !== row.sha256) {
      failures.push(`${row.source_id} ${row.title}: sha256 ${sha.slice(0, 12)} != stored ${row.sha256.slice(0, 12)}`);
    } else if (body.byteLength !== row.bytes) {
      failures.push(`${row.source_id} ${row.title}: ${body.byteLength} bytes != stored ${row.bytes}`);
    } else {
      ok += 1;
    }
  }

  console.log(`verified: ${ok}/${rows.length}`);
  for (const f of failures) console.log(`FAIL: ${f}`);
  if (failures.length > 0) process.exit(1);
  if (rows.length === 0) {
    console.error("nothing to verify — the ingest has not run");
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("verify failed:", err);
    process.exit(1);
  });
}
