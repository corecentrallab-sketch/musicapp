/**
 * Stripe webhook handler — POST /api/stripe-webhook
 *
 * Verifies the Stripe signature (STRIPE_WEBHOOK_SECRET) and keeps the
 * `subscriptions` table in sync with real payment lifecycle events:
 *
 *   - checkout.session.completed (mode=subscription)  → upsert row (device from
 *     session.metadata.device_id, falling back to client_reference_id). The
 *     subscription object is fetched to capture price_id + current_period_end,
 *     because the un-expanded session does not include line items.
 *   - customer.subscription.updated / deleted        → update the existing row
 *     (status + period end) by stripe_subscription_id.
 *
 * Always answers 200 quickly once the signature verifies — Stripe retries on
 * non-2xx, and a slow handler risks duplicate event processing.
 */
import Stripe from "stripe";
import {
  planLabelFromPriceId,
  upsertSubscription,
  updateSubscriptionStatus,
} from "~/services/entitlement";

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

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") {
          break; // one-time payments don't create entitlements
        }
        const deviceId = session.metadata?.device_id || session.client_reference_id;
        if (!deviceId) {
          console.warn(
            "[webhook] checkout.session.completed without device_id — cannot entitle",
            { session: session.id },
          );
          break;
        }
        let priceId: string | null = null;
        let currentPeriodEnd: Date | null = null;
        let status = "active";
        if (session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          try {
            const rawSub = await stripeClient().subscriptions.retrieve(subId);
            const sub = toSubscriptionView(rawSub);
            priceId = sub.items?.data?.[0]?.price?.id ?? null;
            currentPeriodEnd = periodEndToDate(sub.current_period_end);
            status = sub.status ?? "active";
          } catch (err) {
            console.error("[webhook] could not retrieve subscription:", err);
          }
        }
        await upsertSubscription({
          deviceId,
          customerId:
            typeof session.customer === "string" ? session.customer : null,
          subscriptionId:
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription?.id ?? "",
          priceId,
          plan: planLabelFromPriceId(priceId),
          status,
          currentPeriodEnd,
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = toSubscriptionView(event.data.object);
        const priceId = sub.items?.data?.[0]?.price?.id ?? null;
        const status =
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : (sub.status ?? "active");
        await updateSubscriptionStatus({
          subscriptionId: sub.id,
          priceId,
          plan: planLabelFromPriceId(priceId),
          status,
          currentPeriodEnd: periodEndToDate(sub.current_period_end),
        });
        break;
      }
      default:
        // Acknowledge other events (invoice.*, etc.) without acting on them.
        break;
    }
  } catch (err) {
    console.error("[webhook] event handling failed:", err);
    return Response.json(
      { error: "Event handling failed." },
      { status: 500 },
    );
  }

  return Response.json({ received: true });
}
