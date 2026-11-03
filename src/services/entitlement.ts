/**
 * Entitlement helpers + GET /api/entitlement handler.
 *
 * A device (anonymous app UUID) is "pro" when EITHER of these is true:
 *
 *   1. it holds a PAID ONE-TIME PURCHASE — a row in `purchases` written by the
 *      Stripe webhook from `checkout.session.completed` with mode=payment and
 *      payment_status=paid. A one-time purchase never renews and never expires,
 *      so it is pro forever; that is the whole point of the tier.
 *   2. it has an ACTIVE SUBSCRIPTION — a `subscriptions` row with
 *      status='active' (renewing until current_period_end). That branch is the
 *      pre-existing behaviour and is deliberately unchanged: the account is on
 *      Stripe Express, which cannot sell subscriptions, so it is dormant today
 *      and must still work the day the owner completes the Standard reset.
 *
 * THE DEFECT THIS MODULE FIXED (2026-11-03): `PLAN_BY_PRICE_ID` mapped three
 * `price_1U3SE…` IDs labelled "USD plans / Monthly / Yearly" — prices from a
 * DIFFERENT, older Stripe account than the one the app sells on. Queried with
 * that account's key (the one in this repo's `.env`), the `price_1U3SE…` IDs
 * resolve and the account's six active prices are ALL recurring; the three IDs
 * the app actually sends answer "No such price" to it. So the map could never
 * label a real purchase, and the app's own checkout ids were rejected by
 * `checkout-handler.ts` before Stripe was ever called.
 *
 * The three prices the app sells are `type: one_time`, AUD, and live on the
 * account the deployed app charges on (verified against the app's `LIVE_PRICES`
 * and the owner's Stripe dashboard; the deployed key cannot be used from here).
 *
 * ONE OWNER FOR THE MONEY DATA: the price table is `./live-prices`, and it is
 * the only place in this repo where a live price ID appears. This module
 * re-exports it; `checkout-handler.ts` allows exactly those IDs, and the webhook
 * resolves a paid session back to a tier through it.
 */
import { sql } from "~/db";

// THE PRICE TABLE AND ITS DERIVED MAPS LIVE IN ./live-prices (pure data, no
// database import, so the checkout API page can render the live price list).
// Re-exported here so every existing importer of `~/services/entitlement` keeps
// working, and so the money data still has exactly one owner.
export {
  LIVE_ONE_TIME_PRICES,
  LIVE_PRICE_IDS,
  PLAN_BY_PRICE_ID,
  PRICE_ID_BY_AMOUNT,
  planLabelFromPriceId,
  priceIdFromAmount,
} from "./live-prices";
export type { LiveOneTimePrice } from "./live-prices";

/** A purchase row, as the entitlement endpoint reports it. */
export interface Purchase {
  priceId: string | null;
  plan: string | null;
  amountTotal: number | null;
  currency: string | null;
  createdAt: string;
}

/** The full answer for one device. */
export interface Entitlement {
  pro: boolean;
  plan: string | null;
  currentPeriodEnd: string | null;
  /** Which branch granted pro. null when the device has nothing. */
  source: "purchase" | "subscription" | null;
}

