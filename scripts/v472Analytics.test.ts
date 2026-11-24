/**
 * v472Analytics.test.ts — THE EVENT LOG'S GUARDS (v47.2).
 *
 * WHAT THIS PROVES, and why each part exists:
 *
 *  1. ALLOWLIST PARITY — the app's nine names are exactly the server's nine, in
 *     the same order (the server REJECTS an unknown name, so drift = silently
 *     dropped events in production).
 *  2. HOSTING, NOT WIRING — per event, the FILE THAT RENDERS THE SURFACE calls
 *     `track`, the call sits next to the real work (the recognition request, the
 *     checkout, the write), and that file is mounted by another module. A module
 *     that exports `track` and is never called from the recognition path FAILS
 *     here (proved by the mutation probes below).
 *  3. NO DENIED KEY CAN LEAVE THE PHONE — the prop vocabulary trips none of the
 *     server's denied tokens, and a hostile props object is stripped before the
 *     wire (a poisoned prop would otherwise 400 the WHOLE batch).
 *  4. ONE FILE OWNS THE ENDPOINT — `/api/events` appears in exactly one module.
 *  5. THE PURCHASE EVENT IS NEVER SENT FROM THE CLIENT — the literal appears
 *     nowhere in `src/`, and it is not on the allowlist.
 *  6. THE QUEUE BEHAVES — bounded at 50, at most 20 per request, a failed
 *     request keeps the events, a successful one empties the queue, the install
 *     id is random, persisted once and reused, and `app_open` fires once.
 *  7. SETTINGS → ABOUT SAYS IT — one plain sentence, no opt-out promised.
 *
 * MUTATION-PROVED: every source guard is re-run against a deliberately broken
 * copy of the real text (the pre-fix shape) and must FAIL there. The pure
 * behaviour guards are driven with hostile input rather than mutated code, so
 * there is no stale compiled module to recompile first.
 *
 * Plain Node, no react-native, no network. Run with `npm run test:tier1`.
 */
import {
  ANALYTICS_ENDPOINT_PATH,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_MAX_BATCH,
  ANALYTICS_MAX_QUEUE,
  ANALYTICS_PROP_KEYS,
  INSTALL_ID_PATTERN,
  INSTALL_ID_STORAGE_KEY,
  analyticsEndpointUrl,
  buildAnalyticsEvent,
  configureAnalytics,
  findDeniedAnalyticsKey,
  flushAnalytics,
  generateInstallId,
  pendingAnalyticsEvents,
  resetAnalyticsForTests,
  sanitizeAnalyticsProps,
  track,
  type AnalyticsStorage,
} from '../src/services/analytics';
import {
  ABOUT_USAGE_LINE_MARKER,
  AFFILIATE_CTA_CALL_SITES,
  AFFILIATE_CTA_DOORS,
  EVENT_CALL_SITES,
  UNUSED_EVENTS,
  aboutUsageLineViolations,
  affiliateCtaViolations,
  affiliateSurfaceIdViolations,
  allowlistViolations,
  endpointPathFiles,
  hostingViolations,
  maskComments,
  propVocabularyIsClean,
  purchaseEventMentions,
  purchaseEventName,
  vocabularyAvoids,
  deniedTokens,
  type SourceFile,
} from '../src/services/v472AnalyticsContract';
import {
  AFFILIATE_CTA_SURFACES,
  affiliateCtaEventName,
  affiliateCtaProps,
  isAffiliateCtaSurface,
  trackAffiliateCta,
} from '../src/services/affiliateCtaEvents';
import { aboutDialogBody } from '../src/services/settingsSpec';

let passes = 0;
let failures = 0;

declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };

function assert(ok: boolean, label: string): void {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    console.log(`     expected ${String(expected)}, got ${String(actual)}`);
  }
  assert(actual === expected, label);
}

// ─── the tree, read once ────────────────────────────────────────

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}

