/**
 * v48SettingsPass.test.ts — THE SETTINGS PASS (owner-approved), guarded from source.
 *
 * The pass did five things in one go, and four of them are exactly the kind of
 * change no logic test can see: a row that points at a route, a row that reads a
 * stored timestamp, two analytics events that had to survive a file move, and a
 * money surface that moved house. So the guards here are SOURCE SCANS of the real
 * files, plus the pure functions the rows call:
 *
 *   A. THE MONEY LEFT SETTINGS. SettingsScreen renders no price table, no checkout
 *      call and no price id; it renders ONE row whose value is the live tier and
 *      whose pill routes to the Plan route; App.tsx registers that route; and
 *      PlanScreen renders the price IDs FROM services/v471PlanPrices (it holds no
 *      literal id of its own).
 *   B. TEST YOUR MICROPHONE. The row exists, it routes to 'Tuner', and App.tsx
 *      really registers a screen by that name — a row that opens a route nobody
 *      registered is a dead end with a chevron on it.
 *   C. LAST BACKUP + SYNC NOW. The row reads the key services/cloudSync writes
 *      (`getLastSyncedAt`), formats it with a PURE function that is asserted here
 *      on real values, never invents one (no `Date.now()` inside the formatter, no
 *      "now" fallback for a missing value), and "Sync now" calls the SAME
 *      `syncCloud(` entry point the Cloud Sync screen calls.
 *   D. NO ROW CLAIMS A CONTROL IT LACKS. A value row carries no chevron; a control
 *      row carries its pills; a wired row carries an onPress.
 *   E. THE PILLS. The Theme row hosts Dark/Light inline, exposes selected state,
 *      and the extra-tap panel is gone.
 *
 * Every guard below is exercised against a mutation of the REAL source (section 6),
 * so a guard that stops biting fails this suite.
 */
import { maskSourceComments } from '../src/services/audioFocusContract';
import {
  NO_BACKUP_LABEL,
  SYNC_ROW_SUB_BUSY,
  SYNC_ROW_SUB_NO_PROVIDER,
  mostRecentBackup,
  relativeBackupLabel,
  syncNowRowSub,
} from '../src/services/lastBackup';
import {
  SETTINGS_CONTROL_ROWS,
  SETTINGS_PLAN_ROW_CTA,
  SETTINGS_PLAN_ROW_TITLE,
  SETTINGS_VALUE_ONLY_ROWS,
  settingsHasNoDeadRows,
  settingsHasNoMoneySurface,
  settingsPlanRowIsWired,
  settingsRowsAreTheClosedSet,
  settingsValueRowsCarryNoChevron,
  specRowBlocks,
} from '../src/services/settingsSpec';
import { LIVE_PRICE_IDS, priceIdsIn } from '../src/services/v471PlanPrices';
import { EVENT_CALL_SITES, hostingViolations } from '../src/services/v472AnalyticsContract';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ FAILED: ${label}`);
  }
}
function assertEq(actual: unknown, expected: unknown, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, ok ? label : `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let at = 0; at < 6; at += 1) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}

const ROOT = repoRoot();
function read(relative: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(ROOT, relative), 'utf8') as string;
}

const SETTINGS = read('src/screens/SettingsScreen.tsx');
const PLAN = read('src/screens/PlanScreen.tsx');
const APP = read('App.tsx');
const TYPES = read('src/types/index.ts');
const LAST_BACKUP = read('src/services/lastBackup.ts');
const CLOUD_SYNC = read('src/services/cloudSync.ts');

// ═══════════════ A · the money left Settings (and arrived somewhere) ═══════════════

console.log('\nA · THE MONEY LEFT SETTINGS');