/** Latest active subscription row for a device (if any). */
export async function getActiveSubscription(
  deviceId: string,
): Promise<{ plan: string | null; currentPeriodEnd: string | null } | null> {
  try {
    const rows = await (sql())`
      SELECT plan, current_period_end
      FROM subscriptions
      WHERE device_id = ${deviceId} AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const row = rows[0] as { plan: string | null; current_period_end: string | Date | null };
    return {
      plan: row.plan ?? null,
      currentPeriodEnd: row.current_period_end
        ? new Date(row.current_period_end).toISOString()
        : null,
    };
  } catch (err) {
    console.error("[entitlement] getActiveSubscription failed:", err);
    return null;
  }
}

/**
 * The device's most recent purchase (if any). A purchase never expires, so any
 * row at all is an entitlement — there is no status column to check.
 */
export async function getPurchase(deviceId: string): Promise<Purchase | null> {
  try {
    const rows = await (sql())`
      SELECT price_id, plan, amount_total, currency, created_at
      FROM purchases
      WHERE device_id = ${deviceId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const row = rows[0] as {
      price_id: string | null;
      plan: string | null;
      amount_total: number | string | null;
      currency: string | null;
      created_at: string | Date;
    };
    return {
      priceId: row.price_id ?? null,
      plan: row.plan ?? null,
      amountTotal:
        row.amount_total === null || row.amount_total === undefined
          ? null
          : Number(row.amount_total),
      currency: row.currency ?? null,
      createdAt: new Date(row.created_at).toISOString(),
    };
  } catch (err) {
    console.error("[entitlement] getPurchase failed:", err);
    return null;
  }
}

/**
 * True when the device has an ACTIVE SUBSCRIPTION. Kept with its original
 * subscription-only meaning — see hasProEntitlement for the combined answer.
 */
export async function hasActiveSubscription(deviceId: string): Promise<boolean> {
  const row = await getActiveSubscription(deviceId);
  return row !== null;
}

/** True when the device holds a one-time purchase. */
export async function hasPurchase(deviceId: string): Promise<boolean> {
  const row = await getPurchase(deviceId);
  return row !== null;
}

/**
 * THE ONE ANSWER THE REST OF THE SERVER SHOULD ASK: is this device pro, by
 * either branch? Recognition is never paywalled, but the free-tier monthly
 * recognition cap is lifted for pro devices, and a one-time purchase has to
 * lift it exactly like a subscription does.
 */
export async function hasProEntitlement(deviceId: string): Promise<boolean> {
  if (await hasPurchase(deviceId)) return true;
  return hasActiveSubscription(deviceId);
}

/**
 * Record a paid one-time purchase. Returns TRUE only when this call inserted
 * the row, FALSE when the session was already recorded.
 *
 * IDEMPOTENCY IS THE SCHEMA'S JOB, not a read-then-write: `stripe_session_id`
 * is UNIQUE and the insert is `ON CONFLICT (stripe_session_id) DO NOTHING`.
 * Stripe retries deliveries, and two concurrent deliveries of the same event
 * cannot both insert — the database decides, not a race-prone SELECT. The
 * boolean is what stops the second delivery from also emitting a second
 * `purchase_complete` event.
 */
export async function recordPurchase(input: {
  deviceId: string;
  stripeSessionId: string;
  paymentIntentId: string | null;
  customerId: string | null;
  priceId: string | null;
  plan: string | null;
  amountTotal: number | null;
  currency: string | null;
}): Promise<boolean> {
  const rows = await (sql())`
    INSERT INTO purchases (
      device_id, stripe_session_id, stripe_payment_intent_id,
      stripe_customer_id, price_id, plan, amount_total, currency
    ) VALUES (
      ${input.deviceId}, ${input.stripeSessionId}, ${input.paymentIntentId},
      ${input.customerId}, ${input.priceId}, ${input.plan},
      ${input.amountTotal}, ${input.currency}
    )
    ON CONFLICT (stripe_session_id) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

/** Upsert a subscription row from a Stripe subscription object. */
export async function upsertSubscription(input: {
  deviceId: string;
  customerId: string | null;
  subscriptionId: string;
  priceId: string | null;
  plan: string | null;
  status: string;
  currentPeriodEnd: Date | number | null;
}): Promise<void> {
  await (sql())`
    INSERT INTO subscriptions (
      device_id, stripe_customer_id, stripe_subscription_id,
      price_id, plan, status, current_period_end
    ) VALUES (
      ${input.deviceId}, ${input.customerId}, ${input.subscriptionId},
      ${input.priceId}, ${input.plan}, ${input.status}, ${input.currentPeriodEnd}
    )
    ON CONFLICT (stripe_subscription_id) DO UPDATE SET
      device_id = EXCLUDED.device_id,
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      price_id = EXCLUDED.price_id,
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      updated_at = now()
  `;
}

/** Update an existing row by Stripe subscription id (subscription.* events). */
export async function updateSubscriptionStatus(input: {
  subscriptionId: string;
  priceId: string | null;
  plan: string | null;
  status: string;
  currentPeriodEnd: Date | number | null;
}): Promise<void> {
  await (sql())`
    UPDATE subscriptions
    SET status = ${input.status},
        price_id = ${input.priceId},
        plan = ${input.plan},
        current_period_end = ${input.currentPeriodEnd},
        updated_at = now()
    WHERE stripe_subscription_id = ${input.subscriptionId}
  `;
}

/** The two lookups the entitlement answer needs (injectable for tests). */
export interface EntitlementDeps {
  getActiveSubscription: typeof getActiveSubscription;
  getPurchase: typeof getPurchase;
}

const defaultEntitlementDeps: EntitlementDeps = {
  getActiveSubscription,
  getPurchase,
};

/**
 * The combined entitlement for one device. Both branches are evaluated
 * independently, so a device that holds BOTH a purchase and an active
 * subscription reports pro from the subscription (with its period end) and
 * still keeps its purchase — neither path can shadow the other into a false
 * negative, and a database error in one is logged and treated as "no row"
 * rather than as a denial.
 */
export async function getEntitlement(
  deviceId: string,
  deps: EntitlementDeps = defaultEntitlementDeps,
): Promise<Entitlement> {
  const [active, purchase] = await Promise.all([
    deps.getActiveSubscription(deviceId),
    deps.getPurchase(deviceId),
  ]);

  if (active) {
    return {
      pro: true,
      plan: active.plan,
      currentPeriodEnd: active.currentPeriodEnd,
      source: "subscription",
    };
  }
  if (purchase) {
    return {
      pro: true,
      // A purchase with an unrecognised price id has plan=null on purpose:
      // the device IS pro, and we say plainly that the tier is unknown.
      plan: purchase.plan,
      currentPeriodEnd: null, // a one-time purchase never expires
      source: "purchase",
    };
  }
  return { pro: false, plan: null, currentPeriodEnd: null, source: null };
}

/**
 * GET /api/entitlement?device=<id>
 * Returns { pro, plan, currentPeriodEnd, source } for the device.
 *
 * `source` is additive (the app reads pro/plan/currentPeriodEnd as before) and
 * exists so a support question — "is this a purchase or a subscription?" — has
 * an answer that does not require opening the database.
 */
export async function handleEntitlement(
  req: Request,
  deps: EntitlementDeps = defaultEntitlementDeps,
): Promise<Response> {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed. Use GET." }, { status: 405 });
  }
  const url = new URL(req.url);
  const device = (url.searchParams.get("device") ?? "").trim();
  if (!device) {
    return Response.json(
      { error: "Missing required 'device' query parameter." },
      { status: 400 },
    );
  }
  const entitlement = await getEntitlement(device, deps);
  return Response.json(entitlement);
}