/** Every `.ts`/`.tsx` file under `src/`, plus the app root — the real surface. */
function readTree(): SourceFile[] {
  const fs = require('fs');
  const path = require('path');
  const root = repoRoot();
  const files: SourceFile[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir) as string[]) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        visit(full);
      } else if (/\.tsx?$/.test(entry)) {
        files.push({
          path: path.relative(root, full).split(path.sep).join('/'),
          text: fs.readFileSync(full, 'utf8') as string,
        });
      }
    }
  };
  visit(path.join(root, 'src'));
  files.push({ path: 'App.tsx', text: fs.readFileSync(path.join(root, 'App.tsx'), 'utf8') as string });
  return files;
}

const TREE = readTree();

function fileText(relPath: string): string {
  const found = TREE.find((file) => file.path === relPath);
  return found ? found.text : '';
}

/** A copy of the tree with one file's text replaced (the mutation probe). */
function withFile(relPath: string, text: string): SourceFile[] {
  return TREE.map((file) => (file.path === relPath ? { path: relPath, text } : file));
}

// ─── 1. allowlist parity with the server ───────────────────────

/** The server's list, copied from `events-handler.ts` (site repo, PR #204). */
const SERVER_EVENT_NAMES = [
  'app_open',
  'recognition_start',
  'recognition_result',
  'result_open',
  'save_piece',
  'wishlist_add',
  'plans_view',
  'upgrade_tap',
  'pro_feature_use',
  'affiliate_cta_viewed',
  'affiliate_cta_clicked',
];

function allowlistTests(): void {
  console.log('\nallowlist');
  assertEq(ANALYTICS_EVENT_NAMES.length, 11, 'the app knows exactly eleven event names');
  assertEq(allowlistViolations(SERVER_EVENT_NAMES).length, 0, 'the eleven names match the server, in order');
  assert(
    allowlistViolations(SERVER_EVENT_NAMES.slice(0, 10)).length > 0,
    'a shorter server list is reported as drift',
  );
  assert(
    allowlistViolations(['app_open', 'recognition_start']).length > 0,
    'a different server list is reported as drift',
  );
  assert(
    !(ANALYTICS_EVENT_NAMES as readonly string[]).includes(purchaseEventName()),
    'the purchase event is NOT on the client allowlist',
  );
  for (const unused of UNUSED_EVENTS) {
    assertEq(unused.event, 'wishlist_add', `the unused event is ${unused.event} (no wishlist in the app)`);
  }
}

// ─── 2. hosting ────────────────────────────────────────────────

function hostingTests(): void {
  console.log('\nhosting (the call site is reachable from the surface that renders it)');
  const violations = hostingViolations(TREE);
  if (violations.length > 0) console.log('     ' + violations.join('\n     '));
  assertEq(violations.length, 0, 'every event with a surface has a hosted call site');

  // Every event except the one with no surface must appear in the table.
  const hosted = new Set(EVENT_CALL_SITES.map((site) => site.event));
  // The affiliate pair is hosted by the funnel table below (a call site calls
  // `trackAffiliateCta(surface, phase)`, never `track('name')` directly), so it is
  // proven there instead of here.
  const affiliateNames = ['affiliate_cta_viewed', 'affiliate_cta_clicked'];
  for (const name of ANALYTICS_EVENT_NAMES) {
    if (UNUSED_EVENTS.some((unused) => unused.event === name)) {
      assert(!hosted.has(name), `${name} is declared unused and has no call site`);
    } else if (affiliateNames.includes(name)) {
      assert(
        AFFILIATE_CTA_CALL_SITES.length > 0,
        `${name} is hosted through the affiliate funnel's call-site table`,
      );
    } else {
      assert(hosted.has(name), `${name} has a call site in the table`);
    }
  }
  // The recognition path specifically (the brief's own example).
  const recognitionSites = EVENT_CALL_SITES.filter((site) =>
    site.event.startsWith('recognition_'),
  );
  assertEq(recognitionSites.length, 8, 'the recognition pair is hosted on all four capture surfaces');

  // The tree really contains what the guards claim (a guard on the guards).
  assert(fileText('src/screens/HomeScreen.tsx').includes("track('recognition_start'"), 'HomeScreen calls track');
  assert(fileText('src/services/analytics.ts').includes('export function track('), 'analytics.ts exports track');
}

