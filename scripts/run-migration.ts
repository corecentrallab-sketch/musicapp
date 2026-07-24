#!/usr/bin/env bun
/**
 * run-migration.ts — Execute a SQL migration file against the Neon database.
 * Usage: DATABASE_URL=... bun run scripts/run-migration.ts <migration-file.sql>
 */

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error("Usage: bun run scripts/run-migration.ts <migration-file.sql>");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(url);
const content = readFileSync(migrationFile, "utf-8");

// Parse SQL into individual statements by tracking statement boundaries.
// We strip comment lines and split on semicolons.
function splitSQL(raw: string): string[] {
  const statements: string[] = [];
  let current = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    // Skip comment-only lines and blank lines between statements
    if (trimmed.startsWith("--")) continue;

    if (trimmed === "") {
      // Blank line: if we're building a statement ending with ;, flush it
      if (current.trim().endsWith(";")) {
        statements.push(current.trim());
        current = "";
      }
      // Otherwise skip the blank (it's internal whitespace in a multi-line stmt)
      continue;
    }

    current += (current ? "\n" : "") + line;

    // If this line ends with semicolon, the statement is complete
    if (trimmed.endsWith(";")) {
      statements.push(current.trim());
      current = "";
    }
  }

  // Flush remaining
  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

const statements = splitSQL(content);
console.log(`Found ${statements.length} statements in ${migrationFile}\n`);

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const firstLine = stmt.split("\n")[0];
  const preview = firstLine.length > 78 ? firstLine.substring(0, 75) + "..." : firstLine;

  try {
    // neon().query(queryText: string, values?: any[])
    await (sql as any).query(stmt);
    console.log(`  [${String(i + 1).padStart(2)}] OK  ${preview}`);
  } catch (err: any) {
    const msg: string = err.message || String(err);
    if (msg.includes("already exists") || msg.includes("duplicate") || msg.includes("Duplicate")) {
      console.log(`  [${String(i + 1).padStart(2)}] SKIP ${preview}`);
    } else {
      console.error(`  [${String(i + 1).padStart(2)}] ERR  ${preview}`);
      console.error(`       ${msg.substring(0, 120)}`);
    }
  }
}

console.log("\nMigration complete.");

// Verify
const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY table_name
`;
console.log("Tables in public schema:");
for (const t of tables as any[]) {
  console.log(`  - ${t.table_name}`);
}