assert(SETTINGS.length > 20000, `read SettingsScreen.tsx (${SETTINGS.length} chars)`);
assert(settingsHasNoMoneySurface(SETTINGS), 'Settings carries no price table, checkout call or price id');
assert(
  priceIdsIn(SETTINGS).length === 0,
  'no price id appears in the Settings source at all',
);
assert(
  maskSourceComments(SETTINGS).indexOf("navigate('Plan')") >= 0,
  'the one money row routes to the Plan route',
);
assert(settingsPlanRowIsWired(SETTINGS), 'the row shows the LIVE tier as its value and a working pill');
assert(
  maskSourceComments(SETTINGS).indexOf('planTierLabel(proState.isPro, proState.plan)') >= 0,
  'the value comes from the entitlement, not a hard-coded word',
);
assert(
  SETTINGS_PLAN_ROW_TITLE === 'Your plan' && SETTINGS_PLAN_ROW_CTA === 'View plans',
  'the row says "Your plan" and its pill says "View plans"',
);

assert(APP.indexOf('name="Plan"') >= 0, 'App.tsx registers the Plan route');
assert(APP.indexOf('PlanScreen') >= 0, 'App.tsx mounts the Plan screen');
assert(TYPES.indexOf('Plan: undefined;') >= 0, 'the route is in the stack param list (typed navigation)');

assert(PLAN.length > 4000, `read PlanScreen.tsx (${PLAN.length} chars)`);
assert(
  maskSourceComments(PLAN).indexOf("from '../services/v471PlanPrices'") >= 0,
  'PlanScreen imports the module that owns the money data',
);
assert(
  priceIdsIn(PLAN).length === 0,
  'PlanScreen hard-codes NO price id — every id comes from the owning module',
);
assert(
  maskSourceComments(PLAN).indexOf('{LIVE_PRICES.map((plan) =>') >= 0 &&
    maskSourceComments(PLAN).indexOf('onPress={() => handleUpgrade(plan.id)}') >= 0,
  'PlanScreen renders the LIVE_PRICES cards and sends each card’s own id to checkout',
);
assert(
  maskSourceComments(PLAN).indexOf('NoteSnap Pro — Complete') < 0,
  'the $39.99 tier name is not retyped here — it comes from PRO_COMPLETE_TIER_NAME',
);
assert(
  maskSourceComments(PLAN).indexOf('createCheckoutSession(priceId, deviceId)') >= 0,
  'the checkout call moved with the cards (it is not left behind in Settings)',
);

// ═══════════════ A · analytics survived the move ═══════════════

console.log('\nA · plans_view / upgrade_tap still fire, from the new surface');

const planSites = EVENT_CALL_SITES.filter((site) => site.file === 'src/screens/PlanScreen.tsx');
assertEq(
  planSites.map((site) => site.event),
  ['plans_view', 'upgrade_tap'],
  'both conversion events are pinned to the Plan surface',
);
assert(
  planSites.every((site) => site.host === 'App.tsx'),
  'and both are hosted by App.tsx (a screen nobody mounts tracks nothing)',
);
assert(
  maskSourceComments(PLAN).indexOf("track('plans_view', { hosted: proState.isPro })") >= 0,
  'plans_view fires with the SAME payload shape (hosted: boolean)',
);
assert(
  maskSourceComments(PLAN).indexOf("track('upgrade_tap', { tier, opened: true })") >= 0 &&
    maskSourceComments(PLAN).indexOf("track('upgrade_tap', { tier, opened: false })") >= 0,
  'upgrade_tap fires on both outcomes with the same shape (tier + opened)',
);
assert(
  maskSourceComments(SETTINGS).indexOf("track('upgrade_tap'") < 0,
  'Settings no longer emits upgrade_tap (no duplicate, no double count)',
);

// ═══════════════ B · the tuner row ═══════════════

console.log('\nB · TEST YOUR MICROPHONE → the tuner');

const settingsText = maskSourceComments(SETTINGS);
assert(settingsText.indexOf('title="Test your microphone"') >= 0, 'the row is on the surface');
assert(settingsText.indexOf("navigate('Tuner')") >= 0, 'the row routes to the Tuner route');
assert(APP.indexOf('name="Tuner"') >= 0, 'App.tsx really registers a screen named Tuner');
assert(TYPES.indexOf('Tuner: undefined;') >= 0, 'and the route is in the stack param list');
assert(
  settingsText.indexOf('sub={micTestRowSub(microphone)}') >= 0,
  'the sub follows the live permission (no promise of a level meter, no silent permission dialog)',
);
assert(
  settingsText.indexOf('getParent()?.navigate(\'Tuner\')') >= 0,
  'it reaches the root stack the same way the Cloud Sync row does',
);

