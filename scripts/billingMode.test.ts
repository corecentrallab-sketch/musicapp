/**
 * billingMode.test.ts — BILLING MODE OFF MUST BE A PROPERTY OF THE BUILD, NOT OF
 * A RENDER PATH.
 *
 * WHY (2026-11-04, closed-test build): Google Play's payments policy requires
 * Play Billing for digital goods sold inside an Android app. NoteSnap has been
 * selling Pro through Stripe Checkout inside the app, and the Play Billing
 * replacement needs Play Console products + service-account credentials that do
 * not exist yet. So the closed test ships with NO purchase surface at all —
 * which is also the cleanest policy position: there is nothing for a reviewer to
 * find, because there is nothing for sale.
 *
 * WHAT THIS SUITE PROVES — and every one of these is checked against the REAL
 * files in this repo, then re-checked against a hand-mutated copy so a guard that
 * has stopped biting fails the gate instead of quietly passing:
 *
 *   1. THE SWITCH is one build-time boolean in one module, and it is OFF.
 *   2. THE CHECKOUT CALL refuses before it touches the network — inside
 *      `createCheckoutSession`, the only function that knows the endpoint — and
 *      the endpoint literal exists in exactly one other place: the pure guard
 *      module that pins it. No module may build that URL for itself.
 *   3. THE SETTINGS SURFACE: the "NoteSnap Pro / View plans" row is rendered
 *      only inside the gate (absent, not disabled), the plans block is opened
 *      through a value derived from the constant (so no setter can force it), and
 *      the checkout call has exactly one call site.
 *   4. THE QUOTA-EXHAUSTED MODAL can only offer an upgrade through a gate — one
 *      gate around the selling sentence, one around the buttons, both after the
 *      honest line — and the handler HomeScreen passes is undefined when billing
 *      is off.
 *   5. THE FREE-LIMIT SENTENCE that ships with billing off sells nothing and says
 *      when the allowance returns; the billing-on sentence still names the
 *      upgrade (existing behaviour unchanged).
 *   6. NOTHING ELSE MOVED: the 5-recognitions-a-month cap is exactly what it was
 *      (FREE_MONTHLY_LIMIT === 5, same arithmetic), and the price table module is
 *      untouched (three live AUD one-time prices) — the brief said leave it in
 *      place for the Play-product repoint.
 *
 * Plain Node, no react-native, no network. Run with `npm run test:tier1`.
 */
import { BILLING_DISABLED_MESSAGE, BILLING_ENABLED } from '../src/services/billingMode';
import {
  CHECKOUT_API_PATH,
  CHECKOUT_ENDPOINT,
  billingIsOff,
  billingModeContractHolds,
  billingSwitchIsABuildTimeConstant,
  checkoutCallIsBillingGated,
  checkoutEndpointIsOnlyInApi,
  freeLimitCopyIsPurchaseFree,
  limitStateOffersNoPurchase,
  maskComments,
  settingsPurchaseSurfaceIsGated,
} from '../src/services/billingModeGuard';
import { FREE_MONTHLY_LIMIT, freeListensLeft } from '../src/services/frontDoor';
import { LIVE_PRICES, livePriceSetIsTheStripeAccount } from '../src/services/v471PlanPrices';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error('FAIL: ' + label);
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  assert(
    actual === expected,
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

/** Repo root — the gate is run from there (`node /tmp/tier1-test/scripts/...`). */
function repoRoot(): string {
  const path = require('path');
  return path.resolve(process.cwd());
}

/** One repo file, by path relative to the root. */
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

/** Every non-test .ts/.tsx under src/ — the scan that makes guard 2 real. */
function walkSrc(dir: string, out: string[]): void {
  const fs = require('fs');
  const path = require('path');
  const entries = fs.readdirSync(dir, { withFileTypes: true }) as ReadonlyArray<{
    name: string;
    isDirectory(): boolean;
  }>;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSrc(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.ts$/.test(entry.name)) continue;
    out.push(full);
  }
}

function srcEntries(): Array<{ path: string; source: string }> {
  const path = require('path');
  const root = repoRoot();
  const files: string[] = [];
  walkSrc(path.join(root, 'src'), files);
  return files.map((full) => {
    const rel = full.slice(root.length + 1).split(path.sep).join('/');
    return { path: rel, source: readAppFile(rel) };
  });
}

// ── The real files this build ships ────────────────────────────────────────────
const MODE_PATH = 'src/services/billingMode.ts';
const SETTINGS_PATH = 'src/screens/SettingsScreen.tsx';
const VIEW_PATH = 'src/components/RecognitionResultView.tsx';
const HOME_PATH = 'src/screens/HomeScreen.tsx';

const modeSource = readAppFile(MODE_PATH);
const apiSource = readAppFile(CHECKOUT_API_PATH);
const settingsSource = readAppFile(SETTINGS_PATH);
const viewSource = readAppFile(VIEW_PATH);
const homeSource = readAppFile(HOME_PATH);
const entries = srcEntries();

