/**
 * v47.1 PART A · ITEM 1 — EVERY UPGRADE TAP MUST OPEN CHECKOUT (release-gate FAIL).
 *
 * THE DEFECT: the Settings plan cards hardcoded three Stripe price IDs that no
 * longer exist on the live account, so Stripe answered "No such price" and every
 * upgrade tap in the closed test ended in a "Checkout Error" alert. The copy also
 * sold a billing model the account does not have ("/ month", "/ year", "billed
 * annually", "Save 33% vs monthly", a "Subscribe" button, "Your subscription is
 * active") while all three live prices are `type: one_time`.
 *
 * WHAT THIS SUITE PROVES (source text, so it bites without a recompile):
 *   1. the live table is exactly the three AUD one-time prices the owner read from
 *      Stripe on 10-30 — ids and amounts, in order;
 *   2. no dead `price_1U3SE…` ID survives ANYWHERE in `src/` (a walk with a file
 *      floor), and every `price_…` literal in `src/` is one of the three live ones;
 *   3. the plan/paywall copy carries no billing period, no subscription word and no
 *      trial — scanned over the strings the cards RENDER, plus the screen itself;
 *   4. the cards are HOSTED by SettingsScreen (rendered inside the plans block,
 *      with the shared CTA / Billing notes / post-purchase line), not merely
 *      defined somewhere — the v46 lesson;
 *   5. mutation probes: each guard fails when the real bytes are broken in memory,
 *      and passes again on the restored text.
 *
 * Plain Node, no react-native, no network. Run with `npm run test:tier1`.
 */
import {
  BANNED_BILLING_COPY,
  BILLING_NOTES,
  DEAD_PRICE_ID_COUNT,
  DEAD_PRICE_ID_PREFIX,
  LIVE_PRICES,
  LIVE_PRICE_IDS,
  PLAN_CTA_LABEL,
  PLAN_SECTION_SUBTITLE,
  PRO_COMPLETE_TIER_NAME,
  PURCHASE_DONE_BODY,
  PURCHASE_DONE_TITLE,
  billingCopyViolations,
  completeTierNameIsOwnerChoice,
  deadPriceIdsIn,
  livePriceSetIsTheStripeAccount,
  planCopyIsHonest,
  planFlowCopy,
  priceIdsAreAllLive,
  priceIdsIn,
  settingsHasNoBillingPeriodCopy,
  settingsHostsPlanCards,
} from '../src/services/v471PlanPrices';

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
  const ok = actual === expected;
  if (!ok) {
    console.log(`     expected ${String(expected)}, got ${String(actual)}`);
  }
  assert(ok, label);
}

// ─── helpers ────────────────────────────────────────────────────

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
  throw new Error(
    'could not find the repo root from ' +
      process.cwd() +
      ' — run this suite with `npm run test:tier1` from the repo root',
  );
}

function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

/** Every `.ts`/`.tsx` file under `src/`, recursively — the scan's real surface. */
function walkSrc(): string[] {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(repoRoot(), 'src');
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir) as string[]) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        visit(full);
      } else if (/\.tsx?$/.test(entry)) {
        found.push(full);
      }
    }
  };
  visit(root);
  return found;
}

const SETTINGS_PATH = 'src/screens/SettingsScreen.tsx';
const PRICES_PATH = 'src/services/v471PlanPrices.ts';

const SETTINGS = readAppFile(SETTINGS_PATH);
const PRICES = readAppFile(PRICES_PATH);

/**
 * THE PRE-FIX FIXTURE — the plan table exactly as it shipped before this fix
 * (dead IDs + the monthly/yearly copy). It is asserted to FAIL the guards, so the
 * guards cannot be satisfied by a vacuous scan.
 */
const PRE_FIX_PLAN_TABLE = `const PLANS: Plan[] = [
  {
    id: 'price_1U3SEFBbnDObsY4ujb2zxBSs', // NoteSnap Pro — Monthly $4.99
    name: 'Pro Monthly',
    price: '$4.99 / month',
    feature:
      '✓ Unlimited recognitions\\n✓ Grade/difficulty levels\\n✓ Advanced recommendations\\n✓ Custom app skins\\n✓ Cloud sync & sharing\\n✓ No ads anywhere',
  },
  {
    id: 'price_1U3SEKBbnDObsY4usDGDFNPQ', // NoteSnap Pro — Yearly $39.99
    name: 'Pro Yearly',
    price: '$39.99 / year',
    savings: 'Save 33% vs monthly',
    feature: 'All Pro features, billed annually.',
    highlight: true,
  },
  {
    id: 'price_1U3SEKBbnDObsY4uVrnJDIyg', // NoteSnap Family/Teacher $9.99
    name: 'Family / Teacher',
    price: '$9.99 / month',
    feature: '✓ Up to 5 accounts',
  },
];`;