function hostingMutationProbes(): void {
  console.log('\nmutation probes — the hosting guard bites');

  // 1. the module exists but the recognition path never calls it (the v46 class).
  const home = fileText('src/screens/HomeScreen.tsx');
  const noTrack = home
    .split("track('recognition_start', { source: 'audio' });")
    .join('')
    .split("track('recognition_start', { source: 'hum' });")
    .join('');
  assert(noTrack !== home, 'probe: the HomeScreen track call can be removed');
  assert(
    hostingViolations(withFile('src/screens/HomeScreen.tsx', noTrack)).length > 0,
    'FAILS when the audio recognition path stops calling track',
  );

  // 2. the call exists but the file is no longer mounted by anything.
  const tab = fileText('src/navigation/TabNavigator.tsx');
  const tabUnhosted = tab.split('HomeScreen').join('RenamedScreen');
  assert(
    hostingViolations(withFile('src/navigation/TabNavigator.tsx', tabUnhosted)).length > 0,
    'FAILS when the screen that tracks is no longer mounted',
  );

  // 3. the call is only in a COMMENT — not a call site at all.
  const commented = home
    .split("track('recognition_start', { source: 'audio' });")
    .join("// track('recognition_start', { source: 'audio' });")
    .split("track('recognition_start', { source: 'hum' });")
    .join("// track('recognition_start', { source: 'hum' });");
  assert(
    hostingViolations(withFile('src/screens/HomeScreen.tsx', commented)).length > 0,
    'FAILS when the call is commented out',
  );

  // 4. the call is wired but no longer next to the real work (checkout removed).
  const settings = fileText('src/screens/SettingsScreen.tsx');
  const noCheckout = settings.split('createCheckoutSession(priceId, deviceId)').join('openNowhere()');
  assert(
    hostingViolations(withFile('src/screens/SettingsScreen.tsx', noCheckout)).length > 0,
    'FAILS when upgrade_tap is no longer beside a real checkout',
  );

  // 5. the real tree still passes after every probe.
  assertEq(hostingViolations(TREE).length, 0, 'the real tree still passes after the probes');
}

// ─── 3. no denied key can leave the phone ─────────────────────

