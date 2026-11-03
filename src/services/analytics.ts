/**
 * analytics.ts — THE ONE CLIENT MODULE THAT KNOWS WHERE EVENTS GO (v47.2).
 *
 * WHY THIS EXISTS. None of the plan's KPIs (first-recognition >40%, day-1
 * retention >30%, recognition-to-save >25%, free-to-Pro >3%, affiliate CTR >8%)
 * were computable: there was no analytics SDK and no event call site anywhere in
 * `src/`. The decision the numbers unblock is one-time purchase vs subscription —
 * Stripe Express is one-time only, and recurring billing needs a Standard reset
 * that does not carry products or payment links over. Events added after launch
 * can never recover the first cohort, and that cohort is what decides it.
 *
 * THE ONE-FILE RULE. The endpoint path, the event allowlist, the prop vocabulary,
 * the queue, the sanitisation and the transport all live HERE. Moving to
 * PostHog/Amplitude later is a change to this file and nothing else: every call
 * site in the app imports `track` from this module and never names a URL, a
 * header, a batch shape or a vendor.
 *
 * WHAT MAY LEAVE THE PHONE — and nothing else:
 *   install_id    a RANDOM opaque id minted on first launch and kept in local
 *                 storage. Never a device id, never derived from anything
 *                 identifying, never shared across devices.
 *   name          one of ANALYTICS_EVENT_NAMES. Anything else is dropped here
 *                 (and rejected by the server, which validates rather than
 *                 sanitises).
 *   props         FLAT primitives from a FIXED vocabulary (ANALYTICS_PROP_KEYS).
 *                 A key outside the vocabulary is dropped, not sent; a key that
 *                 trips a denied token is dropped, not sent; a long string, a
 *                 non-finite number, a nested object or an array is dropped. The
 *                 server rejects the WHOLE request when one prop is bad, so one
 *                 poisoned prop would otherwise silently kill the batch.
 *   app_version / build_number   the build's own identity, so a KPI can be read
 *                 per build.
 * NO AUDIO, NO SCORE CONTENT, NO FREE TEXT, NO EMAIL, NO NAME, NO ACCOUNT.
 *
 * NEVER IN THE USER'S WAY. `track()` returns void and never throws. Nothing on a
 * user path awaits it: recognition, capture, checkout and save all call it and
 * carry on. The transport has a short timeout, a failure is silent (the events
 * stay in a bounded in-memory queue and go out with the next flush), and there is
 * no "sync failed" prompt anywhere — offline simply means the events wait or
 * fall off the end of the queue.
 *
 * THE PURCHASE EVENT IS NOT HERE, DELIBERATELY. A purchase is server-side truth
 * (a Stripe webhook or a server-side Stripe read). Inferring "they paid" from the
 * client returning to the app would be a guess dressed as a metric, so this
 * module never emits one and the server refuses that name.
 *
 * PURE ON PURPOSE: no react, no react-native, no expo, no fs. Storage, the base
 * URL and the transport are INJECTED (`configureAnalytics`), so the whole module
 * compiles and runs under the tier1 gate with `node_modules` absent, and the
 * guards can drive it with a fake storage and a fake transport.
 */

/** The ONE place the events endpoint's path appears in the app. */
export const ANALYTICS_ENDPOINT_PATH = '/api/events';

/**
 * THE ALLOWLIST — the same nine names the server accepts. A name outside this
 * list is dropped on the phone and refused with 400 on the server.
 */
