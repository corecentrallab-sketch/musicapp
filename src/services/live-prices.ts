/**
 * THE MONEY DATA — the three live one-time prices, and nothing else.
 *
 * Pure data + pure functions: no database, no Stripe SDK, no node built-ins, so
 * this module is safe to import from a route component (the checkout API page
 * renders the price list from it) as well as from server code. The DB-touching
 * entitlement helpers live in `~/services/entitlement`, which re-exports
 * everything here.
 *
 * WHY THE PRICE IDS ARE IN ONE PLACE: the same three ids are needed by the
 * checkout endpoint (allowlist), the webhook (labelling a paid session), the
 * entitlement endpoint (reporting a tier) and the app's own `LIVE_PRICES`. When
 * they were duplicated, the copy in `entitlement.ts` drifted onto an older
 * Stripe account's USD subscription prices and could never label a real
 * purchase (found 2026-11-03).
 */

/** One live, purchasable, ONE-TIME price (read from the live Stripe account). */
export interface LiveOneTimePrice {
  /** The live Stripe price id — `type: one_time`, `currency: aud`. */
  priceId: string;
  /**
   * The tier word the APP prints for this price, copied verbatim from the app's
   * `LIVE_PRICES` (musicapp-update `src/services/v471PlanPrices.ts`). The two
   * sides must name a tier identically or the receipt and the app disagree.
   */
  plan: string;
  /** Stripe `unit_amount`, in the smallest currency unit (AUD cents). */
  amountTotal: number;
  /** ISO currency code, lower-case as Stripe reports it. */
  currency: string;
}

/**
 * THE THREE LIVE PRICES — $4.99 / $39.99 / $9.99 AUD, all one-time, in the order
 * the app's plan cards show them. The $39.99 tier's name is the owner's wording
 * ("NoteSnap Pro — Complete", ruling 2026-10-30) and must not be paraphrased.
 */
export const LIVE_ONE_TIME_PRICES: readonly LiveOneTimePrice[] = [
  {
    priceId: "price_1TwbqHReFDEYPfXjxq8vMcdV",
    plan: "NoteSnap Pro",
    amountTotal: 499,
    currency: "aud",
  },
  {
    priceId: "price_1TwbqHReFDEYPfXjLTbo7zgH",
    plan: "NoteSnap Pro — Complete",
    amountTotal: 3999,
    currency: "aud",
  },
  {
    priceId: "price_1TwbqHReFDEYPfXj0oIi8bGt",
    plan: "Family / Teacher",
    amountTotal: 999,
    currency: "aud",
  },
];

/** The only price IDs this server will sell, entitle, or label. */
export const LIVE_PRICE_IDS: readonly string[] = LIVE_ONE_TIME_PRICES.map(
  (price) => price.priceId,
);

/** price id → tier label. Derived; never hand-edited. */
export const PLAN_BY_PRICE_ID: Record<string, string> = Object.fromEntries(
  LIVE_ONE_TIME_PRICES.map((price) => [price.priceId, price.plan]),
);

/**
 * "amount:currency" → price id. The fallback path for a webhook session whose
 * `metadata.price_id` is missing (a payment link, a session created by hand in
 * the Stripe dashboard): `amount_total` is authoritative from Stripe, so a
 * 3999 AUD payment can still be labelled "NoteSnap Pro — Complete".
 */
export const PRICE_ID_BY_AMOUNT: Record<string, string> = Object.fromEntries(
  LIVE_ONE_TIME_PRICES.map((price) => [
    `${price.amountTotal}:${price.currency}`,
    price.priceId,
  ]),
);

/**
 * Map a Stripe price id to the tier label the app shows.
 *
 * UNKNOWN IDS RETURN null — deliberately, and this is a behaviour change: the
 * old version fell back to "pro" for anything unrecognised, which would have
 * labelled a mystery price as a Pro purchase. null means "paid, tier unknown"
 * and the caller says so instead of inventing a tier.
 */
export function planLabelFromPriceId(
  priceId: string | null | undefined,
): string | null {
  if (!priceId) return null;
  return PLAN_BY_PRICE_ID[priceId] ?? null;
}

/** Resolve a price id from a Stripe amount + currency (see PRICE_ID_BY_AMOUNT). */
export function priceIdFromAmount(
  amountTotal: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (typeof amountTotal !== "number" || !Number.isFinite(amountTotal)) {
    return null;
  }
  if (!currency) return null;
  const key = `${Math.round(amountTotal)}:${currency.toLowerCase()}`;
  return PRICE_ID_BY_AMOUNT[key] ?? null;
}