/** The pre-fix success alert and the pre-fix Subscribe button, verbatim. */
const PRE_FIX_ALERT = `Alert.alert('Welcome to Pro!', 'Your subscription is active. Enjoy unlimited recognitions.');`;
const PRE_FIX_CTA = `Subscribe`;
const PRE_FIX_RENEWS = `Renews {new Date(proState.currentPeriodEnd).toLocaleDateString()}`;

// ─── 1. the live table ─────────────────────────────────────────

function liveTableTests(): void {
  console.log('\n1. THE LIVE TABLE — the three AUD one-time prices, read from Stripe 10-30');
  assertEq(LIVE_PRICES.length, 3, 'exactly three live prices (the account holds three, has_more: false)');
  assertEq(livePriceSetIsTheStripeAccount(), true, 'the table IS the account: ids and amounts, in order');
  assertEq(LIVE_PRICE_IDS.length, 3, 'three distinct price IDs');
  assertEq(
    LIVE_PRICE_IDS[0],
    'price_1TwbqHReFDEYPfXjxq8vMcdV',
    'Pro = price_1TwbqHReFDEYPfXjxq8vMcdV ($4.99 AUD)',
  );
  assertEq(
    LIVE_PRICE_IDS[1],
    'price_1TwbqHReFDEYPfXjLTbo7zgH',
    'NoteSnap Pro — Complete = price_1TwbqHReFDEYPfXjLTbo7zgH ($39.99 AUD)',
  );
  assertEq(
    LIVE_PRICE_IDS[2],
    'price_1TwbqHReFDEYPfXj0oIi8bGt',
    'Family / Teacher = price_1TwbqHReFDEYPfXj0oIi8bGt ($9.99 AUD)',
  );
  assertEq(LIVE_PRICES[0].amountAud, 4.99, 'the Pro price is $4.99');
  assertEq(LIVE_PRICES[1].amountAud, 39.99, 'the NoteSnap Pro — Complete price is $39.99');
  assertEq(LIVE_PRICES[2].amountAud, 9.99, 'the Family / Teacher price is $9.99');

  // The tier NAMES describe the tier, never a billing period.
  for (const price of LIVE_PRICES) {
    assert(
      billingCopyViolations([price.name]).length === 0,
      `the tier name "${price.name}" carries no billing period`,
    );
    assert(
      price.priceLabel.indexOf('AUD') >= 0,
      `the price label "${price.priceLabel}" states the currency`,
    );
    assert(
      /one-time/i.test(price.priceLabel),
      `the price label "${price.priceLabel}" says ONE-TIME`,
    );
  }
  assertEq(
    LIVE_PRICES[1].name.indexOf('year') < 0,
    true,
    'the $39.99 tier is NOT labelled as a year of anything',
  );

  // THE OWNER'S LABEL, PINNED EXACTLY (ruling 2026-10-30): the $39.99 one-time tier
  // is "NoteSnap Pro — Complete" — em dash, no period, no savings claim. The string
  // is asserted here as a LITERAL so a reword in the module cannot pass silently.
  assertEq(
    PRO_COMPLETE_TIER_NAME,
    'NoteSnap Pro — Complete',
    'the $39.99 tier name is exactly "NoteSnap Pro — Complete" (owner 10-30)',
  );
  assertEq(
    LIVE_PRICES[1].name,
    'NoteSnap Pro — Complete',
    'the card renders that exact name (LIVE_PRICES[1].name)',
  );
  assertEq(
    completeTierNameIsOwnerChoice(),
    true,
    'completeTierNameIsOwnerChoice() agrees the $39.99 tier carries the owner’s name',
  );
  assertEq(
    /\b(month|year|annual|save|subscription)\b/i.test(LIVE_PRICES[1].name),
    false,
    'the $39.99 tier name carries no period word and no savings claim',
  );
}

// ─── 2. the copy ───────────────────────────────────────────────