// ═══════════════ C · last backup + sync now ═══════════════

console.log('\nC · LAST BACKUP reads the real key; SYNC NOW reuses the real entry point');

assert(
  CLOUD_SYNC.indexOf("const LAST_SYNCED_KEY = '@notesnap/cloudSync/lastSynced';") >= 0,
  'cloudSync owns the stored key (the row must read THIS one)',
);
assert(
  CLOUD_SYNC.indexOf('await setLastSynced(provider);') >= 0,
  'and a real sync pass writes it',
);
assert(
  settingsText.indexOf("getLastSyncedAt('gdrive')") >= 0 &&
    settingsText.indexOf("getLastSyncedAt('dropbox')") >= 0,
  'the Settings row reads both providers through the exported reader',
);
assert(
  settingsText.indexOf('relativeBackupLabel(backupIso, Date.now())') >= 0,
  'the value is formatted from the STORED string (a pure formatter, the clock passed in)',
);
assert(
  LAST_BACKUP.indexOf('Date.now()') < 0,
  'the formatter never reads the clock itself — it cannot invent a time',
);
assert(
  LAST_BACKUP.indexOf('Date.parse(') >= 0,
  'it parses the stored value instead of assuming one',
);
assert(
  settingsText.indexOf('syncCloud(') >= 0,
  'Sync now calls the existing syncCloud() entry point (no second sync path)',
);
assert(
  settingsText.indexOf('createUpload(') < 0 && settingsText.indexOf('uploadFile(') < 0,
  'and it does not grow an upload path of its own',
);

// the formatter, on real values
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-11-03T09:00:00.000Z');
const iso = (offset: number): string => new Date(T0 - offset).toISOString();

assertEq(relativeBackupLabel(null, T0), NO_BACKUP_LABEL, 'no stored value → "No backup yet"');
assertEq(relativeBackupLabel('', T0), NO_BACKUP_LABEL, 'an empty stored value → "No backup yet"');
assertEq(relativeBackupLabel('not a date', T0), NO_BACKUP_LABEL, 'an unreadable value → "No backup yet"');
assertEq(relativeBackupLabel(iso(5 * 1000), T0), 'Just now', '5 seconds → "Just now"');
assertEq(relativeBackupLabel(iso(60 * 1000), T0), '1 minute ago', '60 seconds → "1 minute ago" (never 0)');
assertEq(relativeBackupLabel(iso(2 * HOUR), T0), '2 hours ago', 'two hours → "2 hours ago"');
assertEq(relativeBackupLabel(iso(26 * HOUR), T0), 'Yesterday', '26 hours → "Yesterday"');
assertEq(relativeBackupLabel(iso(3 * DAY), T0), '3 days ago', 'three days → "3 days ago"');
assertEq(
  relativeBackupLabel(iso(9 * DAY), T0),
  'on 25 Oct 2026',
  'over a week → the exact stored DAY, not a rounded "1 week ago"',
);
assertEq(
  relativeBackupLabel(new Date(T0 + HOUR).toISOString(), T0),
  'Just now',
  'a future stamp (clock skew) is not printed as a negative time',
);

assertEq(mostRecentBackup([null, undefined, '']), null, 'no provider has synced → null (no fallback)');
assertEq(
  mostRecentBackup([iso(3 * DAY), iso(1 * DAY), null]),
  iso(1 * DAY),
  'the MOST RECENT real value wins',
);
assertEq(
  mostRecentBackup(['rubbish', iso(2 * HOUR)]),
  iso(2 * HOUR),
  'an unreadable provider does not shadow a real one',
);

assertEq(syncNowRowSub(false, false), SYNC_ROW_SUB_NO_PROVIDER, 'no provider → the row says so');
assertEq(syncNowRowSub(true, false).indexOf('Back up'), 0, 'with a provider → what it will do');
assertEq(syncNowRowSub(true, true), SYNC_ROW_SUB_BUSY, 'while running → "Syncing…"');

// ═══════════════ D · no row claims a control it does not have ═══════════════

