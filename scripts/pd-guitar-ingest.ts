/**
 * pd-guitar-ingest — host the FREE guitar/lute public-domain score batch (Mutopia) and make
 * those pieces findable in FindPieceScreen.
 *
 * Owner 09-28: keyboardists and guitarists expect free music from a music app, so free
 * *compliant* content is the trust hook; the money paths stay affiliate/Pro/Family-Teacher.
 * `musicapp-update/src/services/sheetLicenseGate.ts` is the ONE gate for that content and
 * `pdGuitarCatalog.ts` is the audited 13-piece manifest (Mutopia, all "Public Domain",
 * LilyPond-typeset, sha256 + bytes + page count recorded per piece). This script is the
 * ingestion half of that pair: gate -> verify bytes -> R2 -> DB.
 *
 * Run (audit only — the default: gate + download + hash check, NO writes):
 *   cd /home/team/shared/site-fresh && set -a && . ./.env && set +a
 *   bun run scripts/pd-guitar-ingest.ts --out /tmp/pd-guitar-ledger.json
 *
 * Write the pieces the gate cleared (idempotent; re-runs are safe):
 *   ... bun run scripts/pd-guitar-ingest.ts --write --out /tmp/pd-guitar-ledger.json
 *
 * The gate + manifest live in the APP repo (one copy, no drift). This script resolves that
 * checkout via $NOTESNAP_APP_REPO, defaulting to the sibling `../musicapp-update`.
 *
 * Copyright/quality rule: a restrictive licence, a missing licence, an unverifiable composer,
 * an unprovable typeset, a non-guitar instrument or a hash that does not match the audited
 * bytes means NO row and NO R2 object. Exclusions are recorded with their reason in the ledger
 * — they are the point of the run, not a failure of it.
 *
 * Serving contract: the audited A4 PDF is stored at R2 key `sheets/<piece-id>.pdf`, which the
 * site serves at `https://site-notesnap.vercel.app/api/sheets/<piece-id>.pdf`
 * (src/services/sheet-handler.ts, GET/HEAD). pieces.sheet_music_url is always built by
 * `sheetUrlForPieceId()` — never hand-written, never a raw R2 URL.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// The app-repo gate + manifest (one source of truth)
// ---------------------------------------------------------------------------

interface GuitarPdPiece {
  slug: string;
  title: string;
  composer: string;
  catalog: string | null;
  style: string;
  difficulty: number;
  instrument: string;
  existingCatalogPiece: boolean;
  note: string;
  sourceInfoUrl: string;
  sourcePdfUrl: string;
  engravingSourceUrl: string;
  midiUrl: string;
  licenseLabel: string;
  licenseHref: string;
  typesetWith: string;
  sha256: string;
  bytes: number;
  pageCount: number;
}

interface GateDecision {
  slug: string;
  title: string;
  composer: string;
  included: boolean;
  verdict: string;
  composerDied: number | null;
  licenseEvidence: string[];
  reason: string;
}

interface GateModule {
  gateGuitarSheet(piece: GuitarPdPiece): GateDecision;
  sheetObjectKey(pieceId: string): string;
  sheetUrlForPieceId(pieceId: string): string;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_REPO =
  process.env.NOTESNAP_APP_REPO ?? resolve(join(SCRIPT_DIR, "..", ".."), "musicapp-update");

async function loadGate(): Promise<{ catalog: GuitarPdPiece[]; gate: GateModule }> {
  const catalogMod = (await import(join(APP_REPO, "src/services/pdGuitarCatalog.ts"))) as {
    PD_GUITAR_CATALOG: GuitarPdPiece[];
  };
  const gateMod = (await import(join(APP_REPO, "src/services/sheetLicenseGate.ts"))) as GateModule;
  if (!Array.isArray(catalogMod.PD_GUITAR_CATALOG) || catalogMod.PD_GUITAR_CATALOG.length === 0) {
    throw new Error(`no manifest entries from ${APP_REPO}/src/services/pdGuitarCatalog.ts`);
  }
  for (const fn of ["gateGuitarSheet", "sheetObjectKey", "sheetUrlForPieceId"] as const) {
    if (typeof (gateMod as unknown as Record<string, unknown>)[fn] !== "function") {
      throw new Error(`gate module is missing ${fn} (${APP_REPO})`);
    }
  }
  return { catalog: catalogMod.PD_GUITAR_CATALOG, gate: gateMod };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const value = (flag: string): string | null => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

const WRITE = has("--write");
const LEDGER_OUT = value("--out") ?? "/tmp/pd-guitar-ledger.json";

interface LedgerRow {
  slug: string;
  title: string;
  composer: string;
  mutopiaId: string | null;
  verdict: string;
  included: boolean;
  gateReason: string;
  licenseEvidence: string[];
  composerDied: number | null;
  action:
    | "inserted-piece"
    | "attached-to-existing-piece"
    | "aborted-gate-refused"
    | "aborted-integrity"
    | "dry-run";
  pieceId: string | null;
  r2Key: string | null;
  liveUrl: string | null;
  arrangementType: string;
  sha256: string;
  bytes: number;
  pages: number;
  uploadedBytes: number | null;
  uploadedSha256: string | null;
  sourceRowId: string | null;
  curationLogWritten: boolean;
  sheetMusicUrlWritten: string | null;
  note: string;
}

function mutopiaId(url: string): string | null {
  const m = String(url ?? "").match(/[?&]id=(\d+)/);
  return m ? m[1] : null;
}

/** The two-guitar engravings say so in the manifest; everything else is a solo guitar score. */
function arrangementTypeFor(piece: GuitarPdPiece): string {
  return /2\s+guitars?/i.test(piece.instrument)
    ? "2 guitars (Mutopia typeset)"
    : "guitar (Mutopia typeset)";
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

const BUCKET = process.env.R2_BUCKET_NAME || "notesnapscores";

/** Download the audited source PDF and prove it is byte-identical to the audit record. */
async function fetchAuditedPdf(piece: GuitarPdPiece): Promise<
  { ok: true; bytes: Uint8Array; sha256: string } | { ok: false; reason: string }
> {
  let res: Response;
  try {
    res = await fetch(piece.sourcePdfUrl, {
      headers: { "user-agent": "NoteSnap catalog curation (licence audit)" },
    });
  } catch (err) {
    return { ok: false, reason: `source fetch failed: ${String(err).slice(0, 120)}` };
  }
  if (!res.ok) return { ok: false, reason: `source returned HTTP ${res.status}` };
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== piece.sha256) {
    return { ok: false, reason: `sha256 mismatch: manifest ${piece.sha256}, downloaded ${sha256}` };
  }
  if (bytes.byteLength !== piece.bytes) {
    return { ok: false, reason: `byte size mismatch: manifest ${piece.bytes}, downloaded ${bytes.byteLength}` };
  }
  const head = Buffer.from(bytes.subarray(0, 4)).toString("latin1");
  if (head !== "%PDF") return { ok: false, reason: `not a PDF (starts with ${JSON.stringify(head)})` };
  return { ok: true, bytes, sha256 };
}