function copyTests(): void {
  console.log('\n2. THE COPY — one-time, never a period / subscription / trial');
  const copy = planFlowCopy();
  assert(copy.length >= 15, `the scan reads the strings the cards render (${copy.length} strings)`);
  assertEq(billingCopyViolations(copy).join(','), '', 'no banned phrase in any rendered plan string');
  assertEq(planCopyIsHonest(), true, 'planCopyIsHonest() agrees');
  assertEq(PLAN_CTA_LABEL, 'Buy once', 'the card CTA is a purchase ("Buy once"), not a subscription');
  assert(PLAN_SECTION_SUBTITLE.indexOf('month') >= 0, 'the free tier is still described honestly (5 a month)');
  assert(
    PURCHASE_DONE_BODY.indexOf('one-time') >= 0,
    'the post-purchase line says the purchase was one-time',
  );
  assert(
    !/subscription|is active/i.test(PURCHASE_DONE_TITLE + ' ' + PURCHASE_DONE_BODY),
    'the post-purchase line never claims a subscription is active',
  );
  assertEq(BILLING_NOTES.length, 3, 'three honest Billing bullets');
  assert(
    BILLING_NOTES[0].indexOf('nothing recurs') >= 0,
    'the Billing card says the payment does not recur',
  );

  // Every banned phrase the brief names is actually in the list.
  const required = [
    '/mo',
    'per month',
    'monthly',
    'yearly',
    'billed annually',
    'subscription',
    'subscribe',
    'free trial',
    'trial available',
  ];
  for (const phrase of required) {
    assertEq(
      BANNED_BILLING_COPY.indexOf(phrase) >= 0,
      true,
      `the banned list carries "${phrase}"`,
    );
  }

  // PROOF THE SCAN BITES: each phrase, planted in a real rendered string, is caught.
  const planted: [string, string][] = [
    ['$4.99/mo', '/mo'],
    ['$4.99 / month', '/ month'],
    ['$39.99/year', '/ year'],
    ['$4.99 per month', 'per month'],
    ['Pro monthly', 'monthly'],
    ['Pro yearly', 'yearly'],
    ['All Pro features, billed annually.', 'billed annually'],
    ['Manage your subscription', 'subscription'],
    ['Subscribe', 'subscribe'],
    ['7-day free trial', 'free trial'],
    ['Trial available on Pro', 'trial available'],
  ];
  for (const [line, phrase] of planted) {
    const found = billingCopyViolations([line]);
    assertEq(
      found.length > 0 && found.indexOf(phrase) >= 0,
      true,
      `a reintroduced "${phrase}" in a rendered string is caught`,
    );
  }
  // …and the honest sentences the cards DO print are not false positives.
  assertEq(
    billingCopyViolations(['Free plan available with 5 recognitions a month']).length,
    0,
    '"a month" (the free tier) is not mistaken for "monthly"',
  );
}

// ─── 3. the dead IDs ──────────────────────────────────────────

function deadIdTests(): void {
  console.log('\n3. THE DEAD IDS — no `price_1U3SE…` survives');
  assertEq(DEAD_PRICE_ID_COUNT, 3, 'the guard knows how many dead IDs shipped');
  assertEq(DEAD_PRICE_ID_PREFIX, 'price_1U3SE', 'the blacklist is the dead prefix');
  assertEq(deadPriceIdsIn(SETTINGS).length, 0, `no dead price ID in ${SETTINGS_PATH}`);
  assertEq(deadPriceIdsIn(PRICES).length, 0, `no dead price ID in ${PRICES_PATH}`);

  // The pre-fix table FAILS the same guard — the scan is not vacuous.
  const preFixDead = deadPriceIdsIn(PRE_FIX_PLAN_TABLE);
  assertEq(preFixDead.length, 3, `the pre-fix table fails the guard (${preFixDead.length} dead IDs found)`);
  assertEq(priceIdsAreAllLive([PRE_FIX_PLAN_TABLE]), false, 'the pre-fix table fails the live-ID scan');
  assertEq(priceIdsAreAllLive([SETTINGS]), true, 'the shipped screen passes the live-ID scan');
}

// ─── 4. the live scan over src/ ───────────────────────────────

