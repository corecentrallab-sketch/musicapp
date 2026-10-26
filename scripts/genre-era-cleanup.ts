#!/usr/bin/env bun
/**
 * Genre era cleanup — v45 slice 3a (owner all-genres scope 2026-10-26).
 *
 * WHY
 * `pieces.genre` holds the piece's ERA (Renaissance / Baroque / Classical /
 * Romantic / Impressionist / Modern). The Discover surface groups those eras
 * into the five public style families in the APP, so the database only has to
 * be truthful about eras — but it was not: it carried one merged bucket
 * ('Classical/Romantic', 64 rows) plus three values that are not genres at all
 * but fragments of a TITLE ('Joy of Man's Desiring', "Maman' (Twinkle
 * Twinkle)", 'Fugue et Variation'). Those came from an early ingestion that
 * mis-slotted the title column into the genre column. A client-side family
 * taxonomy cannot map a junk label, so the junk has to go before the genre
 * surface ships.
 *
 * WHAT IT DOES (idempotent — re-running on a clean database changes nothing)
 *   1. merges 'Classical/Romantic' → 'Classical' (the owner's approved merge;
 *      the bucket only ever meant "Beethoven and the guitar/study repertoire
 *      that sits on the Classical/Romantic fence");
 *   2. recategorises each junk value to the era of the piece it sits on, from
 *      the explicit DECISIONS table below — every decision is VERIFIED against
 *      the actual row (title + composer) before it is written, so a row that
 *      does not match what the table says aborts the run instead of being
 *      silently re-labelled;
 *   3. leaves NULL genre values alone (there are none today — the run reports
 *      it if that changes);
 *   4. proves the invariant `count(*) == sum(count(*) by genre)` before AND
 *      after, so a merge can never lose or invent a row.
 *
 * SAFETY
 * Dry run by default: it prints the before state, every planned change and the
 * projected after state, and writes nothing. `--apply` writes the whole cleanup
 * as ONE transaction (a partial cleanup cannot happen), but only AFTER dumping
 * every affected row to a backup file, which is the undo: each backup row is
 * `{id, title, composer, genre}`, so
 *   UPDATE pieces SET genre = '<backup.genre>' WHERE id = '<backup.id>';
 * restores it exactly.
 *
 * USAGE
 *   bun scripts/genre-era-cleanup.ts                  # dry run (safe)
 *   bun scripts/genre-era-cleanup.ts --apply \
 *     --backup=/home/team/shared/eng-v45-evidence/genre/genre-backup.json
 */

import { neon } from "@neondatabase/serverless";
import { writeFileSync } from "node:fs";

/** The era buckets the database is allowed to hold. Anything else is junk. */
const ERAS = [
  "Renaissance",
  "Baroque",
  "Classical",
  "Romantic",
  "Impressionist",
  "Modern",
] as const;

/** The merged bucket and where it goes. */
const MERGE_FROM = "Classical/Romantic";
const MERGE_TO = "Classical";

/**
 * Junk value → era, with the evidence that makes the mapping safe.
 *
 * Each entry names the piece the junk value was found on. The run refuses to
 * touch a row whose title/composer do not contain `expectTitle` / `expectComposer`
 * (case-insensitive), because guessing an era for an unknown row is exactly the
 * kind of silent data invention this repo forbids.
 */
interface JunkDecision {
  junk: string;
  era: (typeof ERAS)[number];
  expectTitle: string;
  expectComposer: string;
  why: string;
}

const DECISIONS: JunkDecision[] = [
  {
    junk: "Joy of Man's Desiring",
    era: "Baroque",
    expectTitle: "Jesu",
    expectComposer: "Bach",
    why: "The row is Bach's 'Jesu, Joy of Man's Desiring' (BWV 147, chorale from cantata Herz und Mund und Tat und Leben, 1723) — the junk value is the title tail. Bach is Baroque.",
  },
  {
    junk: "Maman' (Twinkle Twinkle)",
    era: "Classical",
    expectTitle: "Ah vous dirai-je",
    expectComposer: "Mozart",
    why: "The row is Mozart's Twelve Variations on 'Ah vous dirai-je, Maman' K. 265 (1781) — the junk value is the tune's English nickname. Mozart is Classical.",
  },
  {
    junk: "Fugue et Variation",
    era: "Romantic",
    expectTitle: "Pr",
    expectComposer: "Franck",
    why: "The row is the 'Prélude' of César Franck's Prélude, Fugue et Variation Op. 18 (1860-62) — the junk value is the movement pair from the title. Franck (1822-1890) is Romantic. (The delegated brief guessed Mendelssohn; the actual row is Franck — same era, and the row is what is being changed.)",
  },
];