async function main(): Promise<void> {
  const { catalog, gate } = await loadGate();
  console.log(`manifest: ${catalog.length} pieces (app repo: ${APP_REPO})`);
  console.log(`mode: ${WRITE ? "WRITE" : "audit only (no writes)"}`);

  const sql = neon(process.env.DATABASE_URL!);
  const s3 = WRITE ? getR2() : null;
  if (WRITE && !s3) throw new Error("R2 env not configured (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");

  const ledger: LedgerRow[] = [];

  for (const piece of catalog) {
    const decision = gate.gateGuitarSheet(piece);
    const arrangementType = arrangementTypeFor(piece);
    const row: LedgerRow = {
      slug: piece.slug,
      title: piece.title,
      composer: piece.composer,
      mutopiaId: mutopiaId(piece.sourceInfoUrl),
      verdict: decision.verdict,
      included: decision.included,
      gateReason: decision.reason,
      licenseEvidence: decision.licenseEvidence,
      composerDied: decision.composerDied,
      action: decision.included ? "dry-run" : "aborted-gate-refused",
      pieceId: null,
      r2Key: null,
      liveUrl: null,
      arrangementType,
      sha256: piece.sha256,
      bytes: piece.bytes,
      pages: piece.pageCount,
      uploadedBytes: null,
      uploadedSha256: null,
      sourceRowId: null,
      curationLogWritten: false,
      sheetMusicUrlWritten: null,
      note: piece.note,
    };
    ledger.push(row);

    if (!decision.included) {
      console.log(`REFUSED | ${piece.title} | ${decision.verdict} | ${decision.reason}`);
      continue;
    }

    const pdf = await fetchAuditedPdf(piece);
    if (!pdf.ok) {
      row.action = "aborted-integrity";
      row.gateReason = `${decision.reason}; INTEGRITY: ${pdf.reason}`;
      console.log(`FAILED  | ${piece.title} | integrity | ${pdf.reason}`);
      continue;
    }
    console.log(`GATE OK | ${piece.title} | ${decision.verdict} | sha256+bytes match the audit`);

    if (!WRITE) continue;

    // --- 1. the piece row (attach, never duplicate) --------------------------
    const existing = (await sql`
      SELECT id, title, composer FROM pieces
      WHERE lower(title) = lower(${piece.title}) AND lower(composer) = lower(${piece.composer})
      ORDER BY created_at LIMIT 1
    `) as unknown as Array<{ id: string; title: string; composer: string }>;

    let pieceId: string;
    if (existing.length > 0) {
      pieceId = existing[0].id;
      row.action = "attached-to-existing-piece";
      // A pre-existing row keeps its own identity; only the public-domain flag is enforced.
      await sql`UPDATE pieces SET is_public_domain = true WHERE id = ${pieceId}::uuid`;
      console.log(`ATTACH  | ${piece.title} -> existing piece ${pieceId}`);
    } else {
      const inserted = (await sql`
        INSERT INTO pieces (title, composer, catalog, genre, difficulty, is_public_domain)
        VALUES (${piece.title}, ${piece.composer}, ${piece.catalog}, ${piece.style},
                ${piece.difficulty}, true)
        RETURNING id
      `) as unknown as Array<{ id: string }>;
      pieceId = inserted[0].id;
      row.action = "inserted-piece";
      console.log(`INSERT  | ${piece.title} -> new piece ${pieceId}`);
    }

    // --- 2. the hosted copy at sheets/<piece-id>.pdf -------------------------
    const key = gate.sheetObjectKey(pieceId);
    await s3!.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: pdf.bytes,
        ContentType: "application/pdf",
        ContentLength: pdf.bytes.byteLength,
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: { sha256: pdf.sha256, source: "mutopia" },
      }),
    );
    row.pieceId = pieceId;
    row.r2Key = key;
    row.liveUrl = gate.sheetUrlForPieceId(pieceId);
    row.uploadedBytes = pdf.bytes.byteLength;
    row.uploadedSha256 = pdf.sha256;
    console.log(`R2      | ${key} | ${pdf.bytes.byteLength} bytes`);

    // --- 3. sheet_music_sources row (the Mutopia convention) -----------------
    const existingSource = (await sql`
      SELECT id FROM sheet_music_sources
      WHERE piece_id = ${pieceId}::uuid
        AND source_platform = 'mutopia'
        AND source_url = ${piece.sourcePdfUrl}
    `) as unknown as Array<{ id: string }>;
    if (existingSource.length > 0) {
      row.sourceRowId = existingSource[0].id;
      console.log(`SKIP    | source row exists (${existingSource[0].id})`);
    } else {
      const sourceRow = (await sql`
        INSERT INTO sheet_music_sources
          (piece_id, source_platform, source_url, format, arrangement_type,
           rating, vote_count, download_count, source_trust, curation_score,
           is_primary, is_flagged, flag_reason)
        VALUES (${pieceId}::uuid, 'mutopia', ${piece.sourcePdfUrl}, 'pdf', ${arrangementType},
                0, 0, 0, 0.9, 0.9, true, false, ${`typeset licence: ${piece.licenseLabel}; Mutopia id ${mutopiaId(piece.sourceInfoUrl)}; sha256 ${pdf.sha256}; ${piece.pageCount} page(s); engraving ${piece.engravingSourceUrl}`})
        RETURNING id
      `) as unknown as Array<{ id: string }>;
      row.sourceRowId = sourceRow[0].id;
      console.log(`SOURCE  | ${sourceRow[0].id} | ${arrangementType} | ${piece.sourcePdfUrl}`);
    }

    // --- 4. curation_log (same shape as classtab-ingest.ts) ------------------
    await sql`
      INSERT INTO curation_log (piece_id, action, source_platform, details)
      VALUES (${pieceId}::uuid, 'catalog-add', 'mutopia',
              ${JSON.stringify({
                source: "scripts/pd-guitar-ingest.ts",
                url: piece.sourcePdfUrl,
                hosted_url: gate.sheetUrlForPieceId(pieceId),
                r2_key: key,
                arrangement_type: arrangementType,
                license_verdict: decision.verdict,
                license_evidence: decision.licenseEvidence,
                license_label: piece.licenseLabel,
                composer_died: decision.composerDied,
                gate_reason: decision.reason,
                typeset_with: piece.typesetWith,
                engraving_source: piece.engravingSourceUrl,
                mutopia_id: mutopiaId(piece.sourceInfoUrl),
                sha256: pdf.sha256,
                bytes: pdf.bytes.byteLength,
                pages: piece.pageCount,
              })})
    `;
    row.curationLogWritten = true;

    // --- 5. pieces.sheet_music_url (built by the gate's one builder) ---------
    const url = gate.sheetUrlForPieceId(pieceId);
    await sql`UPDATE pieces SET sheet_music_url = ${url} WHERE id = ${pieceId}::uuid`;
    row.sheetMusicUrlWritten = url;
    console.log(`URL     | ${url}`);
  }

  const included = ledger.filter((r) => r.included);
  const refused = ledger.filter((r) => !r.included);
  const written = ledger.filter((r) => r.action === "inserted-piece" || r.action === "attached-to-existing-piece");
  const report = {
    generatedAt: new Date().toISOString(),
    mode: WRITE ? "write" : "audit",
    appRepo: APP_REPO,
    manifestEntries: catalog.length,
    gateIncluded: included.length,
    gateRefused: refused.length,
    piecesWritten: written.length,
    rows: ledger,
  };
  writeFileSync(LEDGER_OUT, JSON.stringify(report, null, 1));

  console.log(
    `\nLEDGER: ${included.length} gate-cleared / ${refused.length} refused` +
      (WRITE ? `; ${written.length} pieces written` : "; audit only, nothing written"),
  );
  for (const r of refused) console.log(`  refused: ${r.title} — ${r.verdict} (${r.gateReason})`);
  console.log(`ledger -> ${LEDGER_OUT}`);

  if (WRITE) {
    const counts = (await sql`
      SELECT
        (SELECT count(*) FROM pieces WHERE sheet_music_url LIKE '%/api/sheets/%') AS hosted_pieces,
        (SELECT count(*) FROM pieces) AS total_pieces,
        (SELECT count(*) FROM sheet_music_sources WHERE source_platform = 'mutopia' AND format = 'pdf') AS mutopia_pdf_sources,
        (SELECT count(*) FROM sheet_music_sources WHERE arrangement_type LIKE '%Mutopia typeset%') AS typeset_arrangement_sources
    `) as unknown as Array<Record<string, string>>;
    console.log("DB now:", JSON.stringify(counts[0]));
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
