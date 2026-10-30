/**
 * Anonymous product events — POST /api/events (v47.2 instrumentation).
 *
 * Owner ruling 2026-10-30: instrumentation ships BEFORE launch, on our own
 * Vercel + Neon, movable to a product-analytics vendor later. This module is
 * the SERVER half: the app posts events here through one swappable client
 * module (`src/services/analytics.ts` in the app repo); rows land in the
 * `events` table created by `scripts/migrate-events-table.ts`.
 *
 * WHY THIS EXISTS: none of the plan's KPIs (first-recognition >40%, day-1
 * retention >30%, free-to-Pro >3%, affiliate CTR >8%) were computable — there
 * was no analytics SDK and no event call site anywhere. The decision this
 * unblocks is one-time purchase vs subscription: Stripe Express is one-time
 * only, and recurring billing needs a Standard reset that does not carry
 * products or payment links over. Events added after launch can never recover
 * the first cohort, and that cohort is what decides it.
 *
 * WHAT A ROW MAY CONTAIN — and nothing else:
 *   install_id    random opaque id the app generates on first launch (16-64
 *                 chars of [A-Za-z0-9_-]). No account, no cross-device identity.
 *   name          one of EVENT_NAMES below. An unknown name is REJECTED (400),
 *                 never stored: the table cannot accumulate arbitrary strings.
 *   props         small flat object of primitives, <=16 keys, <=1024 bytes
 *                 serialised, string values <=80 chars. No nesting, no arrays.
 *   app_version   optional, [A-Za-z0-9._+-]{1,32}
 *   build_number  optional, same shape
 *
 * NO PERSONAL DATA, BY CONSTRUCTION: the envelope has exactly five allowed
 * keys and a prop key that even CONTAINS one of PII_DENY_TOKENS after
 * normalisation (case/separator-insensitive) rejects the whole request. That
 * means there is no way to smuggle an email, a person name, a phone number, an
 * address, a token, a password, audio, score content or lyric text into the
 * table — a request carrying one is refused, not silently stripped (silently
 * stripping would hide a client bug behind an empty column). Consequence for
 * the client module: name prop keys so they do not contain a denied word — use
 * `hosted` (boolean), never `has_score`; `piece_id`, never `piece_name`.
 *
 * NO AUTH, AND THAT IS DELIBERATE: the app cannot keep a secret, so a shared
 * token in the client would be theatre. Abuse is bounded instead, and honestly
 * best-effort: a 16 KB body cap, <=20 events per request, a hard name
 * allowlist, strict field shapes, and a per-install-id rate limit held in the
 * function instance's memory. What an attacker can still do: forge events for
 * invented install ids (up to the rate limit per instance, which resets on a
 * cold start and is not shared between concurrent instances), and inflate
 * aggregate counts. They cannot read anything back (there is no read endpoint),
 * cannot write PII (it is rejected), and cannot affect the app, the catalog,
 * Stripe or any money path — this endpoint only appends rows to one table.
 *
 * HONEST STATUS CODES:
 *   204  validated AND written — this is the only "success" the client sees.
 *   202  validated but NOT persisted (database error, or the write exceeded the
 *        short timeout). Telemetry is fire-and-forget, so a database hiccup must
 *        not become a 500 storm in the function logs; 202 says plainly "not
 *        stored" instead of pretending.
 *   400  validation failure (bad shape, unknown event name, PII-shaped key).
 *   413  body larger than 16 KB.
 *   429  per-install rate limit hit (best-effort, see above).
 *   405  any method other than POST/OPTIONS.
 * Error bodies are short fixed strings — never a stack, never a database error
 * message.
 *
 * CORS: this is called by the app (React Native sends no Origin header, so no
 * CORS response is needed for it to work). A browser origin is echoed back ONLY
 * when it is one of ours; anything else gets no allow-origin header at all,
 * so the endpoint is not open to arbitrary web pages.
 *
 * TODO(v47.2 follow-up): `purchase_complete` is NOT collected here. It must be
 * server-side from Stripe — never inferred from the client returning to the
 * app — and needs either (a) the owner adding this endpoint's URL as a Stripe
 * webhook endpoint (Express accounts can receive webhooks, but the endpoint has
 * to be created in the dashboard and its signing secret stored as
 * STRIPE_WEBHOOK_SECRET; the repo already has `src/services/webhook-handler.ts`
 * for subscription lifecycle), or (b) a Stripe key in the server env to read
 * completed Checkout Sessions on a schedule. Zero purchases exist today, so
 * nothing is lost by deferring it to that follow-up.
 */
