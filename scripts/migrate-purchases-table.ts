/**
 * Create the `purchases` table — one row per PAID one-time Stripe purchase
 * (2026-11-03). This is the table that makes a real $4.99 / $9.99 / $39.99
 * purchase unlock Pro.
 *
 * Why a script and not a request-time migration: the handler must never issue
 * DDL on a user request (the same rule `scripts/migrate-events-table.ts` and
 * `scripts/enable-unaccent.ts` follow). This is the repo's migration convention
 * — a small idempotent `scripts/*.ts` that runs against whatever `DATABASE_URL`
 * is in `.env`/the environment. The same DDL is recorded in
 * `src/db/migrations/007_purchases.sql`.
 *
 * Run it (idempotent — safe to re-run, safe on a restored database):
 *
 *   cd /home/team/shared/site-fresh && bun scripts/migrate-purchases-table.ts
 *
 * It prints the table's real column list and indexes afterwards, so the run is
 * its own evidence that the table exists. Exit code 1 if anything is missing.
 *
 * THE ONE RULE THIS TABLE ENFORCES: `stripe_session_id` is UNIQUE. Stripe
 * retries webhook deliveries, and the webhook inserts with
 * ON CONFLICT (stripe_session_id) DO NOTHING — so idempotency is the database's
 * decision, never a read-then-write race in the handler.
 *
 * WHAT THIS TABLE MAY NEVER HOLD: no email, no person name, no phone, no
 * address, no card data, no IP. The only identity is the app's anonymous
 * per-install device id; the money columns come straight from Stripe.
 */
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — nothing to do.");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

/**
 * Statements run ONE AT A TIME: the Neon HTTP driver sends a single query per
 * request, so a multi-statement string is not portable across drivers.
 * Every statement is `IF NOT EXISTS`, so the whole script is idempotent.
 */
const STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "table purchases",
    sql: `CREATE TABLE IF NOT EXISTS purchases (
      id bigserial PRIMARY KEY,
      device_id text NOT NULL,
      stripe_session_id text NOT NULL UNIQUE,
      stripe_payment_intent_id text,
      stripe_customer_id text,
      price_id text,
      plan text,
      amount_total integer,
      currency text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
  },
  {
    label: "index purchases (device_id, created_at)",
    sql: `CREATE INDEX IF NOT EXISTS idx_purchases_device_id_created_at
            ON purchases (device_id, created_at DESC)`,
  },
  {
    // Carries the entitlement + idempotency rule into the database itself,
    // where a future reader (or a future migration author) will see it.
    label: "comment on purchases",
    sql: `COMMENT ON TABLE purchases IS
      'Paid one-time Stripe purchases (AUD, 2026-11). Permanent entitlement: a row means pro, forever. Idempotent by stripe_session_id UNIQUE. No PII — the device id is a random per-install UUID.'`,
  },
];

for (const statement of STATEMENTS) {
  console.log(`applying: ${statement.label}`);
  await sql.query(statement.sql);
}

const columns = (await sql.query(
  `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'purchases'
    ORDER BY ordinal_position`,
)) as unknown as Array<{
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}>;

const indexes = (await sql.query(
  `SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'purchases'
    ORDER BY indexname`,
)) as unknown as Array<{ indexname: string; indexdef: string }>;

console.log("\ninformation_schema.columns (public.purchases):");
for (const c of columns) {
  console.log(
    `  ${c.column_name.padEnd(24)} ${c.data_type.padEnd(26)} null=${c.is_nullable} default=${c.column_default ?? "—"}`,
  );
}
console.log("\npg_indexes (public.purchases):");
for (const i of indexes) console.log(`  ${i.indexdef}`);

/** The columns the endpoint and the entitlement query require, by name. */
const REQUIRED = [
  "id",
  "device_id",
  "stripe_session_id",
  "stripe_payment_intent_id",
  "stripe_customer_id",
  "price_id",
  "plan",
  "amount_total",
  "currency",
  "created_at",
];
const missing = REQUIRED.filter(
  (name) => !columns.some((c) => c.column_name === name),
);
if (missing.length > 0) {
  console.error(`\nFAILED: purchases is missing columns: ${missing.join(", ")}`);
  process.exit(1);
}

// The UNIQUE index on stripe_session_id is what ON CONFLICT targets. Without it
// every insert would throw, so the migration is not done until it exists.
const hasSessionUnique = indexes.some(
  (i) =>
    /unique/i.test(i.indexdef) && /\(stripe_session_id\)/.test(i.indexdef),
);
if (!hasSessionUnique) {
  console.error(
    "\nFAILED: no UNIQUE index on purchases(stripe_session_id) — ON CONFLICT would throw.",
  );
  process.exit(1);
}

const hasDeviceIndex = indexes.some(
  (i) => i.indexname === "idx_purchases_device_id_created_at",
);
if (!hasDeviceIndex) {
  console.error("\nFAILED: missing index idx_purchases_device_id_created_at.");
  process.exit(1);
}

console.log(
  "\nOK: purchases table, UNIQUE(stripe_session_id), and the device lookup index exist.",
);