export const ANALYTICS_EVENT_NAMES = [
  'app_open',
  'recognition_start',
  'recognition_result',
  'result_open',
  'save_piece',
  'wishlist_add',
  'plans_view',
  'upgrade_tap',
  'pro_feature_use',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

/**
 * The prop-key VOCABULARY. A prop key that is not here is dropped before the
 * request is built. It is also the reason no call site can invent a key like
 * `piece_name` or `has_score` and have it reach the wire: neither is in the list,
 * and both would trip the server's denied-token check (`name`, `score`) and kill
 * the whole batch.
 */
export const ANALYTICS_PROP_KEYS = [
  'source',
  'success',
  'piece_id',
  'hosted',
  'tier',
  'opened',
  'feature',
  'ok',
] as const;

export type AnalyticsPropKey = (typeof ANALYTICS_PROP_KEYS)[number];
export type AnalyticsPropValue = string | number | boolean | null;
export type AnalyticsProps = Partial<Record<AnalyticsPropKey, AnalyticsPropValue>>;

/**
 * The words the server refuses anywhere in a prop key (case/separator
 * insensitive). Mirrored here so the phone drops a bad key instead of losing the
 * whole batch to a 400.
 */
export const ANALYTICS_DENIED_PROP_TOKENS = [
  'email',
  'name',
  'phone',
  'address',
  'token',
  'password',
  'audio',
  'score',
  'lyrics',
] as const;

/** Bounded in-memory queue: past this, the OLDEST event falls off. */
export const ANALYTICS_MAX_QUEUE = 50;
/** The server accepts at most 20 events per request. */
export const ANALYTICS_MAX_BATCH = 20;
/** At most this many prop keys survive sanitisation. */
export const ANALYTICS_MAX_PROP_KEYS = 16;
/** A longer string value is dropped — long strings are free text by another name. */
export const ANALYTICS_MAX_STRING_VALUE = 80;
/** At most this many characters of serialised props (the server caps bytes). */
export const ANALYTICS_MAX_PROPS_CHARS = 1024;
/** The transport's own deadline: telemetry must never hold a connection open. */
export const ANALYTICS_TIMEOUT_MS = 4000;
/** One flush per burst: a debounce, not a retry storm. */
export const ANALYTICS_FLUSH_DELAY_MS = 1500;
/** How many batches one flush may send before giving up until the next one. */
export const ANALYTICS_MAX_BATCHES_PER_FLUSH = 3;

/** Where the random install id lives in the app's existing local storage. */
export const INSTALL_ID_STORAGE_KEY = '@notesnap/installId';
/** The shape the server accepts: 16-64 chars of [A-Za-z0-9_-]. */
export const INSTALL_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** Version strings the server accepts. A value that does not match is sent as null. */
export const ANALYTICS_VERSION_PATTERN = /^[A-Za-z0-9._+-]{1,32}$/;

/** The wire shape of ONE event (the server's own envelope keys, nothing else). */
export interface AnalyticsEventWire {
  name: AnalyticsEventName;
  install_id: string;
  props: Record<string, AnalyticsPropValue>;
  app_version: string | null;
  build_number: string | null;
}

/** The build identity every event carries. */
export interface AnalyticsMeta {
  installId: string;
  appVersion?: string | number | null;
  buildNumber?: string | number | null;
}

/** The slice of local storage this module needs — injected, so it stays pure. */
export interface AnalyticsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * The transport seam. Resolves true when the server accepted the batch. Swapping
 * to a vendor means replacing the default `postEventBatch` — nothing else.
 */
export type AnalyticsTransport = (url: string, body: string) => Promise<boolean>;

export interface AnalyticsConfig {
  storage: AnalyticsStorage;
  /** The API host (no trailing slash needed). The path lives in this file. */
  baseUrl: string;
  appVersion?: string | number | null;
  buildNumber?: string | number | null;
  /** Defaults to `postEventBatch`. A test (or a future vendor) may replace it. */
  transport?: AnalyticsTransport;
}

// ─── the global seam (this module is compiled with no DOM lib) ───────────────

interface AnalyticsGlobals {
  fetch?: (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body: string;
      signal?: unknown;
    },
  ) => Promise<{ ok: boolean }>;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  AbortController?: new () => { abort(): void; signal: unknown };
}

function globals(): AnalyticsGlobals {
  return globalThis as unknown as AnalyticsGlobals;
}

// ─── the event vocabulary ───────────────────────────────────────────────────

export function isAnalyticsEventName(name: unknown): name is AnalyticsEventName {
  return (
    typeof name === 'string' &&
    (ANALYTICS_EVENT_NAMES as readonly string[]).includes(name)
  );
}

export function isAnalyticsPropKey(key: unknown): key is AnalyticsPropKey {
  return (
    typeof key === 'string' && (ANALYTICS_PROP_KEYS as readonly string[]).includes(key)
  );
}

/** Lowercase, letters and digits only — the server's own normalisation. */
export function normalizeAnalyticsKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The first key that contains a denied token, or null. Substring, not equality,
 * exactly as the server does it: `piece_name` normalises to `piecename`, which
 * contains `name`, so it is refused.
 */
export function findDeniedAnalyticsKey(keys: readonly string[]): string | null {
  for (const key of keys) {
    const normalized = normalizeAnalyticsKey(key);
    for (const token of ANALYTICS_DENIED_PROP_TOKENS) {
      if (normalized.includes(token)) return key;
    }
  }
  return null;
}