import { sql } from "~/db";

/**
 * THE ALLOWLIST — nine event names, identical on both sides of the wire.
 * The brief calls it "exactly these seven" and then lists nine; the list is
 * what binds, so nine are accepted. The app's client module must keep the same
 * nine, and `events-handler.test.ts` pins this array so a drift shows up as a
 * failing test rather than as silently-dropped events in production.
 */
export const EVENT_NAMES = [
  "app_open",
  "recognition_start",
  "recognition_result",
  "result_open",
  "save_piece",
  "wishlist_add",
  "plans_view",
  "upgrade_tap",
  "pro_feature_use",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** Words that may not appear in any prop key (or extra envelope key). */
export const PII_DENY_TOKENS = [
  "email",
  "name",
  "phone",
  "address",
  "token",
  "password",
  "audio",
  "score",
  "lyrics",
] as const;

/** Max events in one request. One more than this is a client bug, not a batch. */
export const MAX_BATCH = 20;
/** Hard body cap. 20 events of valid size fit well inside this. */
export const MAX_BODY_BYTES = 16 * 1024;
/** Max serialised size of one event's props. */
export const MAX_PROPS_BYTES = 1024;
/** Max keys in one props object (a "small flat object", not a payload dump). */
export const MAX_PROP_KEYS = 16;
/** Max length of one string prop value. Long strings are free text by another name. */
export const MAX_STRING_VALUE = 80;
/** Per-install rate limit: best-effort, per function instance, in memory. */
export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX_EVENTS_PER_WINDOW = 120;
/** Short write timeout — the client must never be held open by the database. */
export const WRITE_TIMEOUT_MS = 2_500;

/** Random opaque install id: 16-64 chars, urlsafe base64 / hex / uuid shaped. */
const INSTALL_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** Version strings: "0.1.40", "1.0.0-beta.3", "47". Never free text. */
const VERSION_RE = /^[A-Za-z0-9._+-]{1,32}$/;

/** Envelope keys an event object may carry. Anything else is rejected. */
const ENVELOPE_KEYS = [
  "name",
  "install_id",
  "props",
  "app_version",
  "build_number",
] as const;

/** The browser origins (if any) this endpoint will answer with CORS headers. */
const ALLOWED_ORIGINS = [
  "https://site-notesnap.vercel.app",
  "https://notesnap.app",
  "https://www.notesnap.app",
];

/** One validated event, ready to insert. */
export interface NormalizedEvent {
  install_id: string;
  name: EventName;
  props: Record<string, string | number | boolean | null>;
  app_version: string | null;
  build_number: string | null;
}

export type ValidationResult =
  | { ok: true; events: NormalizedEvent[] }
  | { ok: false; status: 400; error: string };

/** Normalise a key for the PII check: lowercase, letters and digits only. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The first key that looks like personal data, or null when the set is clean.
 * Substring, not equality: `userEmail`, `user_email` and `emailAddress` all
 * normalise to strings containing "email". Erring strict is the point — a
 * rejected event is a visible client bug; a stored email is a liability.
 */
export function findPiiKey(keys: readonly string[]): string | null {
  for (const key of keys) {
    const normalized = normalizeKey(key);
    for (const token of PII_DENY_TOKENS) {
      if (normalized.includes(token)) return key;
    }
  }
  return null;
}

/** True when `value` is a plain JSON object (not an array, not null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Byte length of a string as UTF-8 (what the body cap is actually about). */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Validate ONE event object. Returns the normalised event or a fixed error
 * string (never echoing the input back — the input may be the very PII we are
 * refusing to store).
 */
export function validateOneEvent(
  raw: unknown,
): { ok: true; event: NormalizedEvent } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: "each event must be an object" };

  const unknownEnvelope = Object.keys(raw).filter(
    (key) => !(ENVELOPE_KEYS as readonly string[]).includes(key),
  );
  if (unknownEnvelope.length > 0) {
    const pii = findPiiKey(unknownEnvelope);
    if (pii) return { ok: false, error: `event key "${pii}" is not allowed` };
    return {
      ok: false,
      error: `unknown event field "${unknownEnvelope[0]}"`,
    };
  }

  const name = raw.name;
  if (typeof name !== "string" || !(EVENT_NAMES as readonly string[]).includes(name)) {
    return { ok: false, error: "unknown event name" };
  }

  const installId = raw.install_id;
  if (typeof installId !== "string" || !INSTALL_ID_RE.test(installId)) {
    return {
      ok: false,
      error: "install_id must be 16-64 chars of [A-Za-z0-9_-]",
    };
  }

  for (const field of ["app_version", "build_number"] as const) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !VERSION_RE.test(value)) {
      return { ok: false, error: `${field} must match [A-Za-z0-9._+-]{1,32}` };
    }
  }

  const propsRaw = raw.props ?? {};
  if (!isPlainObject(propsRaw)) return { ok: false, error: "props must be an object" };
  const propKeys = Object.keys(propsRaw);
  if (propKeys.length > MAX_PROP_KEYS) {
    return { ok: false, error: `props may carry at most ${MAX_PROP_KEYS} keys` };
  }
  const piiProp = findPiiKey(propKeys);
  if (piiProp) return { ok: false, error: `prop key "${piiProp}" is not allowed` };

  const props: NormalizedEvent["props"] = {};
  for (const key of propKeys) {
    if (normalizeKey(key) === "") return { ok: false, error: "prop keys must contain letters or digits" };
    const value = propsRaw[key];
    if (value === null) {
      props[key] = null;
    } else if (typeof value === "boolean") {
      props[key] = value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return { ok: false, error: `prop "${key}" must be a finite number` };
      }
      props[key] = value;
    } else if (typeof value === "string") {
      if (value.length > MAX_STRING_VALUE) {
        return {
          ok: false,
          error: `prop "${key}" must be ${MAX_STRING_VALUE} characters or fewer`,
        };
      }
      props[key] = value;
    } else {
      // Objects, arrays and functions: props are flat primitives only.
      return { ok: false, error: `prop "${key}" must be a string, number, boolean or null` };
    }
  }
  if (byteLength(JSON.stringify(props)) > MAX_PROPS_BYTES) {
    return { ok: false, error: `props must serialise to ${MAX_PROPS_BYTES} bytes or fewer` };
  }

  return {
    ok: true,
    event: {
      install_id: installId,
      name: name as EventName,
      props,
      app_version: typeof raw.app_version === "string" ? raw.app_version : null,
      build_number: typeof raw.build_number === "string" ? raw.build_number : null,
    },
  };
}

