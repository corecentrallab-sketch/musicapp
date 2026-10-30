/**
 * v47.1 Part A · THE PLAN CARDS' MONEY DATA — ONE OWNER.
 *
 * THE DEFECT THIS MODULE EXISTS FOR (release-gate FAIL, owner 10-30): the three
 * plan cards in Settings hardcoded three Stripe price IDs that NO LONGER EXIST on
 * the live account (`price_1U3SE…`). Stripe rejected every one with "No such
 * price", so every upgrade tap in the closed test ended in a "Checkout Error"
 * alert. The cards also sold a billing model the account does not have: "/ month",
 * "/ year", "billed annually", "Save 33% vs monthly" and a "Subscribe" button —
 * while all three live prices are `type: one_time`. A trial is impossible on a
 * one-time price, so any trial wording is a false statement at the point of
 * payment.
 *
 * THE FIX, IN ONE PLACE: the price IDs, the tier names, the price labels, the CTA
 * and the post-purchase line live HERE, and SettingsScreen RENDERS them. The card
 * copy therefore cannot drift from the module the guard scans, and the guard scans
 * the same strings the user reads.
 *
 * LIVE PRICES (read from the owner's Stripe account 10-30 — Express, AUD, all
 * `type: one_time`, `has_more: false`; there is NO recurring price on the account):
 *
 *   price_1TwbqHReFDEYPfXjxq8vMcdV   $4.99 AUD   NoteSnap Pro
 *   price_1TwbqHReFDEYPfXjLTbo7zgH   $39.99 AUD  NoteSnap Pro — full library tier
 *   price_1TwbqHReFDEYPfXj0oIi8bGt   $9.99 AUD   Family / Teacher
 *
 * THE STRIPE-SIDE PRODUCT NAMES still say "Monthly"/"Yearly" and the $4.99 product
 * description still says "Trial available"; the owner is correcting that on the
 * Stripe side. Those names are NOT copied into the app, and this module's copy
 * must never imply a billing period or a trial (see BANNED_BILLING_COPY).
 *
 * NO PAYWALL, NO GATING, NO SUBSCRIPTION WIRING is added by this module: it is
 * copy + identifiers only. Recognition stays free; nothing is locked.
 *
 * Plain data + pure string functions — no react-native, no network, no fs, so the
 * tier1 gate compiles and runs it with node_modules absent.
 */
import { maskSourceComments } from './audioFocusContract';

/** One live, purchasable tier. `amountAud` is the Stripe price, in AUD. */
export type LivePrice = {
  /** Stable key the screen's own rendering reads (never a Stripe identifier). */
  readonly key: 'pro' | 'proFull' | 'family';
  /** The LIVE Stripe price ID. The ONLY identifiers the app may send. */
  readonly id: string;
  readonly amountAud: number;
  /** What the tier IS — never a billing period. */
  readonly name: string;
  /** The price line the card prints, currency and one-time-ness included. */
  readonly priceLabel: string;
  readonly feature: string;
  readonly highlight: boolean;
};

/**
 * THE THREE LIVE PRICES. Exactly these, in this order, and nothing else: the
 * account holds three active one-time prices and no recurring one.
 */
export const LIVE_PRICES: readonly LivePrice[] = [
  {
    key: 'pro',
    id: 'price_1TwbqHReFDEYPfXjxq8vMcdV',
    amountAud: 4.99,
    name: 'NoteSnap Pro',
    priceLabel: '$4.99 AUD — one-time',
    feature:
      '✓ Unlimited recognitions\n✓ Grade/difficulty levels\n✓ Advanced recommendations\n✓ Custom app skins\n✓ Cloud sync & sharing\n✓ No ads anywhere',
    highlight: false,
  },
  {
    key: 'proFull',
    id: 'price_1TwbqHReFDEYPfXjLTbo7zgH',
    amountAud: 39.99,
    name: 'NoteSnap Pro — full library tier',
    priceLabel: '$39.99 AUD — one-time',
    feature:
      '✓ Everything in NoteSnap Pro\n✓ Full library tier\n✓ One payment, nothing recurs',
    highlight: true,
  },
  {
    key: 'family',
    id: 'price_1TwbqHReFDEYPfXj0oIi8bGt',
    amountAud: 9.99,
    name: 'Family / Teacher',
    priceLabel: '$9.99 AUD — one-time',
    feature:
      '✓ Up to 5 accounts\n✓ Shared History libraries\n✓ All Pro features included\n✓ Perfect for families & music teachers',
    highlight: false,
  },
];