function liveScanTests(): void {
  console.log('\n4. THE LIVE SCAN — every `price_…` literal in src/ is one of the three');
  const files = walkSrc();
  assert(files.length >= 100, `walked ${files.length} src/ files (floor 100)`);
  const withIds: string[] = [];
  const dead: string[] = [];
  const unknown: string[] = [];
  for (const file of files) {
    const text = readAppFile(file.slice(repoRoot().length + 1));
    const ids = priceIdsIn(text);
    if (ids.length === 0) continue;
    withIds.push(file);
    for (const id of ids) {
      if (id.indexOf(DEAD_PRICE_ID_PREFIX) === 0) dead.push(`${file}: ${id}`);
      else if (LIVE_PRICE_IDS.indexOf(id) < 0) unknown.push(`${file}: ${id}`);
    }
  }
  assertEq(dead.length, 0, `no dead price ID anywhere in src/ (${dead.join(', ') || 'clean'})`);
  assertEq(
    unknown.length,
    0,
    `no price ID outside the live three anywhere in src/ (${unknown.join(', ') || 'clean'})`,
  );
  // Floor: the scan must have SEEN the owner of the table.
  assert(
    withIds.some((file) => file.indexOf('v471PlanPrices.ts') >= 0),
    `the scan found the price table (${withIds.length} files carry a price_ literal)`,
  );

  // The table's own literal ids, read from SOURCE (bites without a recompile).
  const tableStart = PRICES.indexOf('export const LIVE_PRICES');
  const tableEnd = PRICES.indexOf('export const LIVE_PRICE_IDS');
  const table = tableStart >= 0 && tableEnd > tableStart ? PRICES.slice(tableStart, tableEnd) : '';
  const declared = (table.match(/id:\s*'(price_[A-Za-z0-9]+)'/g) ?? []).map((line) =>
    line.replace(/^id:\s*'/, '').replace(/'$/, ''),
  );
  assertEq(declared.length, 3, 'the module declares exactly three price IDs');
  for (let i = 0; i < declared.length; i += 1) {
    assertEq(declared[i], LIVE_PRICE_IDS[i], `declared id ${i + 1} is the live ID`);
  }

  // THE LABEL HAS ONE OWNER (owner ruling 2026-10-30): exactly ONE src/ file carries
  // the $39.99 tier name, and it is the module the cards render from. A second,
  // hardcoded copy on the screen — the class of bug this release exists for — fails
  // here, and so does a leftover of the old wording.
  const owners = files.filter(
    (file) =>
      readAppFile(file.slice(repoRoot().length + 1)).indexOf('NoteSnap Pro — Complete') >= 0,
  );
  assertEq(owners.length, 1, `exactly one src/ file carries the tier label (${owners.join(', ')})`);
  assert(
    owners.length === 1 && /v471PlanPrices\.ts$/.test(owners[0]),
    'that one owner is src/services/v471PlanPrices.ts',
  );
  const stale = files.filter((file) =>
    /full library tier/i.test(readAppFile(file.slice(repoRoot().length + 1))),
  );
  assertEq(
    stale.length,
    0,
    `no src/ file still says "full library tier" (${stale.join(', ') || 'clean'})`,
  );
}

// ─── 5. hosting ───────────────────────────────────────────────

function hostingTests(): void {
  console.log('\n5. HOSTING — SettingsScreen RENDERS the cards (not just defines them)');
  assertEq(settingsHostsPlanCards(SETTINGS), true, 'SettingsScreen hosts the LIVE_PRICES cards');
  assert(
    SETTINGS.indexOf('{plansOpen && (') >= 0 &&
      SETTINGS.indexOf('{LIVE_PRICES.map((plan) =>') > SETTINGS.indexOf('{plansOpen && ('),
    'the cards render INSIDE the plans block the Pro row opens',
  );
  assert(
    SETTINGS.indexOf('onPress={() => handleUpgrade(plan.id)}') >= 0,
    'the card sends ITS OWN live id to the checkout call',
  );
  assert(
    SETTINGS.indexOf('Alert.alert(PURCHASE_DONE_TITLE, PURCHASE_DONE_BODY)') >= 0,
    'the post-purchase line is the shared one (no "subscription is active")',
  );
  assertEq(settingsHasNoBillingPeriodCopy(SETTINGS), true, 'the screen itself carries no billing-period copy');

  // The pre-fix screen FAILS the hosting + copy guards.
  assertEq(settingsHostsPlanCards(PRE_FIX_PLAN_TABLE), false, 'the pre-fix table is not a hosted card list');
  assertEq(
    settingsHasNoBillingPeriodCopy(PRE_FIX_ALERT),
    false,
    'the old "Your subscription is active" alert is caught by the copy scan',
  );
  assertEq(
    settingsHasNoBillingPeriodCopy(PRE_FIX_RENEWS),
    false,
    'the old "Renews <date>" line is caught by the copy scan',
  );
  assertEq(settingsHasNoBillingPeriodCopy(PRE_FIX_CTA), false, 'the old "Subscribe" button is caught');
}

// ─── 6. mutation probes (in memory) ───────────────────────────

function probe(name: string, mutated: string, original: string, guard: (text: string) => boolean): void {
  assertEq(mutated !== original, true, `PROBE setup: "${name}" really changed the source`);
  assertEq(guard(mutated), false, `PROBE: ${name} → FAILS`);
  assertEq(guard(original), true, `PROBE: ${name} → the restored source passes again`);
}