interface CountRow {
  genre: string | null;
  n: number;
}
interface PieceRowLite {
  id: string;
  title: string;
  composer: string;
  genre: string | null;
}

function fmt(counts: CountRow[], total: number): string {
  const sum = counts.reduce((a, c) => a + c.n, 0);
  const width = Math.max(...counts.map((c) => c.n)).toString().length;
  const lines = counts.map((c) => `  ${c.n.toString().padStart(width)}  ${c.genre ?? "(NULL)"}`);
  lines.push(`  ${"—".repeat(width)}`);
  lines.push(`  ${sum.toString().padStart(width)}  TOTAL (pieces count(*) = ${total})`);
  lines.push(sum === total ? "  INVARIANT OK: sum by genre == count(*) of pieces" : "  INVARIANT BROKEN");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const backupArg = args.find((a) => a.startsWith("--backup="));
  const backupPath =
    backupArg?.slice("--backup=".length) ?? `genre-era-backup-${new Date().toISOString()}.json`;

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (the site repo reads it from .env).");
    process.exit(2);
  }
  const sql = neon(url);

  // ---- BEFORE ------------------------------------------------------------
  const totalRows = (await sql`SELECT count(*)::int AS n FROM pieces`) as unknown as Array<{ n: number }>;
  const total = totalRows[0]?.n ?? 0;
  const before = (await sql`
    SELECT genre, count(*)::int AS n FROM pieces GROUP BY genre ORDER BY n DESC, genre
  `) as unknown as CountRow[];
  console.log(`\n=== BEFORE (${apply ? "APPLY" : "DRY RUN"}) ===`);
  console.log(fmt(before, total));

  const known = new Set<string>([...ERAS, MERGE_FROM]);
  const junkSeen = before
    .map((c) => c.genre)
    .filter((g): g is string => g !== null && !known.has(g));
  const nullCount = before.find((c) => c.genre === null)?.n ?? 0;
  console.log(`\nNULL genre rows: ${nullCount} (left as NULL by design)`);
  console.log(`Junk values found: ${junkSeen.length ? junkSeen.join(" | ") : "(none)"}`);

  const decided = DECISIONS.filter((d) => junkSeen.includes(d.junk));
  const undecided = junkSeen.filter((j) => !DECISIONS.some((d) => d.junk === j));
  if (undecided.length) {
    console.error(
      `\nABORT: undecided junk genre value(s): ${undecided.join(" | ")}. ` +
        `Add a verified DECISIONS entry for each (era + expected title/composer) — refusing to guess.`,
    );
    process.exit(3);
  }

  // ---- VERIFY every decision against the real rows ------------------------
  console.log("\n=== JUNK RECATEGORISATION (verified against the rows) ===");
  const planned: Array<{ junk: string; era: string; rows: PieceRowLite[] }> = [];
  for (const d of decided) {
    const rows = (await sql`
      SELECT id, title, composer, genre FROM pieces WHERE genre = ${d.junk} ORDER BY title
    `) as unknown as PieceRowLite[];
    if (rows.length === 0) {
      console.log(`  ${d.junk}: already clean (0 rows)`);
      continue;
    }
    const mismatch = rows.filter(
      (r) =>
        !r.title.toLowerCase().includes(d.expectTitle.toLowerCase()) ||
        !r.composer.toLowerCase().includes(d.expectComposer.toLowerCase()),
    );
    if (mismatch.length) {
      console.error(
        `  ABORT: '${d.junk}' now carries ${mismatch.length} row(s) that are NOT the expected piece ` +
          `(expected title~"${d.expectTitle}", composer~"${d.expectComposer}"): ` +
          mismatch.map((r) => `"${r.title}" / ${r.composer}`).join("; "),
      );
      process.exit(4);
    }
    for (const r of rows) {
      console.log(`  ${r.genre}  ->  ${d.era}   |  "${r.title}" — ${r.composer}`);
      console.log(`      why: ${d.why}`);
    }
    planned.push({ junk: d.junk, era: d.era, rows });
  }

  const mergeRows = (await sql`
    SELECT id, title, composer, genre FROM pieces WHERE genre = ${MERGE_FROM} ORDER BY title
  `) as unknown as PieceRowLite[];
  if (mergeRows.length) {
    console.log(`  ${MERGE_FROM}  ->  ${MERGE_TO}   |  ${mergeRows.length} row(s)`);
  } else {
    console.log(`  ${MERGE_FROM}: already clean (0 rows)`);
  }

  // ---- PROJECTED AFTER ----------------------------------------------------
  const projected = new Map<string, number>();
  for (const c of before) if (c.genre !== null) projected.set(c.genre, c.n);
  const merged = projected.get(MERGE_FROM) ?? 0;
  if (merged) {
    projected.delete(MERGE_FROM);
    projected.set(MERGE_TO, (projected.get(MERGE_TO) ?? 0) + merged);
  }
  for (const p of planned) {
    const n = projected.get(p.junk) ?? 0;
    projected.delete(p.junk);
    projected.set(p.era, (projected.get(p.era) ?? 0) + Math.min(n, p.rows.length));
  }
  const projectedRows: CountRow[] = [...projected.entries()]
    .map(([genre, n]) => ({ genre, n }))
    .sort((a, b) => b.n - a.n || a.genre.localeCompare(b.genre));
  if (nullCount) projectedRows.push({ genre: null, n: nullCount });
  console.log("\n=== PROJECTED AFTER (computed, no writes yet) ===");
  console.log(fmt(projectedRows, total));

  const nothingToDo = mergeRows.length === 0 && planned.length === 0;
  if (nothingToDo) {
    console.log("\nNothing to do — the genre column is already in its canonical shape.");
    return;
  }
  if (!apply) {
    console.log("\nDRY RUN — no writes. Re-run with --apply to perform the cleanup.");
    return;
  }

  // ---- BACKUP (the undo) --------------------------------------------------
  const affected = [...mergeRows, ...planned.flatMap((p) => p.rows)];
  const backup = {
    takenAt: new Date().toISOString(),
    table: "pieces",
    reason: "v45 slice 3a genre era cleanup (merge Classical/Romantic, recategorise 3 junk values)",
    totalPiecesBefore: total,
    beforeCounts: before,
    rows: affected,
  };
  writeFileSync(backupPath, JSON.stringify(backup, null, 2) + "\n");
  console.log(`\nBACKUP written: ${backupPath} (${affected.length} rows)`);

  // ---- APPLY (one transaction) -------------------------------------------
  const stmts = [
    sql`UPDATE pieces SET genre = ${MERGE_TO} WHERE genre = ${MERGE_FROM} RETURNING id`,
    ...planned.map((p) => sql`UPDATE pieces SET genre = ${p.era} WHERE genre = ${p.junk} RETURNING id`),
  ];
  const results = (await sql.transaction(stmts)) as unknown as Array<Array<{ id: string }>>;
  console.log("\n=== APPLIED (single transaction) ===");
  console.log(`  ${MERGE_FROM} -> ${MERGE_TO}: ${results[0].length} row(s)`);
  planned.forEach((p, i) => console.log(`  ${p.junk} -> ${p.era}: ${results[i + 1].length} row(s)`));

  // ---- AFTER --------------------------------------------------------------
  const totalAfterRows = (await sql`SELECT count(*)::int AS n FROM pieces`) as unknown as Array<{ n: number }>;
  const totalAfter = totalAfterRows[0]?.n ?? 0;
  const after = (await sql`
    SELECT genre, count(*)::int AS n FROM pieces GROUP BY genre ORDER BY n DESC, genre
  `) as unknown as CountRow[];
  console.log("\n=== AFTER ===");
  console.log(fmt(after, totalAfter));

  const sumBefore = before.reduce((a, c) => a + c.n, 0);
  const sumAfter = after.reduce((a, c) => a + c.n, 0);
  const leftoverJunk = after
    .map((c) => c.genre)
    .filter((g): g is string => g !== null && !ERAS.includes(g as (typeof ERAS)[number]));
  console.log(
    `\nINVARIANT: pieces ${total} -> ${totalAfter} | sum(genre) ${sumBefore} -> ${sumAfter} | ` +
      `${total === totalAfter && sumAfter === totalAfter ? "OK" : "BROKEN"}`,
  );
  console.log(`Leftover non-era values: ${leftoverJunk.length ? leftoverJunk.join(" | ") : "(none)"}`);
  if (total !== totalAfter || sumAfter !== totalAfter || leftoverJunk.length) process.exit(5);
}

await main();