/**
 * Validate a whole request body: one event object, or an array of 1..MAX_BATCH.
 * Pure and DB-free on purpose — the accept/reject rules are the part that must
 * never drift, so they are unit-tested without a database.
 */
export function validateEventsPayload(raw: unknown): ValidationResult {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return { ok: false, status: 400, error: "empty batch" };
    if (raw.length > MAX_BATCH) {
      return {
        ok: false,
        status: 400,
        error: `at most ${MAX_BATCH} events per request`,
      };
    }
    const events: NormalizedEvent[] = [];
    for (const item of raw) {
      const result = validateOneEvent(item);
      if (!result.ok) return { ok: false, status: 400, error: result.error };
      events.push(result.event);
    }
    return { ok: true, events };
  }

  const single = validateOneEvent(raw);
  if (!single.ok) return { ok: false, status: 400, error: single.error };
  return { ok: true, events: [single.event] };
}

// --- Rate limiting (best-effort, per instance, in memory) -------------------

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
/** Bound the map so a flood of invented install ids cannot grow memory forever. */
const MAX_BUCKETS = 5_000;

/**
 * Count `n` events against an install id's window. Returns false when the
 * window is exhausted. Deliberately simple: a fixed window per process. It is
 * NOT a security control and is documented as such — it stops one broken client
 * from writing in a tight loop, nothing more.
 */
