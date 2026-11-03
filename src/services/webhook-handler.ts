/**
 * Stripe webhook handler — POST /api/stripe-webhook
 *
 * Verifies the Stripe signature (STRIPE_WEBHOOK_SECRET) and keeps entitlement
 * state in sync with real payment lifecycle events.
 *
 * TWO KINDS OF PAYMENT, TWO TABLES:
 *
 *   1. ONE-TIME (the live business). `checkout.session.completed` with
 *      mode="payment" and payment_status="paid" → a row in `purchases` that
 *      never expires. THIS WAS MISSING UNTIL 2026-11-03: the handler dropped
 *      every non-subscription session on the floor ("one-time payments don't
 *      create entitlements"), so a real $4.99/$9.99/$39.99 purchase answered
 *      200 {"received":true} and unlocked nothing. Zero purchases existed when
 *      this was fixed, so no customer was ever affected — the next one would
 *      have been.
 *   2. SUBSCRIPTION (dormant; Stripe Express cannot sell subscriptions).
 *      `checkout.session.completed` mode="subscription" → upsert a
 *      `subscriptions` row; `customer.subscription.updated/deleted` → update
 *      it. This branch is UNCHANGED and must keep working the day the owner
 *      completes the Standard reset.
 *
 * PAID MEANS PAID: `checkout.session.completed` fires for sessions whose
 * payment has not settled (delayed methods, async failure). Only
 * `payment_status === "paid"` grants anything; anything else is recorded in the
 * log as unpaid and grants nothing. A completed session is not a paid one.
 *
 * IDEMPOTENCY: Stripe retries. `purchases.stripe_session_id` is UNIQUE and the
 * insert is ON CONFLICT DO NOTHING, so a duplicate delivery cannot create a
 * second purchase; `recordPurchase` returns false in that case and the handler
 * skips the `purchase_complete` event, so the event cannot be double-counted
 * either. Nothing here reads-then-writes.
 *
 * TESTABILITY: signature verification and event handling are separate.
 * `handleStripeEvent(event, deps)` takes a constructed Stripe event and
 * injectable side effects, so every branch below is unit-tested without the
 * live signing secret (which only exists in the deployed environment). The
 * signature check stays in `handleStripeWebhook`, which is a thin wrapper.
 *
 * Always answers 200 quickly once the signature verifies — Stripe retries on
 * non-2xx, and a slow handler risks duplicate event processing.
 */
import Stripe from "stripe";
import {
  planLabelFromPriceId,
  priceIdFromAmount,
  recordPurchase,
  upsertSubscription,
  updateSubscriptionStatus,
} from "~/services/entitlement";
import { recordServerEvent } from "~/services/events-handler";

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(key, { apiVersion: "2025-06-30.basil" as any });
}

/** Convert Stripe's unix-seconds period end to a JS Date (or null). */
function periodEndToDate(ts: number | null | undefined): Date | null {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts * 1000);
}

/**
 * Minimal structural view of a Stripe subscription for the fields this handler
 * consumes. The SDK's pinned API-version types move `current_period_end` around
 * between models, so we read it structurally instead of fighting the types.
 */
interface SubscriptionView {
  id: string;
  status?: string | null;
  current_period_end?: number | null;
  items?: { data?: Array<{ price?: { id?: string } | null }> | null } | null;
}

function toSubscriptionView(sub: unknown): SubscriptionView {
  return (sub ?? {}) as SubscriptionView;
}

/**
 * The side effects of handling an event. Every one of them is injectable so the
 * branches can be tested without Stripe or Postgres; the defaults are the real
 * implementations.
 */
export interface WebhookDeps {
  /** Fetch a subscription object (the un-expanded session has no line items). */
  retrieveSubscription: (subscriptionId: string) => Promise<unknown>;
  upsertSubscription: typeof upsertSubscription;
  updateSubscriptionStatus: typeof updateSubscriptionStatus;
  /** True when the row was inserted (false = duplicate delivery). */
  recordPurchase: typeof recordPurchase;
  /** True when the event row was committed. */
  recordEvent: typeof recordServerEvent;
}