/** The only price IDs that may appear anywhere in `src/`. */
export const LIVE_PRICE_IDS: readonly string[] = LIVE_PRICES.map((price) => price.id);

/**
 * THE DEAD SET. Three IDs were hardcoded in SettingsScreen and Stripe now answers
 * "No such price" for each of them. They are kept as a PREFIX, never as full
 * literals: a `price_…` string in this file would be a price ID in `src/`, and the
 * guard that bans dead IDs would (rightly) flag its own blacklist. Splitting the
 * literal keeps this module clean while the blacklist still bites.
 */
export const DEAD_PRICE_ID_PREFIX = 'price_' + '1U3SE';

/** How many dead IDs the closed test shipped with (the guard's floor). */
export const DEAD_PRICE_ID_COUNT = 3;

/** The card's button. "Buy once" — a purchase, not a billing relationship. */
export const PLAN_CTA_LABEL = 'Buy once';

/** The upgrade section's honest sub-line (no period, no trial, no renewal). */
export const PLAN_SECTION_SUBTITLE =
  "You're on the free plan — 5 recognitions a month.\nBuy Pro once and unlock unlimited access.";

/** The Billing card's three bullets: one-time, honest, no cancellation promise. */
export const BILLING_NOTES: readonly string[] = [
  'One-time payment — nothing recurs',
  'Free plan available with 5 recognitions a month',
  'Payment processed securely by Stripe',
];

/**
 * What the user is told after the entitlement lands. A PURCHASE, never a
 * subscription: nothing here says a plan is "active" or will renew.
 */
export const PURCHASE_DONE_TITLE = 'Pro unlocked';
export const PURCHASE_DONE_BODY =
  'Your one-time purchase went through. Enjoy unlimited recognitions.';

/**
 * Copy that must never appear on a plan/paywall surface while the account sells
 * one-time prices only. Each entry is matched case-insensitively as a whole word
 * (or a literal, for `/mo`), so an honest "5 recognitions a month" does not trip
 * the "monthly" rule.
 */
export const BANNED_BILLING_COPY: readonly string[] = [
  '/mo',
  '/ month',
  '/ year',
  'per month',
  'monthly',
  'yearly',
  'billed annually',
  'subscription',
  'subscribe',
  'free trial',
  'trial available',
  'renews',
];

/** Whole-word (or literal, for `/mo`) matchers for BANNED_BILLING_COPY. */
const BANNED_PATTERNS: readonly RegExp[] = [
  /\/mo\b/i,
  // A price shown per period: "$4.99 / month", "$39.99/year".
  /\/\s*month\b/i,
  /\/\s*year\b/i,
  /\bper month\b/i,
  /\bmonthly\b/i,
  /\byearly\b/i,
  /\bbilled annually\b/i,
  /\bsubscription\b/i,
  /\bsubscribe\b/i,
  /\bfree trial\b/i,
  /\btrial available\b/i,
  /\brenews\b/i,
  // A bare "trial" is the same claim in a shorter costume.
  /\btrial\b/i,
];

/**
 * Every string the plans flow renders, in one list. The screen prints THESE (it
 * imports the constants), so scanning them scans what the user reads.
 */
export function planFlowCopy(prices: readonly LivePrice[] = LIVE_PRICES): string[] {
  const copy: string[] = [PLAN_SECTION_SUBTITLE, PLAN_CTA_LABEL, PURCHASE_DONE_TITLE, PURCHASE_DONE_BODY];
  for (const note of BILLING_NOTES) copy.push(note);
  for (const price of prices) {
    copy.push(price.name, price.priceLabel, price.feature);
  }
  return copy;
}

/** Every banned phrase found in `copy` (empty = honest). */
export function billingCopyViolations(copy: readonly string[]): string[] {
  const found: string[] = [];
  for (const line of copy) {
    for (let i = 0; i < BANNED_PATTERNS.length; i += 1) {
      if (BANNED_PATTERNS[i].test(line) && found.indexOf(BANNED_BILLING_COPY[i]) < 0) {
        found.push(BANNED_BILLING_COPY[i]);
      }
    }
  }
  return found;
}