function deniedKeyTests(): void {
  console.log('\ndenied keys');
  assert(propVocabularyIsClean(), 'no prop key in the vocabulary trips a denied token');
  assert(vocabularyAvoids(deniedTokens()), 'the vocabulary avoids every denied token');
  for (const token of deniedTokens()) {
    assert(
      findDeniedAnalyticsKey(['x_' + token]) !== null,
      `a key containing "${token}" is rejected`,
    );
  }
  // The two keys the server's own docs warn about.
  assertEq(findDeniedAnalyticsKey(['piece_name']), 'piece_name', 'piece_name is refused (contains "name")');
  assertEq(findDeniedAnalyticsKey(['has_score']), 'has_score', 'has_score is refused (contains "score")');
  assertEq(findDeniedAnalyticsKey(['piece_id', 'hosted']), null, 'piece_id and hosted are clean');

  // A hostile props object cannot poison the batch.
  const hostile = sanitizeAnalyticsProps({
    piece_name: 'Clair de Lune',
    email: 'someone@example.com',
    has_score: true,
    piece_id: 'abc123',
    hosted: true,
  });
  assertEq(Object.keys(hostile).length, 2, 'only the vocabulary keys survive sanitisation');
  assertEq(hostile.piece_id, 'abc123', 'piece_id survives');
  assertEq(hostile.hosted, true, 'hosted survives');

  // Values that are not flat primitives, or are too long, are dropped.
  const messy = sanitizeAnalyticsProps({
    piece_id: { nested: true },
    source: ['audio'],
    tier: 'x'.repeat(200),
    feature: 'cloud_sync',
  } as unknown as Record<string, unknown>);
  assertEq(Object.keys(messy).length, 1, 'nested, array and over-long values are dropped');
  assertEq(messy.feature, 'cloud_sync', 'the one valid prop survives');

  // The wire payload itself carries no denied key, for every event name.
  const id = generateInstallId(() => 0.42);
  let clean = true;
  for (const name of ANALYTICS_EVENT_NAMES) {
    const wire = buildAnalyticsEvent(name, { piece_id: 'p1', hosted: false }, {
      installId: id,
      appVersion: '0.1.40',
      buildNumber: 40,
    });
    if (wire === null) {
      clean = false;
      continue;
    }
    const keys = Object.keys(wire.props);
    if (findDeniedAnalyticsKey(keys) !== null) clean = false;
    // Only the PROPS are scanned: the envelope's own "name" key is the event name,
    // not a person's name, and it is the server's own fixed field.
    const serialisedProps = JSON.stringify(wire.props);
    for (const token of deniedTokens()) {
      if (serialisedProps.includes(`"${token}`)) clean = false;
    }
  }
  assert(clean, 'no event payload carries a denied key');
}

// ─── 4. one file owns the endpoint ────────────────────────────

function endpointTests(): void {
  console.log('\nthe endpoint has exactly one home');
  const owners = endpointPathFiles(TREE);
  if (owners.length !== 1) console.log('     owners: ' + owners.join(', '));
  assertEq(owners.length, 1, 'exactly one module mentions the events path');
  assertEq(owners[0], 'src/services/analytics.ts', 'and it is src/services/analytics.ts');
  assert(
    endpointPathFiles(withFile('src/screens/SettingsScreen.tsx', fileText('src/screens/SettingsScreen.tsx') + "\nfetch('/api/events');\n")).length === 2,
    'FAILS when a second module hardcodes the endpoint',
  );
  assertEq(
    analyticsEndpointUrl('https://site-notesnap.vercel.app'),
    'https://site-notesnap.vercel.app' + ANALYTICS_ENDPOINT_PATH,
    'the URL is built from the injected host plus the one path',
  );
  assertEq(
    analyticsEndpointUrl('https://example.test/'),
    'https://example.test' + ANALYTICS_ENDPOINT_PATH,
    'a trailing slash on the host does not double up',
  );
}

// ─── 5. the purchase event is server-side truth ───────────────

function purchaseTests(): void {
  console.log('\nthe purchase event never comes from the client');
  const mentions = purchaseEventMentions(TREE);
  if (mentions.length > 0) console.log('     mentioned in: ' + mentions.join(', '));
  assertEq(mentions.length, 0, 'no file under src/ mentions the purchase event at all');
  assert(
    purchaseEventMentions(withFile('src/screens/SettingsScreen.tsx', "track('" + purchaseEventName() + "');")).length === 1,
    'FAILS when a screen tries to send the purchase event',
  );
}

// ─── 6. the queue behaves ─────────────────────────────────────

function fakeStorage(seed?: string): AnalyticsStorage & { writes: string[]; value: string | null } {
  const box = {
    value: seed ?? null,
    writes: [] as string[],
    async getItem(_key: string): Promise<string | null> {
      return box.value;
    },
    async setItem(_key: string, value: string): Promise<void> {
      box.writes.push(value);
      box.value = value;
    },
  };
  return box;
}

interface SentBatch {
  url: string;
  events: any[];
}

function recordingTransport(result: boolean, sent: SentBatch[]) {
  return async (url: string, body: string): Promise<boolean> => {
    sent.push({ url, events: JSON.parse(body) });
    return result;
  };
}

