/**
 * Mutopia guitar-family INVENTORY sweep — the artefact every later stage reads.
 *
 * Why a sweep at all. Mutopia's advanced search posts to `cgibin/make-table.cgi` and its result
 * set is HARD-CAPPED AT 10 ROWS with NO PAGINATION: the form carries only `searchingfor`,
 * `Composer`, `Instrument`, `Style`, `solo`, `recent`, `timelength`, `timeunit`, `lilyv`,
 * `lilyversion`, `preview`, so `start`/`offset`/`page` do not exist. A naive
 * `?Instrument=Guitar` therefore *looks* like "there are 10 guitar pieces" when there are 163.
 * The only way to see the whole catalogue is to partition it: query every composer in the
 * dropdown against every fretted instrument, then re-query any (composer, instrument) pair that
 * came back full (10 rows) with a token sweep, and union the results by `piece-info.cgi?id`.
 *
 * Coverage caveat, stated plainly: the count is a LOWER BOUND. A composer with more than 10
 * pieces matching *every* token would still hide rows. None did in the 2026-11-04 run (7 pairs
 * truncated: Sor, Giuliani, Carcassi, Aguado, Horetzky, Kníže, Matiegka).
 *
 * Output: `scripts/data/mutopia-guitar-inventory.json` — checked in, because it is the evidence
 * the licence gate is argued from. Each row carries the licence text Mutopia prints on the row
 * itself, the composer's life dates as printed, and the `.ly` / `.mid` URLs. Nothing is inferred.
 *
 * Run (about a minute, ~1,320 requests, result tables only — no per-piece page fetches):
 *   cd /home/team/shared/site-fresh && bun run scripts/mutopia-guitar-sweep.ts
 * Options:  --instruments Guitar,Lute,Mandolin   --out <path>   --concurrency 12
 *
 * This script only READS. It decides nothing about what may be ingested — that is
 * `src/services/pd-notes-gate.ts`, which reads this file.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MutopiaRow } from "../src/services/pd-notes-gate";

const BASE = "https://www.mutopiaproject.org";
const SEARCH = `${BASE}/cgibin/make-table.cgi`;
const ADVSEARCH = `${BASE}/advsearch.html`;
const UA = "NoteSnap-catalog-curation/1.0 (licence audit; result tables only)";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const value = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const INSTRUMENTS = value("--instruments", "Guitar,Lute,Mandolin").split(",");
const OUT = value("--out", join(SCRIPT_DIR, "data", "mutopia-guitar-inventory.json"));
const CONCURRENCY = Number(value("--concurrency", "12"));

/** Refinement tokens for (composer, instrument) pairs whose result set hit the 10-row cap. */
const TOKENS = [
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  ..."0123456789".split(""),
  "op.",
  "no.",
  "guitar",
  "lute",
  "etude",
  "sonata",
  "walzer",
  "variations",
  "piece",
  "air",
  "song",
];

/** Decode the handful of entities Mutopia emits (notably `&nbsp;` for an empty cell). */
export function decodeEntities(input: string): string {
  return String(input ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

async function get(url: string, attempts = 3): Promise<string> {
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = String(err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`GET ${url} failed: ${lastErr}`);
}

/** The composer dropdown on advsearch.html: [value, label] pairs (328 in the 2026-11-04 run). */
export function parseComposers(html: string): Array<[string, string]> {
  const start = html.indexOf('id="adv-composer-sel"');
  if (start < 0) throw new Error("composer select not found in advsearch.html");
  const end = html.indexOf("</select>", start);
  const segment = html.slice(start, end);
  const out: Array<[string, string]> = [];
  const re = /<option value='([^']*)'>([^<]*)<\/option>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment))) out.push([decodeEntities(m[1]), decodeEntities(m[2])]);
  return out;
}

const CELL = /<td[^>]*>([\s\S]*?)<\/td>/g;

/**
 * Parse every result table on a search-result page.
 *
 * Column order on the live page: title, composer, opus, (links), instrument, year, style. The
 * licence is a `legal.html#<key>` anchor inside the block and the file links are `.ly` / `.mid`
 * hrefs. Anything that does not look like a result row is dropped rather than guessed at.
 */