export function rateLimitAllows(installId: string, n: number, now = Date.now()): boolean {
  const existing = buckets.get(installId);
  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      // Drop the oldest-expiring bucket; telemetry accuracy is not worth memory.
      let oldestKey: string | null = null;
      let oldestReset = Infinity;
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt < oldestReset) {
          oldestReset = bucket.resetAt;
          oldestKey = key;
        }
      }
      if (oldestKey !== null) buckets.delete(oldestKey);
    }
    buckets.set(installId, { count: n, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (existing.count + n > RATE_MAX_EVENTS_PER_WINDOW) return false;
  existing.count += n;
  return true;
}

/** Test seam: forget every bucket (so a suite can start from a clean window). */
export function resetRateLimit(): void {
  buckets.clear();
}

// --- Response helpers ------------------------------------------------------

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function empty(status: number, origin: string | null): Response {
  return new Response(null, { status, headers: corsHeaders(origin) });
}

function fail(status: number, error: string, origin: string | null): Response {
  // Fixed, human-written strings only — never an exception message or a stack.
  return Response.json({ success: false, error }, { status, headers: corsHeaders(origin) });
}

/** Read the body, refusing anything over the cap (bytes, not characters). */
async function readCappedBody(req: Request): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) return null;
  const text = await req.text();
  if (byteLength(text) > MAX_BODY_BYTES) return null;
  return text;
}

/**
 * Insert one validated batch in a single statement. Values are bound
 * parameters; `props` is a JSON string cast to jsonb. Resolves to true when the
 * rows are committed, false on any error or timeout — the caller turns false
 * into a 202, never a 500.
 */
async function insertEvents(events: NormalizedEvent[]): Promise<boolean> {
  const values: Array<string> = [];
  const params: Array<string | null> = [];
  for (const event of events) {
    const base = params.length;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}::jsonb, $${base + 4}, $${base + 5})`,
    );
    params.push(
      event.install_id,
      event.name,
      JSON.stringify(event.props),
      event.app_version,
      event.build_number,
    );
  }

  const write = sql()
    .query(
      `INSERT INTO events (install_id, name, props, app_version, build_number)
       VALUES ${values.join(", ")}`,
      params,
    )
    .then(() => true)
    .catch((err: unknown) => {
      // Server-side log only. A telemetry write failure is worth one line, not
      // a stack the client could ever see, and never a 500.
      console.warn("[events] write failed:", err instanceof Error ? err.message : err);
      return false;
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), WRITE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([write, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * POST /api/events — accept one event or a small batch.
 *
 * Routed unconditionally on method (like the newsletter and checkout routes) so
 * this handler owns its own 405/OPTIONS answers instead of the SSR fallthrough.
 */
export async function handleEvents(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return empty(204, origin);
  if (req.method !== "POST") {
    return fail(405, "Method not allowed. Use POST.", origin);
  }

  const text = await readCappedBody(req);
  if (text === null) {
    return fail(413, `body must be ${MAX_BODY_BYTES} bytes or fewer`, origin);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(400, "body must be valid JSON", origin);
  }

  const validated = validateEventsPayload(parsed);
  if (!validated.ok) return fail(validated.status, validated.error, origin);

  // Rate limit by install id (one id may appear more than once in a batch).
  const perInstall = new Map<string, number>();
  for (const event of validated.events) {
    perInstall.set(event.install_id, (perInstall.get(event.install_id) ?? 0) + 1);
  }
  for (const [installId, count] of perInstall) {
    if (!rateLimitAllows(installId, count)) {
      return fail(429, "too many events for this install id", origin);
    }
  }

  const stored = await insertEvents(validated.events);
  // 204 = stored; 202 = accepted but not persisted (see the header).
  return empty(stored ? 204 : 202, origin);
}