async function queueTests(): Promise<void> {
  console.log('\nthe queue');

  // Bounded: 60 events in, 50 held.
  resetAnalyticsForTests();
  configureAnalytics({ storage: fakeStorage(), baseUrl: 'https://example.test', appVersion: '0.1.40', buildNumber: 40 });
  for (let i = 0; i < 60; i++) track('save_piece', { piece_id: 'p' + i });
  assertEq(pendingAnalyticsEvents().length, ANALYTICS_MAX_QUEUE, 'the queue is bounded at 50');
  assertEq(pendingAnalyticsEvents()[ANALYTICS_MAX_QUEUE - 1].props.piece_id, 'p59', 'the OLDEST events fall off');

  // A successful flush sends at most 20 per request and empties what it sent.
  resetAnalyticsForTests();
  const storage = fakeStorage();
  const sent: SentBatch[] = [];
  configureAnalytics({
    storage,
    baseUrl: 'https://example.test',
    appVersion: '0.1.40',
    buildNumber: 40,
    transport: recordingTransport(true, sent),
  });
  for (let i = 0; i < 45; i++) track('save_piece', { piece_id: 'q' + i });
  await flushAnalytics();
  assertEq(sent.length, 3, '45 queued events go out in three requests');
  assertEq(sent[0].events.length, ANALYTICS_MAX_BATCH, 'the first request carries at most 20 events');
  assertEq(sent[2].events.length, 5, 'the last request carries the remainder');
  assertEq(pendingAnalyticsEvents().length, 0, 'the queue is empty after a successful flush');
  assertEq(sent[0].url, 'https://example.test' + ANALYTICS_ENDPOINT_PATH, 'the transport is handed the endpoint URL');
  assertEq(sent[0].events[0].install_id.length > 0, true, 'every event carries the install id');
  assertEq(sent[0].events[0].app_version, '0.1.40', 'the build identity rides along');
  assertEq(sent[0].events[0].build_number, '40', 'the versionCode rides along');
  assert(INSTALL_ID_PATTERN.test(sent[0].events[0].install_id), 'the install id is the shape the server accepts');

  // A failed flush keeps the events (offline = queued, never a lost batch, never a prompt).
  resetAnalyticsForTests();
  const failing: SentBatch[] = [];
  configureAnalytics({
    storage: fakeStorage(),
    baseUrl: 'https://example.test',
    transport: recordingTransport(false, failing),
  });
  for (let i = 0; i < 5; i++) track('save_piece', { piece_id: 'r' + i });
  await flushAnalytics();
  assertEq(failing.length, 1, 'one request was attempted');
  assertEq(pendingAnalyticsEvents().length, 5, 'a failed request keeps every event queued');

  // The install id is minted once, persisted, and reused on the next launch.
  resetAnalyticsForTests();
  const store = fakeStorage();
  const firstRun: SentBatch[] = [];
  configureAnalytics({ storage: store, baseUrl: 'https://example.test', transport: recordingTransport(true, firstRun) });
  track('save_piece', { piece_id: 'x' });
  await flushAnalytics();
  assertEq(store.writes.length, 1, 'the install id is written to local storage once');
  assertEq(store.writes[0], firstRun[0].events[0].install_id, 'the stored id is the id that was sent');
  resetAnalyticsForTests();
  const secondRun: SentBatch[] = [];
  configureAnalytics({ storage: store, baseUrl: 'https://example.test', transport: recordingTransport(true, secondRun) });
  track('save_piece', { piece_id: 'y' });
  await flushAnalytics();
  assertEq(secondRun[0].events[0].install_id, firstRun[0].events[0].install_id, 'the same install id is reused next launch');

  // Random, and not a device id: two mints differ, and the shape is opaque.
  const a = generateInstallId();
  const b = generateInstallId();
  assert(a !== b, 'two install ids differ (random, not derived from the device)');
  assert(INSTALL_ID_PATTERN.test(a) && INSTALL_ID_PATTERN.test(b), 'both match the server pattern');
  assertEq(generateInstallId(() => 0.5), generateInstallId(() => 0.5), 'the generator is deterministic when fed a fixed random');

  // app_open fires ONCE per launch, however many times the root remounts.
  resetAnalyticsForTests();
  const once: SentBatch[] = [];
  configureAnalytics({ storage: fakeStorage(), baseUrl: 'https://example.test', transport: recordingTransport(true, once) });
  track('app_open');
  track('app_open');
  track('app_open');
  await flushAnalytics();
  const appOpens = once[0].events.filter((event: any) => event.name === 'app_open');
  assertEq(appOpens.length, 1, 'app_open is emitted once per launch');

  // An unknown name is dropped on the phone (the server would 400 the batch).
  resetAnalyticsForTests();
  configureAnalytics({ storage: fakeStorage(), baseUrl: 'https://example.test' });
  track('not_an_event' as any, { piece_id: 'z' });
  assertEq(pendingAnalyticsEvents().length, 0, 'an unknown event name is dropped, never queued');

  // Nothing throws, and nothing is awaited on a user path: track returns undefined.
  const returned: unknown = track('save_piece', { piece_id: 'ok' });
  assertEq(returned, undefined, 'track returns void');
  resetAnalyticsForTests();
  const unconfigured: unknown = track('save_piece', { piece_id: 'unconfigured' });
  assertEq(unconfigured, undefined, 'track is safe before configuration');
  assertEq(pendingAnalyticsEvents().length, 1, 'an unconfigured track is still queued, never thrown');
  resetAnalyticsForTests();
}