// ── 1. THE SWITCH ──────────────────────────────────────────────────────────────
assert(
  billingSwitchIsABuildTimeConstant(modeSource),
  '1. the switch is one plain build-time boolean (`export const BILLING_ENABLED: boolean = …`)',
);
assert(!/process\.env/.test(modeSource), '1b. the switch is not an environment read');
assert(
  modeSource.indexOf('Play Billing') > 0 && modeSource.indexOf('Flip this to') > 0,
  '1c. the module states WHY it exists and WHAT turns it back on',
);
assertEq(BILLING_ENABLED, false, '1d. THIS build ships with billing OFF');
assert(billingIsOff(), '1e. billingIsOff() agrees with the constant');
assert(
  BILLING_DISABLED_MESSAGE.indexOf('$') < 0 && !/upgrade|buy|subscribe/i.test(BILLING_DISABLED_MESSAGE),
  '1f. even the internal refusal message sells nothing',
);

// ── 2. THE CHECKOUT PATH IS UNREACHABLE ────────────────────────────────────────
assert(
  checkoutCallIsBillingGated(apiSource),
  '2. createCheckoutSession throws on !BILLING_ENABLED BEFORE it builds the request',
);
assert(
  apiSource.indexOf('if (!BILLING_ENABLED)') < apiSource.indexOf(CHECKOUT_ENDPOINT),
  '2b. the refusal is written above the endpoint in the file, not after it',
);
assert(
  checkoutEndpointIsOnlyInApi(entries),
  '2c. the Stripe endpoint literal exists only in api.ts (and the pure guard module that pins it)',
);
assert(
  checkoutEndpointIsOnlyInApi([{ path: CHECKOUT_API_PATH, source: apiSource }]),
  '2d. the scan passes when api.ts is the only holder',
);
assert(
  !checkoutEndpointIsOnlyInApi([
    { path: CHECKOUT_API_PATH, source: apiSource },
    { path: 'src/services/retryHelper.ts', source: "await fetch('/api/create-checkout-session');" },
  ]),
  '2e. MUTATION: a second module naming the endpoint fails the scan',
);
assert(
  !checkoutEndpointIsOnlyInApi([{ path: 'src/services/other.ts', source: 'export const x = 1;' }]),
  '2f. MUTATION: a scan that cannot find api.ts at all fails (no silent pass)',
);

// the gate removed entirely
const gateRemoved = apiSource.replace(
  'if (!BILLING_ENABLED) {\n    throw new Error(BILLING_DISABLED_MESSAGE);\n  }\n',
  '',
);
assert(gateRemoved !== apiSource, '2g. the probe really removed the refusal block');
assert(!checkoutCallIsBillingGated(gateRemoved), '2h. MUTATION: no refusal → guard 2 fails');

// the gate moved BELOW the request (the classic "check after the call" bug)
const gateMoved = [
  'export async function createCheckoutSession(priceId: string, deviceId: string): Promise<string> {',
  "  const response = await fetch(`${BASE_URL}" + CHECKOUT_ENDPOINT + "`, { method: 'POST' });",
  '  if (!BILLING_ENABLED) { throw new Error(BILLING_DISABLED_MESSAGE); }',
  '  return response;',
  '}',
].join('\n');
assert(
  !checkoutCallIsBillingGated(gateMoved),
  '2i. MUTATION: a gate placed after the fetch fails guard 2',
);

// a commented-out gate must not satisfy the guard
const gateCommented = apiSource.replace(
  'if (!BILLING_ENABLED) {',
  '// if (!BILLING_ENABLED) {',
);
assert(
  !checkoutCallIsBillingGated(gateCommented),
  '2j. MUTATION: commenting the gate out fails guard 2 (comments are masked)',
);
assert(
  maskComments('// ' + CHECKOUT_ENDPOINT).indexOf(CHECKOUT_ENDPOINT) < 0,
  '2k. a needle inside a line comment is masked',
);
assert(
  maskComments('/* ' + CHECKOUT_ENDPOINT + ' */').indexOf(CHECKOUT_ENDPOINT) < 0,
  '2l. a needle inside a block comment is masked',
);
assert(
  maskComments("const u = 'https://example.test/api';").indexOf('https://example.test/api') >= 0,
  '2m. …but a real https URL is NOT eaten by the comment masker',
);

// no Stripe URL is opened anywhere in src/
for (const entry of entries) {
  const text = maskComments(entry.source);
  assert(
    text.indexOf('buy.stripe.com') < 0 && text.indexOf('checkout.stripe.com') < 0,
    `2n. no Stripe URL literal in ${entry.path}`,
  );
}

// ── 3. THE SETTINGS PURCHASE SURFACE ───────────────────────────────────────────
assert(
  settingsPurchaseSurfaceIsGated(settingsSource),
  '3. the Pro row is gated and the plans block is derived from the ONE constant',
);
assert(
  settingsSource.indexOf("from '../services/billingMode'") >= 0,
  '3b. Settings reads the switch from the module that owns it',
);
assert(
  !/const\s+BILLING_ENABLED\s*=/.test(settingsSource),
  '3c. Settings holds no local copy of the switch',
);
assert(
  settingsSource.indexOf('{BILLING_ENABLED && (') < settingsSource.indexOf('styles.proRow'),
  '3d. the gate opens BEFORE the Pro row is written',
);
assert(
  settingsSource.indexOf('const plansOpen = BILLING_ENABLED && plansOpenRequested;') >= 0,
  '3e. the plans block cannot be opened while billing is off',
);
assert(
  settingsSource.split('createCheckoutSession(').length - 1 === 1,
  '3f. exactly one checkout call site in Settings (the plan card)',
);