export function parseResultRows(html: string): MutopiaRow[] {
  const rows: MutopiaRow[] = [];
  const tableRe = /<table class="table-bordered result-table">([\s\S]*?)<\/table>/g;
  let block: RegExpExecArray | null;
  while ((block = tableRe.exec(html))) {
    const inner = block[1];
    const cells: string[] = [];
    CELL.lastIndex = 0;
    let c: RegExpExecArray | null;
    while ((c = CELL.exec(inner))) cells.push(decodeEntities(c[1].replace(/<[^>]+>/g, " ")));
    if (cells.length < 20) continue;
    const idMatch = inner.match(/piece-info\.cgi\?id=(\d+)/);
    if (!idMatch) continue;
    const lic = inner.match(/legal\.html#(\w+)"[^>]*>([^<]*)</);
    const mid = inner.match(/href="([^"]+\.mid)"/);
    const ly = inner.match(/href="([^"]+\.ly)"/);
    const instrument = cells[4] ?? "";
    if (!/^for\s/i.test(instrument)) continue; // not the shape we know → do not guess
    rows.push({
      id: Number(idMatch[1]),
      title: cells[0] ?? "",
      composer: cells[1] ?? "",
      opus: cells[2] ?? "",
      instrument,
      year: cells[5] ?? "",
      style: cells[6] ?? "",
      lic_key: lic ? lic[1] : "",
      lic_text: lic ? decodeEntities(lic[2]) : "",
      mid: mid ? mid[1] : "",
      ly: ly ? ly[1] : "",
    });
  }
  return rows;
}

function searchUrl(composer: string, instrument: string, token = ""): string {
  const p = new URLSearchParams({
    searchingfor: token,
    Composer: composer,
    Instrument: instrument,
  });
  return `${SEARCH}?${p.toString()}`;
}

/** Run `jobs` with at most `limit` in flight; returns results in completion order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const composers = parseComposers(await get(ADVSEARCH));
  console.log(`composers: ${composers.length} | instruments: ${INSTRUMENTS.join(", ")}`);

  const found = new Map<number, MutopiaRow>();
  const truncated: Array<[string, string]> = [];
  const errors: string[] = [];

  const jobs = INSTRUMENTS.flatMap((inst) => composers.map(([comp]) => ({ comp, inst })));
  await pool(jobs, CONCURRENCY, async ({ comp, inst }) => {
    try {
      const rows = parseResultRows(await get(searchUrl(comp, inst)));
      if (rows.length >= 10) truncated.push([comp, inst]);
      for (const r of rows) found.set(r.id, r);
    } catch (err) {
      errors.push(`${comp} / ${inst}: ${String(err).slice(0, 120)}`);
    }
  });

  // Refine the pairs that hit the cap: one extra query per token, unioned by id.
  const refine = truncated.flatMap(([comp, inst]) => TOKENS.map((tok) => ({ comp, inst, tok })));
  console.log(`truncated pairs: ${truncated.length} → ${refine.length} refinement queries`);
  await pool(refine, CONCURRENCY, async ({ comp, inst, tok }) => {
    try {
      for (const r of parseResultRows(await get(searchUrl(comp, inst, tok)))) found.set(r.id, r);
    } catch (err) {
      errors.push(`${comp} / ${inst} / ${tok}: ${String(err).slice(0, 120)}`);
    }
  });

  const rows = [...found.values()].sort((a, b) => a.id - b.id);
  const byLicence: Record<string, number> = {};
  for (const r of rows) byLicence[r.lic_text || "(none)"] = (byLicence[r.lic_text || "(none)"] ?? 0) + 1;

  const payload = {
    generatedAt: new Date().toISOString(),
    source: SEARCH,
    method:
      "advanced search: every composer × {Guitar,Lute,Mandolin}; pairs capped at 10 rows refined " +
      "by a 48-token sweep; unioned by piece-info.cgi?id",
    composersQueried: composers.length,
    instruments: INSTRUMENTS,
    baseQueries: jobs.length,
    refinementQueries: refine.length,
    truncatedPairs: truncated.map(([c, i]) => `${c} / ${i}`),
    errors,
    uniqueEntries: rows.length,
    byLicence,
    rows,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 1));

  console.log(
    `unique entries: ${rows.length} | errors: ${errors.length} | ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  console.log(`licences: ${JSON.stringify(byLicence)}`);
  console.log(`inventory -> ${OUT}`);
  if (errors.length > 0) {
    console.error(`WARNING: ${errors.length} failed queries — the inventory is incomplete`);
    for (const e of errors.slice(0, 5)) console.error(`  ${e}`);
    process.exitCode = 2;
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("sweep failed:", err);
    process.exit(1);
  });
}