// ─── 7. Settings → About says it ──────────────────────────────

function aboutLineTests(): void {
  console.log('\nSettings → About');
  const body = aboutDialogBody('0.1.40');
  const violations = aboutUsageLineViolations(body, fileText('src/screens/SettingsScreen.tsx'));
  if (violations.length > 0) console.log('     ' + violations.join('\n     '));
  assertEq(violations.length, 0, 'About states the anonymous usage counts, no personal data, no audio');
  assert(body.includes(ABOUT_USAGE_LINE_MARKER), 'the sentence is in the About body the row opens');
  assert(!/opt[- ]?out/i.test(body), 'About promises no opt-out the app cannot honour');

  // Mutation probes.
  assert(
    aboutUsageLineViolations(
      body.split(ABOUT_USAGE_LINE_MARKER).join('Something else'),
      fileText('src/screens/SettingsScreen.tsx'),
    ).length > 0,
    'FAILS when the sentence is removed from About',
  );
  assert(
    aboutUsageLineViolations(body + '\nYou can turn tracking off in Settings.', fileText('src/screens/SettingsScreen.tsx')).length > 0,
    'FAILS when About promises an opt-out that does not exist',
  );
  assert(
    aboutUsageLineViolations(body, fileText('src/screens/SettingsScreen.tsx').split('aboutDialogBody').join('aboutBody')).length > 0,
    'FAILS when Settings stops rendering the About body',
  );
}

// ─── 8. the affiliate CTR pair ────────────────────────────────