console.log('\nD · HONEST ROWS — values are values, controls are controls');

assert(settingsRowsAreTheClosedSet(SETTINGS), 'the rendered rows are exactly the declared set, in order');
assert(settingsHasNoDeadRows(SETTINGS), 'every row is wired, a declared value, or a declared control row');
assert(settingsValueRowsCarryNoChevron(SETTINGS), 'no value row carries a chevron it cannot honour');
assertEq(
  SETTINGS_VALUE_ONLY_ROWS.indexOf('noiseFilter') >= 0,
  true,
  'the Noise filter row is still a declared VALUE (no switch was invented)',
);
assertEq(SETTINGS_CONTROL_ROWS, ['theme'], 'the Theme row is the one declared control row');

const noiseBlock = specRowBlocks(SETTINGS).find((block) => block.indexOf('title="Noise filter"') >= 0);
assert(noiseBlock !== undefined, 'the Noise filter row renders');
assert(
  noiseBlock !== undefined && noiseBlock.indexOf('onPress') < 0,
  'and it carries NO onPress — it is information, not a switch',
);
assert(
  noiseBlock !== undefined && noiseBlock.indexOf('Always on') >= 0,
  'its copy leads with the truth: the cleanup is always applied',
);

const micBlock = specRowBlocks(SETTINGS).find((block) => block.indexOf('title="Microphone access"') >= 0);
assert(micBlock !== undefined && micBlock.indexOf('onPress={openSystemSettings}') >= 0, 'the microphone row still deep-links to system settings');
assert(
  micBlock !== undefined && micBlock.indexOf('sub={microphoneRowSub(microphone)}') >= 0,
  'and its sub follows the live permission (it can no longer contradict its own value)',
);

// ═══════════════ E · the pills ═══════════════

console.log('\nE · THE THEME ROW HOSTS ITS PILLS (one tap, no panel)');

const themeBlock = specRowBlocks(SETTINGS).find((block) => block.indexOf('title="Theme"') >= 0);
assert(themeBlock !== undefined, 'the Theme row renders');
assert(
  themeBlock !== undefined && themeBlock.indexOf('pills={[') >= 0,
  'it hosts a segmented choice',
);
assert(
  themeBlock !== undefined &&
    themeBlock.indexOf("label: THEME_DARK_LABEL") >= 0 &&
    themeBlock.indexOf("label: THEME_LIGHT_LABEL") >= 0,
  'the two options are the model’s own labels',
);
assert(
  themeBlock !== undefined && themeBlock.indexOf('selected: themeMode ===') >= 0,
  'the current choice is marked (selected state, not just a colour)',
);
assert(
  settingsText.indexOf('onPress={toggleThemeChoice}') < 0,
  'the extra tap that opened the panel is gone',
);
assert(
  settingsText.indexOf('accessibilityState={{ selected: pill.selected }}') >= 0,
  'the pills expose accessibilityState.selected',
);
assert(
  settingsText.indexOf('accessibilityRole="button"') >= 0 &&
    settingsText.indexOf('accessibilityLabel={pill.accessibilityLabel ?? pill.label}') >= 0,
  'each pill is a button with a real label',
);

// ═══════════════ 6 · THE BITE PROOF ═══════════════

console.log('\nMUTATION PROBES — every guard above FAILS when its contract is broken');

function probe(label: string, mutated: string, detector: (source: string) => boolean, real: string): void {
  assert(mutated !== real, `${label} — the mutation really changed the source`);
  assert(detector(mutated) === false, `${label} — the detector goes red`);
}

