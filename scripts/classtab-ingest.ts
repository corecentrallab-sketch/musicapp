/**
 * classtab.org guitar-TAB crawl -> sheet_music_sources (arrangement_type='guitar').
 *
 * Owner 09-24: the site promises "guitar tabs" and the catalog has ZERO guitar
 * sources. This script crawls classtab.org for catalog pieces and adds rows ONLY
 * for tabs that pass the copyright gate in `~/services/classtab-crawler.ts`.
 *
 * Run (audit, no writes — the default):
 *   DATABASE_URL=... bun run scripts/classtab-ingest.ts --out /tmp/classtab-ledger.json
 *
 * Write the rows the gate cleared (idempotent; re-runs are safe):
 *   DATABASE_URL=... bun run scripts/classtab-ingest.ts --write --ledger /tmp/classtab-ledger.json
 *
 * Offline re-runs (evidence preservation — the gate is pure):
 *   ... --index-file /path/index_old.htm --tab-dir /path/classtab
 *
 * Copyright rule: a restrictive licence, a missing licence, or an unverifiable
 * composer PD status means NO row. Exclusions are recorded with their reason in
 * the ledger; they are the point of the run, not a failure of it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import {
  CLASSTAB_BASE_URL,
  CLASSTAB_INDEX_URL,
  type ClasstabEntry,
  type CatalogPieceInput,
  type GateDecision,
  gateTabForCatalog,
  matchCatalogToClasstab,
  parseClasstabIndex,
} from "../src/services/classtab-crawler";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const value = (flag: string): string | null => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

const WRITE = has("--write");
const LEDGER_IN = value("--ledger");
const LEDGER_OUT = value("--out") ?? "/tmp/classtab-ledger.json";
const INDEX_FILE = value("--index-file");
const TAB_DIR = value("--tab-dir");
const TARGETS_FILE = value("--targets");
const MAX_TABS = Number(value("--limit") ?? "60");

interface Target {
  pieceId?: string;
  title?: string;
  href?: string;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "NoteSnap catalog curation (licence audit)" },
    });
    if (!res.ok) return null;
    const body = await res.text();
    // classtab serves a 200 custom 404 page for missing files — treat as missing.
    return /custom 404 error page/i.test(body) ? null : body;
  } catch {
    return null;
  }
}

function tabFromDir(href: string): string | null {
  if (!TAB_DIR) return null;
  try {
    return readFileSync(`${TAB_DIR}/${href}`, "utf8");
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  // --- 1. ledger re-write mode (no crawl, DB only) --------------------------
  if (WRITE && LEDGER_IN) {
    const ledger = JSON.parse(readFileSync(LEDGER_IN, "utf8")) as {
      included: GateDecision[];
    };
    await writeRows(ledger.included ?? []);
    return;
  }

  // --- 2. index ------------------------------------------------------------
  const indexHtml = INDEX_FILE
    ? readFileSync(INDEX_FILE, "utf8")
    : await fetchText(CLASSTAB_INDEX_URL);
  if (!indexHtml) throw new Error(`could not load classtab index (${CLASSTAB_INDEX_URL})`);
  const entries = parseClasstabIndex(indexHtml);
  console.log(`classtab index entries: ${entries.length}`);

  // --- 3. target catalog pieces -------------------------------------------
  const sql = neon(process.env.DATABASE_URL!);
  const pieces = (await sql`
    SELECT id, title, composer, catalog FROM pieces
    WHERE is_public_domain = true ORDER BY composer NULLS LAST, title
  `) as unknown as CatalogPieceInput[];
  console.log(`catalog pieces (public domain): ${pieces.length}`);

  const targets: Target[] = TARGETS_FILE
    ? (JSON.parse(readFileSync(TARGETS_FILE, "utf8")) as Target[])
    : [];
  const byHref = new Map<string, ClasstabEntry>(entries.map((e) => [e.href, e]));

  let matches;
  if (targets.length > 0) {
    // Explicit target list: each entry names a catalog piece and/or a classtab URL.
    matches = [];
    for (const t of targets) {
      const piece = t.pieceId
        ? pieces.find((p) => p.id === t.pieceId)
        : pieces.find((p) => p.title.toLowerCase() === (t.title ?? "").toLowerCase());
      if (!piece) {
        console.warn(`target not found in catalog: ${t.pieceId ?? t.title}`);
        continue;
      }
      const entry = t.href
        ? byHref.get(t.href) ?? {
            href: t.href,
            label: piece.title,
            url: `${CLASSTAB_BASE_URL}${t.href}`,
            midiHref: null,
            filePrefix: t.href.split("_")[0],
          }
        : matchCatalogToClasstab([piece], entries)[0]?.entry;
      if (!entry) {
        console.warn(`no classtab entry for ${piece.title}`);
        continue;
      }
      matches.push({
        pieceId: piece.id,
        pieceTitle: piece.title,
        composer: piece.composer,
        entry,
        score: t.href ? 1 : 0.5,
        reason: t.href ? "explicit target href" : "best title match",
      });
    }
  } else {
    matches = matchCatalogToClasstab(pieces, entries);
  }
  console.log(`candidate piece<->tab pairs: ${matches.length}`);

  // --- 4. fetch + gate -----------------------------------------------------
  const decisions: GateDecision[] = [];
  const seenHrefs = new Set<string>();
  for (const m of matches.slice(0, MAX_TABS)) {
    const key = `${m.pieceId}|${m.entry.href}`;
    if (seenHrefs.has(key)) continue;
    seenHrefs.add(key);
    const body = tabFromDir(m.entry.href) ?? (await fetchText(m.entry.url));
    const d = gateTabForCatalog(m, body);
    decisions.push(d);
    console.log(
      `${d.included ? "INCLUDE" : "EXCLUDE"} | ${d.pieceTitle} | ${d.sourceUrl} | ${d.verdict} | ${d.reason}`,
    );
    await new Promise((r) => setTimeout(r, 150));
  }

  const included = decisions.filter((d) => d.included);
  const excluded = decisions.filter((d) => !d.included);
  const ledger = {
    generatedAt: new Date().toISOString(),
    indexEntries: entries.length,
    catalogPieces: pieces.length,
    pairsConsidered: decisions.length,
    included,
    excluded,
  };
  writeFileSync(LEDGER_OUT, JSON.stringify(ledger, null, 1));
  console.log(
    `\nLEDGER: ${included.length} included / ${excluded.length} excluded -> ${LEDGER_OUT}`,
  );
  const byVerdict = new Map<string, number>();
  for (const d of excluded) byVerdict.set(d.verdict, (byVerdict.get(d.verdict) ?? 0) + 1);
  console.log("exclusion verdicts:", JSON.stringify([...byVerdict.entries()]));

  // --- 5. optional write ---------------------------------------------------
  if (WRITE) await writeRows(included);
}

async function writeRows(included: GateDecision[]): Promise<void> {
  const sql = neon(process.env.DATABASE_URL!);
  let inserted = 0;
  for (const d of included) {
    if (!d.row) continue;
    const existing = (await sql`
      SELECT id FROM sheet_music_sources
      WHERE piece_id = ${d.row.pieceId}::uuid
        AND source_platform = 'classtab'
        AND source_url = ${d.row.sourceUrl}
    `) as unknown as Array<{ id: string }>;
    if (existing.length > 0) {
      console.log(`SKIP (row exists): ${d.pieceTitle} <- ${d.row.sourceUrl}`);
      continue;
    }
    const rows = (await sql`
      INSERT INTO sheet_music_sources
        (piece_id, source_platform, source_url, format, arrangement_type,
         rating, vote_count, download_count, source_trust, curation_score,
         is_primary, is_flagged)
      VALUES (${d.row.pieceId}::uuid, ${d.row.sourcePlatform}, ${d.row.sourceUrl},
              ${d.row.format}, ${d.row.arrangementType}, ${d.row.rating},
              ${d.row.voteCount}, ${d.row.downloadCount}, ${d.row.sourceTrust},
              ${d.row.curationScore}, ${d.row.isPrimary}, ${d.row.isFlagged})
      RETURNING id
    `) as unknown as Array<{ id: string }>;
    await sql`
      INSERT INTO curation_log (piece_id, action, source_platform, details)
      VALUES (${d.row.pieceId}::uuid, 'catalog-add', 'classtab',
              ${JSON.stringify({
                source: "scripts/classtab-ingest.ts",
                url: d.row.sourceUrl,
                arrangement_type: d.row.arrangementType,
                license_verdict: d.verdict,
                license_evidence: d.licenseEvidence,
                composer_died: d.composerDied,
              })})
    `;
    console.log(`INSERTED ${rows[0].id} | ${d.pieceTitle} <- ${d.row.sourceUrl}`);
    inserted++;
  }
  const counts = (await sql`
    SELECT
      (SELECT count(*) FROM sheet_music_sources) AS total_sources,
      (SELECT count(*) FROM sheet_music_sources WHERE source_platform = 'classtab') AS classtab_sources,
      (SELECT count(*) FROM sheet_music_sources WHERE arrangement_type = 'guitar') AS guitar_sources
  `) as unknown as Array<Record<string, string>>;
  console.log(`inserted ${inserted}; DB now:`, JSON.stringify(counts[0]));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