function mutationProbes(): void {
  console.log('\n6. MUTATION PROBES — break the real bytes in memory, require each guard to fail');

  // (a) a dead price ID comes back into the screen (the shipped defect).
  probe(
    'a dead price ID is pasted back into SettingsScreen',
    SETTINGS.replace(
      'onPress={() => handleUpgrade(plan.id)}',
      "onPress={() => handleUpgrade('price_1U3SEFBbnDObsY4ujb2zxBSs')}",
    ),
    SETTINGS,
    (text) => deadPriceIdsIn(text).length === 0,
  );

  // (b) an unknown price ID appears (a plausible-looking typo of a live id).
  probe(
    'a plausible-looking but unknown price ID is typed',
    SETTINGS.replace(
      'onPress={() => handleUpgrade(plan.id)}',
      "onPress={() => handleUpgrade('price_1TwbqHReFDEYPfXjXXXXXXXX')}",
    ),
    SETTINGS,
    (text) => priceIdsAreAllLive([text]),
  );

  // (c) the CTA goes back to "Subscribe".
  probe(
    'the card CTA is relabelled Subscribe',
    SETTINGS.replace('{PLAN_CTA_LABEL}', 'Subscribe'),
    SETTINGS,
    (text) => settingsHasNoBillingPeriodCopy(text),
  );

  // (d) a monthly price label returns.
  probe(
    'the Pro price label goes back to a monthly one',
    SETTINGS.replace('{plan.priceLabel}', '$4.99 / month'),
    SETTINGS,
    (text) => settingsHasNoBillingPeriodCopy(text),
  );

  // (e) the cards stop being hosted (moved out of the plans block).
  probe(
    'the cards are wired but no longer hosted inside the plans block',
    SETTINGS.replace('{plansOpen && (', '{false && ('),
    SETTINGS,
    (text) => settingsHostsPlanCards(text),
  );

  // (f) the local PLANS table comes back beside the module (two owners).
  probe(
    'a second, local PLANS table is declared again',
    SETTINGS.replace(
      'const POLL_INTERVAL_MS = 2000;',
      'const PLANS: Plan[] = [];\nconst POLL_INTERVAL_MS = 2000;',
    ),
    SETTINGS,
    (text) => settingsHostsPlanCards(text),
  );

  // (g) the table itself drifts: one amount changed.
  const drifted = LIVE_PRICES.map((price) =>
    price.key === 'pro' ? { ...price, amountAud: 5.99 } : price,
  );
  assertEq(
    livePriceSetIsTheStripeAccount(drifted as typeof LIVE_PRICES),
    false,
    'PROBE: a drifted amount ($4.99 → $5.99) fails the live-table guard',
  );
  assertEq(livePriceSetIsTheStripeAccount(), true, 'PROBE: the real table still passes');

  // (h) the table gains a fourth row (an invented price).
  const invented = LIVE_PRICES.concat([{ ...LIVE_PRICES[0], id: 'price_1Invented' }]);
  assertEq(
    livePriceSetIsTheStripeAccount(invented as typeof LIVE_PRICES),
    false,
    'PROBE: an invented fourth price fails the live-table guard',
  );

  // (i) the copy gains a trial claim.
  assertEq(
    planCopyIsHonest(
      LIVE_PRICES.map((price) =>
        price.key === 'family' ? { ...price, feature: '✓ 7-day free trial' } : price,
      ) as typeof LIVE_PRICES,
    ),
    false,
    'PROBE: a "free trial" line on a one-time price fails the copy guard',
  );

  // (j) the $39.99 tier drifts back to the pre-ruling wording.
  const relabelled = LIVE_PRICES.map((price) =>
    price.key === 'proFull' ? { ...price, name: 'NoteSnap Pro — full library tier' } : price,
  );
  assertEq(
    completeTierNameIsOwnerChoice(relabelled as typeof LIVE_PRICES),
    false,
    'PROBE: the $39.99 tier relabelled "full library tier" fails the owner-label guard',
  );
  assertEq(
    completeTierNameIsOwnerChoice(),
    true,
    'PROBE: the owner’s real label still passes after the probe',
  );

  // The real bytes still pass after every probe.
  assertEq(deadPriceIdsIn(SETTINGS).length, 0, 'the real screen still passes after every probe');
  assertEq(priceIdsAreAllLive([SETTINGS, PRICES]), true, 'the real sources still pass after every probe');
  assertEq(planCopyIsHonest(), true, 'the real copy still passes after every probe');
  assertEq(settingsHostsPlanCards(SETTINGS), true, 'the real hosting still passes after every probe');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('v47.1 Part A — the plan cards must open checkout at the live one-time prices');
  liveTableTests();
  copyTests();
  deadIdTests();
  liveScanTests();
  hostingTests();
  mutationProbes();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