function affiliateCtaTests(): void {
  console.log('\naffiliate CTA events (affiliate_cta_viewed / affiliate_cta_clicked)');
  assertEq(AFFILIATE_CTA_SURFACES.length, 5, 'five surfaces are enumerated');
  for (const surface of AFFILIATE_CTA_SURFACES) {
    assert(isAffiliateCtaSurface(surface), `${surface} is an enumerated surface`);
  }
  assert(!isAffiliateCtaSurface('invented_surface'), 'an invented surface is refused');
  assert(!isAffiliateCtaSurface(''), 'an empty surface is refused');

  // NO USER DATA: one prop, `surface`, and nothing else can ride the event.
  assertEq(JSON.stringify(affiliateCtaProps('find_piece')), '{"surface":"find_piece"}', 'the props are the surface alone');
  assertEq(JSON.stringify(affiliateCtaProps('piece_title' as any)), '{}', 'an unknown surface sends no props');
  const moduleSource = maskComments(fileText('src/services/affiliateCtaEvents.ts'));
  for (const leak of ['piece_id', 'composer', 'title', 'http', 'sheetmusicdirect']) {
    assert(!moduleSource.includes(leak), `the affiliate module never carries ${leak}`);
  }
  assertEq(affiliateCtaEventName('viewed'), 'affiliate_cta_viewed', 'the view event name');
  assertEq(affiliateCtaEventName('clicked'), 'affiliate_cta_clicked', 'the click event name');
  for (const name of ['affiliate_cta_viewed', 'affiliate_cta_clicked']) {
    assert(
      (ANALYTICS_EVENT_NAMES as readonly string[]).includes(name),
      `${name} is on the allowlist the server accepts`,
    );
  }
  assert(
    (ANALYTICS_PROP_KEYS as readonly string[]).includes('surface'),
    'surface is in the prop vocabulary',
  );

  // THE FUNNEL really emits the allowlisted name with the surface prop.
  resetAnalyticsForTests();
  configureAnalytics({ storage: fakeStorage(), baseUrl: 'https://example.test' });
  trackAffiliateCta('find_piece', 'clicked');
  trackAffiliateCta('cover_scan', 'viewed');
  const queued = pendingAnalyticsEvents();
  assertEq(queued.length, 2, 'both moments are queued');
  assertEq(queued[0].name, 'affiliate_cta_clicked', 'the click is queued under the allowlisted name');
  assertEq(queued[0].props.surface, 'find_piece', 'the click names its surface');
  assertEq(queued[1].name, 'affiliate_cta_viewed', 'the view is queued under the allowlisted name');
  assertEq(queued[1].props.surface, 'cover_scan', 'the view names its surface');
  assertEq(JSON.stringify(sanitizeAnalyticsProps(queued[0].props)), '{"surface":"find_piece"}', 'the queue holds no second key');
  resetAnalyticsForTests();

  // EVERY SURFACE IS HOSTED — the real tree passes, on both directions.
  const violations = affiliateCtaViolations(TREE);
  if (violations.length > 0) console.log('     ' + violations.join('\n     '));
  assertEq(violations.length, 0, 'every enumerated surface records both moments on a real money path');
  const strayIds = affiliateSurfaceIdViolations(TREE);
  if (strayIds.length > 0) console.log('     ' + strayIds.join('\n     '));
  assertEq(strayIds.length, 0, 'no call site invents a surface id');
  assertEq(AFFILIATE_CTA_CALL_SITES.length, 3, 'three rendering surfaces carry the call sites');
  assert(AFFILIATE_CTA_DOORS.length >= 4, 'the three doors are pinned to their callers');
}