/** A version string the server will accept, or null (never a guess). */
export function analyticsVersionField(value: unknown): string | null {
  const raw =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'number' && Number.isFinite(value)
        ? String(Math.floor(value))
        : '';
  if (!raw) return null;
  return ANALYTICS_VERSION_PATTERN.test(raw) ? raw : null;
}

/** One prop value, or undefined when it must be dropped. */
function sanitizePropValue(value: unknown): AnalyticsPropValue | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    return value.length <= ANALYTICS_MAX_STRING_VALUE ? value : undefined;
  }
  // Objects, arrays, functions, undefined: props are flat primitives only.
  return undefined;
}

/**
 * THE BATCH-POISON GUARD. Every prop is filtered before it can reach the wire:
 * an unknown key is dropped, a denied key is dropped, a value that is not a flat
 * primitive of an acceptable size is dropped, and a props object that still
 * serialises too large is dropped whole (the event itself survives — a lost
 * property must never cost the whole batch a 400).
 */
export function sanitizeAnalyticsProps(props: unknown): Record<string, AnalyticsPropValue> {
  const out: Record<string, AnalyticsPropValue> = {};
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return out;
  let kept = 0;
  for (const key of Object.keys(props as Record<string, unknown>)) {
    if (kept >= ANALYTICS_MAX_PROP_KEYS) break;
    if (!isAnalyticsPropKey(key)) continue;
    if (findDeniedAnalyticsKey([key]) !== null) continue;
    const value = sanitizePropValue((props as Record<string, unknown>)[key]);
    if (value === undefined) continue;
    out[key] = value;
    kept++;
  }
  if (JSON.stringify(out).length > ANALYTICS_MAX_PROPS_CHARS) return {};
  return out;
}

/**
 * ONE event in the server's envelope shape, or null when the name is not on the
 * allowlist or the install id is not the shape the server accepts.
 */
export function buildAnalyticsEvent(
  name: unknown,
  props: unknown,
  meta: AnalyticsMeta,
): AnalyticsEventWire | null {
  if (!isAnalyticsEventName(name)) return null;
  if (typeof meta.installId !== 'string' || !INSTALL_ID_PATTERN.test(meta.installId)) {
    return null;
  }
  return {
    name,
    install_id: meta.installId,
    props: sanitizeAnalyticsProps(props),
    app_version: analyticsVersionField(meta.appVersion),
    build_number: analyticsVersionField(meta.buildNumber),
  };
}

/**
 * A RANDOM opaque install id: 32 chars of [a-z0-9] behind a fixed prefix, so it
 * matches the server's 16-64 char pattern. Not a device id, not a hash of one,
 * not derived from anything the phone knows — a fresh random string per install.
 * `random` is injectable so a test can pin it.
 */
export function generateInstallId(random: () => number = Math.random): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let out = 'ns_';
  for (let i = 0; i < 29; i++) {
    const r = random();
    const bounded = Number.isFinite(r) ? Math.min(0.999999, Math.max(0, r)) : 0;
    out += alphabet.charAt(Math.floor(bounded * alphabet.length));
  }
  return out;
}