/** The plan cards' copy carries no billing period, no subscription, no trial. */
export function planCopyIsHonest(prices: readonly LivePrice[] = LIVE_PRICES): boolean {
  return billingCopyViolations(planFlowCopy(prices)).length === 0;
}

/** Every `price_…` identifier in a source text, de-duplicated, in order. */
export function priceIdsIn(source: string): string[] {
  const text = maskSourceComments(source);
  const matches = text.match(/price_[A-Za-z0-9]+/g) ?? [];
  const unique: string[] = [];
  for (const id of matches) {
    if (unique.indexOf(id) < 0) unique.push(id);
  }
  return unique;
}

/** The dead IDs a source text still carries (empty = clean). */
export function deadPriceIdsIn(source: string): string[] {
  return priceIdsIn(source).filter((id) => id.indexOf(DEAD_PRICE_ID_PREFIX) === 0);
}

/** True when every price ID in every source is one of the three live ones. */
export function priceIdsAreAllLive(sources: readonly string[]): boolean {
  return sources.every((source) =>
    priceIdsIn(source).every((id) => LIVE_PRICE_IDS.indexOf(id) >= 0),
  );
}

/** The module's own table is exactly the three live prices, in AUD, one-time. */
export function livePriceSetIsTheStripeAccount(prices: readonly LivePrice[] = LIVE_PRICES): boolean {
  if (prices.length !== 3) return false;
  const expected: readonly { id: string; amount: number }[] = [
    { id: 'price_1TwbqHReFDEYPfXjxq8vMcdV', amount: 4.99 },
    { id: 'price_1TwbqHReFDEYPfXjLTbo7zgH', amount: 39.99 },
    { id: 'price_1TwbqHReFDEYPfXj0oIi8bGt', amount: 9.99 },
  ];
  return expected.every(
    (want, at) => prices[at].id === want.id && prices[at].amountAud === want.amount,
  );
}

/**
 * HOSTING, not wiring (the v46 lesson: a module that exists but is never mounted
 * is invisible). True when SettingsScreen's own render path — inside the
 * `plansOpen` block — prints the LIVE_PRICES cards, the shared CTA and the shared
 * Billing notes, and sends the card's own id to the checkout call.
 */
export function settingsHostsPlanCards(screenSource: string): boolean {
  const text = maskSourceComments(screenSource);
  if (text.indexOf("from '../services/v471PlanPrices'") < 0) return false;
  // No second, local copy of the table may exist.
  if (/const\s+PLANS\s*[:=]/.test(text)) return false;
  const open = text.indexOf('{plansOpen && (');
  const cards = text.indexOf('{LIVE_PRICES.map((plan) =>');
  if (open < 0 || cards < 0 || cards < open) return false;
  const needs = [
    'onPress={() => handleUpgrade(plan.id)}',
    '{plan.name}',
    '{plan.priceLabel}',
    '{plan.feature}',
    '{PLAN_CTA_LABEL}',
    '{PLAN_SECTION_SUBTITLE}',
    '{BILLING_NOTES.map(',
    '{note}',
    'Alert.alert(PURCHASE_DONE_TITLE, PURCHASE_DONE_BODY)',
  ];
  return needs.every((needle) => text.indexOf(needle) >= 0);
}

/**
 * The Settings surface carries no billing-period / subscription / trial copy of
 * its own either — the module is not the only place a string can be typed.
 * Whole-word matchers, so `unsubscribe` (a listener cleanup) is not a hit.
 */
export function settingsHasNoBillingPeriodCopy(screenSource: string): boolean {
  const text = maskSourceComments(screenSource);
  return !BANNED_PATTERNS.some((pattern) => pattern.test(text));
}

/** The whole contract, for one call in the suite and one in the guard table. */
export function planMoneyContractHolds(screenSource: string): boolean {
  return (
    livePriceSetIsTheStripeAccount() &&
    planCopyIsHonest() &&
    deadPriceIdsIn(screenSource).length === 0 &&
    priceIdsAreAllLive([screenSource]) &&
    settingsHostsPlanCards(screenSource) &&
    settingsHasNoBillingPeriodCopy(screenSource)
  );
}
