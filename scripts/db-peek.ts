#!/usr/bin/env bun
import { neon } from "@neondatabase/serverless";
const SQL = neon(process.env.DATABASE_URL!);
(async () => {
  const rows = await SQL`SELECT p.catalog, p.title, count(*) n FROM piece_landmarks l JOIN pieces p ON p.id=l.piece_id GROUP BY p.id, p.catalog, p.title ORDER BY n DESC LIMIT 12`;
  console.log("TOP ROW-COUNT PIECES:");
  for (const r of rows) console.log(r.n, "|", r.catalog, "|", r.title);
  const fe = await SQL`SELECT id, catalog, title FROM pieces WHERE catalog ILIKE ${"%WoO 59%"} OR title ILIKE ${"%F%r Elise%"}`;
  console.log("fur elise:", JSON.stringify(fe));
  const tr = await SQL`SELECT id, catalog, title FROM pieces WHERE catalog ILIKE ${"%Op. 15 No. 7%"}`;
  console.log("traumerei:", JSON.stringify(tr));
  const count = await SQL`SELECT count(*) n FROM pieces`;
  console.log("total pieces:", count[0].n);
})();