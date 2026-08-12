/**
 * Subscription entitlement helpers + GET /api/entitlement handler.
 *
 * A device (anonymous app UUID) is "pro" while the subscriptions table has a row
 * for it with status = 'active'. Rows are written by the Stripe webhook handler
 * (src/services/webhook-handler.ts) from checkout.session.completed and
 * customer.subscription.* events.
 */
import { sql } from "~/db";

// Price IDs from the OWNER's Stripe account (USD plans). Must match the
// allowlist in checkout-handler.ts.
export const PLAN_BY_PRICE_ID: Record<string, string> = {
  price_1U3SEFBbnDObsY4ujb2zxBSs: "pro-monthly", // NoteSnap Pro — Monthly $4.99
  price_1U3SEKBbnDObsY4usDGDFNPQ: "pro-yearly", // NoteSnap Pro — Yearly $39.99
  price_1U3SEKBbnDObsY4uVrnJDIyg: "family", // NoteSnap Family/Teacher $9.99
};

/** Map a Stripe price id to a stable plan label (falls back to "pro"). */
export function planLabelFromPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  return PLAN_BY_PRICE_ID[priceId] ?? "pro";
}

export interface Entitlement {
  pro: boolean;
  plan: string | null;
  currentPeriodEnd: string | null;
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

/** True when the device has an active subscription (used to bypass the free limit). */
export async function hasActiveSubscription(deviceId: string): Promise<boolean> {
  const row = await getActiveSubscription(deviceId);
  return row !== null;
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

/**
 * GET /api/entitlement?device=<id>
 * Returns { pro, plan, currentPeriodEnd } for the device.
 */
export async function handleEntitlement(req: Request): Promise<Response> {
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
  const active = await getActiveSubscription(device);
  return Response.json({
    pro: active !== null,
    plan: active?.plan ?? null,
    currentPeriodEnd: active?.currentPeriodEnd ?? null,
  });
}