const defaultDeps: WebhookDeps = {
  retrieveSubscription: (subscriptionId) =>
    stripeClient().subscriptions.retrieve(subscriptionId),
  upsertSubscription,
  updateSubscriptionStatus,
  recordPurchase,
  recordEvent: recordServerEvent,
};

/** What the handler decided, returned for logging and for the tests. */
export interface HandleResult {
  /** True when this event changed entitlement state. */
  handled: boolean;
  /** Short machine-readable outcome, e.g. "purchase-recorded". */
  outcome: string;
}

/** Device identity carried by a Checkout Session. */
function deviceIdFromSession(session: Stripe.Checkout.Session): string | null {
  const fromMetadata = session.metadata?.device_id?.trim();
  if (fromMetadata) return fromMetadata;
  // client_reference_id is the Stripe-visible fallback checkout-handler.ts sets
  // to the same value; a session created by hand may carry only one of them.
  const fromReference = session.client_reference_id?.trim();
  if (fromReference) return fromReference;
  return null;
}

/** A string id from a field Stripe may send expanded (object) or not (string). */
function idOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string") return id.trim() || null;
  }
  return null;
}

/**
 * ONE-TIME PURCHASE. Grants pro permanently, once, for a PAID session.
 *
 * The price id is resolved from `metadata.price_id` (set by
 * checkout-handler.ts when it creates the session), falling back to the
 * amount+currency pair, which Stripe always reports. An unresolvable price still
 * records the purchase — the money moved and the device must be entitled — but
 * the tier is stored as NULL and the outcome says so, instead of guessing.
 */
async function handleOneTimeCheckout(
  session: Stripe.Checkout.Session,
  deps: WebhookDeps,
): Promise<HandleResult> {
  if (session.payment_status !== "paid") {
    // A completed-but-unpaid session (async/delayed payment). Record nothing.
    console.warn("[webhook] one-time session completed but NOT paid — ignored", {
      session: session.id,
      paymentStatus: session.payment_status,
    });
    return { handled: false, outcome: "unpaid" };
  }

  const deviceId = deviceIdFromSession(session);
  if (!deviceId) {
    // The customer paid and we cannot tell whose device it is: nothing to
    // grant, and the log line is the only trace. Say so loudly.
    console.warn(
      "[webhook] paid one-time session without device_id — cannot entitle",
      { session: session.id },
    );
    return { handled: false, outcome: "no-device" };
  }

  const sessionId = session.id;
  if (!sessionId) {
    console.warn("[webhook] paid one-time session without an id — cannot record");
    return { handled: false, outcome: "no-session-id" };
  }

  const priceId =
    session.metadata?.price_id?.trim() ||
    priceIdFromAmount(session.amount_total, session.currency);
  const plan = planLabelFromPriceId(priceId);
  const amountTotal =
    typeof session.amount_total === "number" ? session.amount_total : null;
  const currency = session.currency ?? null;

  const inserted = await deps.recordPurchase({
    deviceId,
    stripeSessionId: sessionId,
    paymentIntentId: idOf(session.payment_intent),
    customerId: idOf(session.customer),
    priceId,
    plan,
    amountTotal,
    currency,
  });

  if (!inserted) {
    // DUPLICATE DELIVERY (or a second event for the same session). The row
    // already exists, so the purchase is already granted and already counted.
    // Return here — emitting again would double-count the receipt.
    console.info("[webhook] duplicate one-time session — already recorded", {
      session: sessionId,
    });
    return { handled: false, outcome: "duplicate" };
  }

  if (!plan) {
    console.warn(
      "[webhook] purchase recorded with an UNKNOWN price id — device is pro, tier unknown",
      { session: sessionId, priceId, amountTotal, currency },
    );
  }

  // The receipt event, into the same `events` table /api/events writes to. Props
  // are flat primitives, keys free of PII tokens, values inside the endpoint's
  // own limits; a rejected event returns false and never fails the webhook.
  await deps.recordEvent({
    name: "purchase_complete",
    install_id: deviceId,
    props: {
      tier: plan ?? "unknown",
      price_id: priceId ?? "unknown",
      amount_total: amountTotal ?? 0,
      currency: currency ?? "unknown",
      mode: "payment",
    },
  });

  return { handled: true, outcome: plan ? "purchase-recorded" : "purchase-recorded-unknown-tier" };
}