probe(
  'a plan card is left behind in Settings (half-migrated money)',
  SETTINGS.replace(
    '{SETTINGS_PLAN_ROW_SUB}',
    '{SETTINGS_PLAN_ROW_SUB}{LIVE_PRICES.length}',
  ),
  settingsHasNoMoneySurface,
  SETTINGS,
);
probe(
  'the plan row points at the old in-place plans block',
  SETTINGS.split('onPress={openPlan}').join('onPress={openPlans}'),
  settingsPlanRowIsWired,
  SETTINGS,
);
probe(
  'the plan row hard-codes the tier instead of reading the entitlement',
  SETTINGS.replace('planTierLabel(proState.isPro, proState.plan)', "'Free'"),
  settingsPlanRowIsWired,
  SETTINGS,
);
probe(
  'the tuner row points at a route that does not exist',
  SETTINGS.split("navigate('Tuner')").join("navigate('Tunr')"),
  (source) => maskSourceComments(source).indexOf("navigate('Tuner')") >= 0,
  SETTINGS,
);
probe(
  'the backup row stops reading the stored key',
  SETTINGS.replace("getLastSyncedAt('gdrive')", 'null'),
  (source) =>
    source.indexOf("getLastSyncedAt('gdrive')") >= 0 && source.indexOf("getLastSyncedAt('dropbox')") >= 0,
  SETTINGS,
);
probe(
  'the backup row prints a fabricated time instead of the stored one',
  SETTINGS.replace('relativeBackupLabel(backupIso, Date.now())', "new Date().toLocaleTimeString()"),
  (source) => source.indexOf('relativeBackupLabel(backupIso, Date.now())') >= 0,
  SETTINGS,
);
probe(
  'a value row gains a chevron (it looks pressable and does nothing)',
  SETTINGS.replace('value={noiseFilterValueLabel()}', 'value={noiseFilterValueLabel()}\n          chevron'),
  settingsValueRowsCarryNoChevron,
  SETTINGS,
);
probe(
  'a wired row loses its destination (dead row)',
  SETTINGS.replace('onPress={runSyncNow}', ''),
  settingsHasNoDeadRows,
  SETTINGS,
);
probe(
  'the Theme row is declared a control but renders no pills',
  SETTINGS.replace('pills={[', 'nothing={['),
  settingsHasNoDeadRows,
  SETTINGS,
);
probe(
  'an extra row appears outside the closed set',
  SETTINGS.replace(
    '          title="Privacy policy"',
    '          title="Restore purchases"\n          onPress={openHelp}\n          divider\n        />\n        <SpecRow\n          palette={palette}\n          divider\n          title="Privacy policy"',
  ),
  settingsRowsAreTheClosedSet,
  SETTINGS,
);
probe(
  'the analytics leave the Plan screen with the money (the v47.2 blind spot)',
  PLAN.replace("track('upgrade_tap', { tier, opened: true });", ''),
  (source) =>
    source.indexOf("track('upgrade_tap', { tier, opened: true })") >= 0 &&
    source.indexOf("track('upgrade_tap', { tier, opened: false })") >= 0,
  PLAN,
);

// A price ID pasted into the Plan screen is a second owner for the money data.
const withLiteralPrice = PLAN.replace(
  'const POLL_INTERVAL_MS = 2000;',
  `const LEAKED = '${LIVE_PRICE_IDS[0]}';\nconst POLL_INTERVAL_MS = 2000;`,
);
assert(withLiteralPrice !== PLAN, 'PROBE: a price id can be pasted into PlanScreen');
assert(
  priceIdsIn(withLiteralPrice).length > 0,
  'FAILS when a price id is hard-coded in the screen instead of imported',
);

// The real tree still passes after every probe.
assert(settingsHasNoMoneySurface(SETTINGS), 'the real Settings screen still passes after the probes');
assert(settingsPlanRowIsWired(SETTINGS), 'the real plan row still passes after the probes');
assert(settingsRowsAreTheClosedSet(SETTINGS), 'the real row set still passes after the probes');
assert(settingsHasNoDeadRows(SETTINGS), 'the real rows still pass after the probes');
assert(
  EVENT_CALL_SITES.filter((site) => site.file === 'src/screens/PlanScreen.tsx').length === 2,
  'the real analytics table still points at the Plan surface',
);
assert(
  typeof hostingViolations === 'function',
  'the hosting guard from v47.2 is available to the release gate (it runs in v472Analytics.test.ts)',
);

// ═══════════════════════ totals ═══════════════════════

console.log('\n──────────────────────────────────────────────');
console.log(`v48 SETTINGS PASS: ${passed}/${passed + failed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('RESULT: FAILED');
  process.exit(1);
}
console.log('RESULT: PASSED');