const plansUngated = settingsSource.replace(
  'const plansOpen = BILLING_ENABLED && plansOpenRequested;',
  'const plansOpen = plansOpenRequested;',
);
assert(plansUngated !== settingsSource, '3g. the probe really ungated the plans block');
assert(
  !settingsPurchaseSurfaceIsGated(plansUngated),
  '3h. MUTATION: an ungated plans block fails guard 3',
);

const rowUngated = settingsSource.replace(
  '{BILLING_ENABLED && (\n      <Pressable\n        style={[styles.proRow',
  '<Pressable\n        style={[styles.proRow',
);
assert(rowUngated !== settingsSource, '3i. the probe really ungated the Pro row');
assert(
  !settingsPurchaseSurfaceIsGated(rowUngated),
  '3j. MUTATION: an ungated Pro row fails guard 3',
);

const localCopy = settingsSource + '\nconst BILLING_ENABLED = false;\n';
assert(
  !settingsPurchaseSurfaceIsGated(localCopy),
  '3k. MUTATION: a second, local switch in the screen fails guard 3',
);

// ── 4. THE QUOTA-EXHAUSTED MODAL ───────────────────────────────────────────────
assert(
  limitStateOffersNoPurchase(viewSource),
  '4. the limit modal offers an upgrade only through the gate, after the honest line',
);
assert(
  viewSource.indexOf('{phase.message}') > 0,
  '4b. the modal always shows the limit sentence the caller supplied',
);
assert(
  homeSource.indexOf('onUpgrade={BILLING_ENABLED ? handleUpgradePro : undefined}') >= 0,
  '4c. HomeScreen passes NO upgrade handler while billing is off',
);

const copyUngated = viewSource.replace('{BILLING_ENABLED && (', '{(true) && (');
assert(copyUngated !== viewSource, '4d. the probe really ungated the selling sentence');
assert(
  !limitStateOffersNoPurchase(copyUngated),
  '4e. MUTATION: an ungated "Upgrade to Pro" sentence fails guard 4',
);

const buttonsUngated = viewSource.replace('{BILLING_ENABLED ? (', '{true ? (');
assert(buttonsUngated !== viewSource, '4f. the probe really ungated the buttons');
assert(
  !limitStateOffersNoPurchase(buttonsUngated),
  '4g. MUTATION: an ungated "View Pro Options" button fails guard 4',
);

// ── 5. THE FREE-LIMIT SENTENCE ─────────────────────────────────────────────────
assert(
  freeLimitCopyIsPurchaseFree(apiSource),
  '5. the billing-off limit sentence sells nothing and says when the allowance returns',
);
assert(
  apiSource.indexOf('function freeLimitMessage(') > 0 &&
    apiSource.indexOf('if (!BILLING_ENABLED) return FREE_LIMIT_MESSAGE;') > 0,
  '5b. the server’s own 429 wording is NOT passed through while billing is off',
);
assertEq(
  apiSource.split('freeLimitMessage(errBody?.error)').length - 1,
  2,
  '5c. both 429 paths (unreadable body and readable body) use the gated sentence',
);

const sellingOff = apiSource.replace(
  'Your free allowance resets next month.',
  'Upgrade to Pro to keep recognising next month.',
);
assert(sellingOff !== apiSource, '5d. the probe really put a purchase offer in the off sentence');
assert(
  !freeLimitCopyIsPurchaseFree(sellingOff),
  '5e. MUTATION: a selling word in the billing-off sentence fails guard 5',
);

// ── 6. NOTHING ELSE MOVED ──────────────────────────────────────────────────────
assertEq(FREE_MONTHLY_LIMIT, 5, '6. the free cap is still FIVE recognitions a month');
assertEq(freeListensLeft(0), 5, '6b. a fresh account still has 5 listens');
assertEq(freeListensLeft(4), 1, '6c. the counter arithmetic is untouched');
assertEq(freeListensLeft(5), 0, '6d. the cap clamps at zero, not below');
assertEq(freeListensLeft(9), 0, '6e. over-use still cannot go negative');
assertEq(LIVE_PRICES.length, 3, '6f. v471PlanPrices still holds the three tiers');
assert(livePriceSetIsTheStripeAccount(), '6g. …still the three live AUD one-time prices');

// ── 7. THE WHOLE CONTRACT, ONE CALL ────────────────────────────────────────────
assert(
  billingModeContractHolds({ api: apiSource, settings: settingsSource, resultView: viewSource, otherSources: entries }),
  '7. the full billing-off contract holds on the files this build ships',
);

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