/** The endpoint's full URL, built from the injected host and this file's path. */
export function analyticsEndpointUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${ANALYTICS_ENDPOINT_PATH}`;
}

/**
 * THE DEFAULT TRANSPORT — the only place the app speaks to the events endpoint.
 * Fire-and-forget by construction: a short deadline, no retry, and a boolean
 * answer instead of an exception, so a failure can never reach a user path.
 */
export async function postEventBatch(url: string, body: string): Promise<boolean> {
  const g = globals();
  if (typeof g.fetch !== 'function') return false;
  const controller = typeof g.AbortController === 'function' ? new g.AbortController() : null;
  const timer =
    typeof g.setTimeout === 'function'
      ? g.setTimeout(() => {
          try {
            controller?.abort();
          } catch {
            // Aborting is best-effort; the timeout is not the failure to report.
          }
        }, ANALYTICS_TIMEOUT_MS)
      : null;
  try {
    const response = await g.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller?.signal,
    });
    return response.ok === true;
  } catch {
    // Offline, DNS, TLS, timeout, abort: all the same to telemetry.
    return false;
  } finally {
    if (timer !== null && typeof g.clearTimeout === 'function') g.clearTimeout(timer);
  }
}

// ─── the queue and the flush ───────────────────────────────────────────────

interface QueuedEvent {
  name: AnalyticsEventName;
  props: Record<string, AnalyticsPropValue>;
}

let config: AnalyticsConfig | null = null;
let queue: QueuedEvent[] = [];
let installId: string | null = null;
let inFlight = false;
let flushScheduled = false;
let appOpenQueued = false;

/** Wire the module up. Called once, from App.tsx, through analyticsDevice. */
export function configureAnalytics(next: AnalyticsConfig): void {
  config = {
    ...next,
    transport: next.transport ?? postEventBatch,
  };
}

/**
 * THE CALL SITE API. Returns nothing, awaits nothing, throws never. A user path
 * calls this and moves on; if anything is wrong the event is dropped silently.
 */
export function track(name: AnalyticsEventName, props?: AnalyticsProps): void {
  try {
    if (!isAnalyticsEventName(name)) return;
    // app_open is once per LAUNCH by construction, so a remount cannot double it.
    if (name === 'app_open') {
      if (appOpenQueued) return;
      appOpenQueued = true;
    }
    if (queue.length >= ANALYTICS_MAX_QUEUE) queue.shift();
    queue.push({ name, props: sanitizeAnalyticsProps(props) });
    scheduleFlush();
  } catch {
    // Telemetry never breaks a screen.
  }
}

function scheduleFlush(): void {
  if (config === null || flushScheduled) return;
  const g = globals();
  if (typeof g.setTimeout !== 'function') return;
  flushScheduled = true;
  g.setTimeout(() => {
    flushScheduled = false;
    void flushAnalytics();
  }, ANALYTICS_FLUSH_DELAY_MS);
}

async function ensureInstallId(): Promise<string> {
  if (installId !== null) return installId;
  if (config !== null) {
    try {
      const stored = await config.storage.getItem(INSTALL_ID_STORAGE_KEY);
      if (typeof stored === 'string' && INSTALL_ID_PATTERN.test(stored)) {
        installId = stored;
        return stored;
      }
    } catch {
      // Unreadable storage is not a reason to lose the events.
    }
  }
  const fresh = generateInstallId();
  installId = fresh;
  if (config !== null) {
    try {
      await config.storage.setItem(INSTALL_ID_STORAGE_KEY, fresh);
    } catch {
      // A write failure only costs the id's persistence, never the event.
    }
  }
  return fresh;
}

/**
 * Send what is queued, oldest first, at most ANALYTICS_MAX_BATCH per request.
 * A failed request leaves the events in the queue for the next flush; it never
 * throws and never reports anything to the user.
 */
export async function flushAnalytics(): Promise<void> {
  if (config === null || inFlight) return;
  if (queue.length === 0) return;
  // Held in a const so the build identity below cannot be read from a config that
  // a later call replaced mid-flush.
  const cfg = config;
  inFlight = true;
  try {
    const transport = cfg.transport ?? postEventBatch;
    const url = analyticsEndpointUrl(cfg.baseUrl);
    let batches = 0;
    while (queue.length > 0 && batches < ANALYTICS_MAX_BATCHES_PER_FLUSH) {
      batches++;
      const batch = queue.slice(0, ANALYTICS_MAX_BATCH);
      const id = await ensureInstallId();
      const events: AnalyticsEventWire[] = [];
      for (const item of batch) {
        const wire = buildAnalyticsEvent(item.name, item.props, {
          installId: id,
          appVersion: cfg.appVersion,
          buildNumber: cfg.buildNumber,
        });
        if (wire !== null) events.push(wire);
      }
      if (events.length === 0) {
        // Nothing in the batch could be represented — drop it rather than loop.
        queue = queue.slice(batch.length);
        continue;
      }
      const ok = await transport(url, JSON.stringify(events));
      if (!ok) return; // keep them queued; the next flush tries again
      queue = queue.slice(batch.length);
    }
  } catch {
    // Never a user-visible error, never a "sync failed" prompt.
  } finally {
    inFlight = false;
  }
}

/** Test seam: forget the queue, the id, the config and every latch. */
export function resetAnalyticsForTests(): void {
  config = null;
  queue = [];
  installId = null;
  inFlight = false;
  flushScheduled = false;
  appOpenQueued = false;
}

/** Test seam: the events waiting to go out (read-only copy). */
export function pendingAnalyticsEvents(): QueuedEvent[] {
  return queue.map((item) => ({ name: item.name, props: { ...item.props } }));
}