/**
 * SUBSCRIPTION CHECKOUT — unchanged behaviour, moved into its own function so
 * the one-time branch above can sit beside it. A subscription session creates a
 * `subscriptions` row; the subscription object is fetched because the
 * un-expanded session carries neither price nor period end.
 */
async function handleSubscriptionCheckout(
  session: Stripe.Checkout.Session,
  deps: WebhookDeps,
): Promise<HandleResult> {
  const deviceId = deviceIdFromSession(session);
  if (!deviceId) {
    console.warn(
      "[webhook] checkout.session.completed without device_id — cannot entitle",
      { session: session.id },
    );
    return { handled: false, outcome: "no-device" };
  }
  let priceId: string | null = null;
  let currentPeriodEnd: Date | null = null;
  let status = "active";
  if (session.subscription) {
    const subId = idOf(session.subscription);
    try {
      const rawSub = await deps.retrieveSubscription(subId ?? "");
      const sub = toSubscriptionView(rawSub);
      priceId = sub.items?.data?.[0]?.price?.id ?? null;
      currentPeriodEnd = periodEndToDate(sub.current_period_end);
      status = sub.status ?? "active";
    } catch (err) {
      console.error("[webhook] could not retrieve subscription:", err);
    }
  }
  await deps.upsertSubscription({
    deviceId,
    customerId: idOf(session.customer),
    subscriptionId: idOf(session.subscription) ?? "",
    priceId,
    plan: planLabelFromPriceId(priceId),
    status,
    currentPeriodEnd,
  });
  return { handled: true, outcome: "subscription-upserted" };
}

/**
 * Handle ONE verified Stripe event. No signature, no HTTP, no request object —
 * call it directly from a test with a hand-built event.
 *
 * Throws only if a database write throws; `handleStripeWebhook` turns that into
 * a 500 so Stripe retries.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  deps: WebhookDeps = defaultDeps,
): Promise<HandleResult> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "payment") {
        return handleOneTimeCheckout(session, deps);
      }
      if (session.mode === "subscription") {
        return handleSubscriptionCheckout(session, deps);
      }
      // Any other mode (setup) carries no entitlement.
      return { handled: false, outcome: "unsupported-mode" };
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = toSubscriptionView(event.data.object);
      const priceId = sub.items?.data?.[0]?.price?.id ?? null;
      const status =
        event.type === "customer.subscription.deleted"
          ? "canceled"
          : (sub.status ?? "active");
      await deps.updateSubscriptionStatus({
        subscriptionId: sub.id,
        priceId,
        plan: planLabelFromPriceId(priceId),
        status,
        currentPeriodEnd: periodEndToDate(sub.current_period_end),
      });
      return { handled: true, outcome: `subscription-${status}` };
    }
    default:
      // Acknowledge other events (invoice.*, etc.) without acting on them.
      return { handled: false, outcome: "ignored" };
  }
}

export async function handleStripeWebhook(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed. Use POST." }, { status: 405 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook] STRIPE_WEBHOOK_SECRET is not set");
    return Response.json(
      { error: "Webhook is not configured on the server." },
      { status: 500 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  // Raw body is required for signature verification — never parse JSON first.
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err);
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  let result: HandleResult;
  try {
    result = await handleStripeEvent(event);
  } catch (err) {
    console.error("[webhook] event handling failed:", err);
    return Response.json(
      { error: "Event handling failed." },
      { status: 500 },
    );
  }

  return Response.json({ received: true, handled: result.handled, outcome: result.outcome });
}