function affiliateCtaMutationProbes(): void {
  console.log('\nmutation probes — each affiliate guard bites');

  // 1. the recognition card stops recording the TAP.
  const recognition = fileText('src/components/RecognitionResultView.tsx');
  const noRecognitionClick = recognition
    .split("trackAffiliateCta('recognition_result', 'clicked');")
    .join('');
  assert(noRecognitionClick !== recognition, 'probe: the recognition click call can be removed');
  assert(
    affiliateCtaViolations(withFile('src/components/RecognitionResultView.tsx', noRecognitionClick)).length > 0,
    'FAILS when the recognition result CTA stops recording taps',
  );

  // 2. the search section stops recording the VIEW.
  const section = fileText('src/components/SearchExternalSection.tsx');
  const noSectionView = section.split("trackAffiliateCta(surface, 'viewed');").join('');
  assert(noSectionView !== section, 'probe: the section view call can be removed');
  assert(
    affiliateCtaViolations(withFile('src/components/SearchExternalSection.tsx', noSectionView)).length > 0,
    'FAILS when the sheet-music section stops recording views',
  );

  // 3. the section's tap is left in a COMMENT only — not a call site at all.
  const commented = section
    .split("trackAffiliateCta(surface, 'clicked');")
    .join("// trackAffiliateCta(surface, 'clicked');");
  assert(
    affiliateCtaViolations(withFile('src/components/SearchExternalSection.tsx', commented)).length > 0,
    'FAILS when the section tap is commented out',
  );

  // 4. the zero-match CTA on Find-a-Piece goes uninstrumented.
  const findPiece = fileText('src/screens/FindPieceScreen.tsx');
  const noNoMatchView = findPiece.split("trackAffiliateCta('find_piece', 'viewed');").join('');
  assert(
    affiliateCtaViolations(withFile('src/screens/FindPieceScreen.tsx', noNoMatchView)).length > 0,
    'FAILS when the Find-a-Piece zero-match CTA stops recording views',
  );

  // 5. Home's door stops labelling its surface — every view would read as a plain search.
  const home = fileText('src/screens/HomeScreen.tsx');
  const noHomeDoor = home.split('entrySurface="home_front_door"').join('');
  assert(noHomeDoor !== home, 'probe: the Home door literal can be removed');
  assert(
    affiliateCtaViolations(withFile('src/screens/HomeScreen.tsx', noHomeDoor)).length > 0,
    'FAILS when the Home front door stops naming its surface',
  );

  // 6. the cover-scan money path stops labelling its surface.
  const scan = fileText('src/screens/ScanScoreScreen.tsx');
  const noScanDoor = scan.split('entrySurface="cover_scan"').join('');
  assert(noScanDoor !== scan, 'probe: the scan door literal can be removed');
  assert(
    affiliateCtaViolations(withFile('src/screens/ScanScoreScreen.tsx', noScanDoor)).length > 0,
    'FAILS when the cover-scan money path stops naming its surface',
  );

  // 7. the scanned viewer's door (the other half of the scan flow).
  const viewer = fileText('src/screens/ScannedViewerScreen.tsx');
  const noViewerDoor = viewer.split('entrySurface="cover_scan"').join('');
  assert(
    affiliateCtaViolations(withFile('src/screens/ScannedViewerScreen.tsx', noViewerDoor)).length > 0,
    'FAILS when the scanned viewer stops naming its surface',
  );

  // 8. a surface id nobody enumerated would land in the database ungroupable.
  const invented = findPiece.replace(
    "trackAffiliateCta('find_piece', 'clicked');",
    "trackAffiliateCta('invented_surface', 'clicked');",
  );
  assert(invented !== findPiece, 'probe: a stray surface id can be planted');
  assert(
    affiliateSurfaceIdViolations(withFile('src/screens/FindPieceScreen.tsx', invented)).length > 0,
    'FAILS when a call site invents a surface id',
  );

  // 9. the recognition card is no longer mounted anywhere.
  const tab = fileText('src/screens/HomeScreen.tsx').split('<RecognitionResultView').join('<Renamed');
  assert(
    affiliateCtaViolations(withFile('src/screens/HomeScreen.tsx', tab)).length > 0,
    'FAILS when the surface that records the event is never mounted',
  );

  // The real tree still passes after every probe.
  assertEq(affiliateCtaViolations(TREE).length, 0, 'the real tree still passes after the probes');
}

// ─── run ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('v47.2 — anonymous event logging: hosted call sites, one transport, no PII');
  allowlistTests();
  hostingTests();
  hostingMutationProbes();
  deniedKeyTests();
  endpointTests();
  purchaseTests();
  await queueTests();
  aboutLineTests();
  affiliateCtaTests();
  affiliateCtaMutationProbes();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
});
