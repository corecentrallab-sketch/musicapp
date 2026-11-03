/**
 * One-time purchase entitlement — the money path, tested without Stripe.
 *
 * WHY THIS FILE EXISTS: until 2026-11-03 a real purchase did nothing. The
 * webhook dropped every non-subscription session (`if (session.mode !==
 * "subscription") break;`), `PLAN_BY_PRICE_ID` mapped three price ids that the
 * live account does not have, and /api/entitlement could only ask the
 * `subscriptions` table. Every one of those is a silent failure: Stripe answers
 * 200, the customer is charged, and the app stays free-tier. So the tests here
 * assert the *effects* (a purchase row, an event, a pro answer), not just the
 * return value.
 *
 * HOW IT IS TESTABLE WITHOUT THE SIGNING SECRET: signature verification lives in
 * `handleStripeWebhook`; the decision logic lives in `handleStripeEvent(event,
 * deps)`, which takes a hand-built event and injected side effects. No network,
 * no Stripe key, no database.
 *
 * THE FAKE STORE MIRRORS THE SCHEMA, DELIBERATELY: `recordPurchase` in the fake
 * keeps a set of session ids and returns false the second time, exactly like
 * `INSERT ... ON CONFLICT (stripe_session_id) DO NOTHING` on a UNIQUE column.
 * That is what makes the duplicate-delivery test bite — the guard being tested
 * is the handler's "if (!inserted) do not emit" step, and removing it makes the
 * second delivery emit a second `purchase_complete`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type Stripe from "stripe";

import { handleStripeEvent, type WebhookDeps } from "./webhook-handler";
import {
  LIVE_ONE_TIME_PRICES,
  PLAN_BY_PRICE_ID,
  PRICE_ID_BY_AMOUNT,
  getEntitlement,
  handleEntitlement,
  planLabelFromPriceId,
  priceIdFromAmount,
} from "./entitlement";
import {
  EVENT_NAMES,
  SERVER_EVENT_NAMES,
  validateOneEvent,
} from "./events-handler";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const PRICE_PRO = "price_1TwbqHReFDEYPfXjxq8vMcdV"; // $4.99  NoteSnap Pro
const PRICE_COMPLETE = "price_1TwbqHReFDEYPfXjLTbo7zgH"; // $39.99 NoteSnap Pro — Complete
const PRICE_FAMILY = "price_1TwbqHReFDEYPfXj0oIi8bGt"; // $9.99  Family / Teacher
const DEVICE = "1f0f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const SESSION = "cs_test_a1B2c3D4e5F6g7H8";

// --- Builders --------------------------------------------------------------

function stripeEvent(type: string, object: unknown): Stripe.Event {
  return {
    id: "evt_test_0001",
    object: "event",
    api_version: "2025-06-30.basil",
    created: 1_780_000_000,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
  } as unknown as Stripe.Event;
}

function paidSession(overrides: Record<string, unknown> = {}): Stripe.Checkout.Session {
  return {
    id: SESSION,
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    amount_total: 499,
    currency: "aud",
    metadata: { device_id: DEVICE, price_id: PRICE_PRO },
    client_reference_id: DEVICE,
    payment_intent: "pi_test_0001",
    customer: "cus_test_0001",
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

interface Calls {
  purchases: Array<Parameters<WebhookDeps["recordPurchase"]>[0]>;
  events: unknown[];
  upserts: Array<Parameters<WebhookDeps["upsertSubscription"]>[0]>;
  updates: Array<Parameters<WebhookDeps["updateSubscriptionStatus"]>[0]>;
  subscriptionRetrievals: string[];
}

function makeDeps(overrides: Partial<WebhookDeps> = {}): {
  deps: WebhookDeps;
  calls: Calls;
} {
  const calls: Calls = {
    purchases: [],
    events: [],
    upserts: [],
    updates: [],
    subscriptionRetrievals: [],
  };
  const recordedSessions = new Set<string>();

  const deps: WebhookDeps = {
    retrieveSubscription: async (id: string) => {
      calls.subscriptionRetrievals.push(id);
      return {
        id,
        status: "active",
        current_period_end: 1_800_000_000,
        items: { data: [{ price: { id: "price_from_subscription" } }] },
      };
    },
    upsertSubscription: async (input) => {
      calls.upserts.push(input);
    },
    updateSubscriptionStatus: async (input) => {
      calls.updates.push(input);
    },
    // Mirrors UNIQUE(stripe_session_id) + ON CONFLICT DO NOTHING.
    recordPurchase: async (input) => {
      calls.purchases.push(input);
      if (recordedSessions.has(input.stripeSessionId)) return false;
      recordedSessions.add(input.stripeSessionId);
      return true;
    },
    recordEvent: async (raw) => {
      calls.events.push(raw);
      return true;
    },
    ...overrides,
  };
  return { deps, calls };
}

function eventProps(raw: unknown): Record<string, unknown> {
  return (raw as { props?: Record<string, unknown> }).props ?? {};
}

// --- A. The price map ------------------------------------------------------

describe("price map is the live account's three one-time AUD prices", () => {
  test("exactly the three live price ids, with the app's tier words", () => {
    expect(LIVE_ONE_TIME_PRICES.map((p) => p.priceId)).toEqual([
      PRICE_PRO,
      PRICE_COMPLETE,
      PRICE_FAMILY,
    ]);
    expect(Object.keys(PLAN_BY_PRICE_ID).sort()).toEqual(
      [PRICE_PRO, PRICE_COMPLETE, PRICE_FAMILY].sort(),
    );
    // The tier words must match the app's LIVE_PRICES verbatim, including the
    // owner's "NoteSnap Pro — Complete" (ruling 2026-10-30).
    expect(planLabelFromPriceId(PRICE_PRO)).toBe("NoteSnap Pro");
    expect(planLabelFromPriceId(PRICE_COMPLETE)).toBe("NoteSnap Pro — Complete");
    expect(planLabelFromPriceId(PRICE_FAMILY)).toBe("Family / Teacher");
    // AUD cents, not dollars: 499 is $4.99.
    expect(LIVE_ONE_TIME_PRICES.map((p) => [p.amountTotal, p.currency])).toEqual([
      [499, "aud"],
      [3999, "aud"],
      [999, "aud"],
    ]);
  });

  test("the dead USD subscription ids are gone from the map", () => {
    const dead = ["price_1U3SEFBbnDObsY4ujb2zxBSs", "price_1U3SEKBbnDObsY4usDGDFNPQ"];
    for (const id of dead) {
      expect(PLAN_BY_PRICE_ID[id]).toBeUndefined();
      expect(planLabelFromPriceId(id)).toBeNull();
    }
  });

  test("an unknown price id labels as null, never as 'pro'", () => {
    expect(planLabelFromPriceId("price_does_not_exist")).toBeNull();
    expect(planLabelFromPriceId("")).toBeNull();
    expect(planLabelFromPriceId(null)).toBeNull();
    // The old behaviour was a silent "pro" fallback; this pins the change.
    expect(planLabelFromPriceId("price_does_not_exist")).not.toBe("pro");
  });

  test("amount+currency resolves back to a price id (fallback path)", () => {
    expect(priceIdFromAmount(3999, "aud")).toBe(PRICE_COMPLETE);
    expect(priceIdFromAmount(999, "AUD")).toBe(PRICE_FAMILY);
    expect(priceIdFromAmount(1234, "aud")).toBeNull();
    expect(priceIdFromAmount(null, "aud")).toBeNull();
    expect(Object.keys(PRICE_ID_BY_AMOUNT)).toEqual(["499:aud", "3999:aud", "999:aud"]);
  });
});

// --- B. checkout.session.completed, mode=payment ---------------------------

describe("checkout.session.completed with mode=payment", () => {
  test("a PAID one-time purchase is recorded and emits purchase_complete", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleStripeEvent(
      stripeEvent("checkout.session.completed", paidSession()),
      deps,
    );

    expect(result).toEqual({ handled: true, outcome: "purchase-recorded" });
    expect(calls.purchases).toHaveLength(1);
    expect(calls.purchases[0]).toEqual({
      deviceId: DEVICE,
      stripeSessionId: SESSION,
      paymentIntentId: "pi_test_0001",
      customerId: "cus_test_0001",
      priceId: PRICE_PRO,
      plan: "NoteSnap Pro",
      amountTotal: 499,
      currency: "aud",
    });

    expect(calls.events).toHaveLength(1);
    const raw = calls.events[0] as { name: string; install_id: string };
    expect(raw.name).toBe("purchase_complete");
    expect(raw.install_id).toBe(DEVICE);
    expect(eventProps(raw)).toEqual({
      tier: "NoteSnap Pro",
      price_id: PRICE_PRO,
      amount_total: 499,
      currency: "aud",
      mode: "payment",
    });
    // No subscription side effect on a one-time payment.
    expect(calls.upserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });

  test("an UNPAID completion grants nothing and emits nothing", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleStripeEvent(
      stripeEvent(
        "checkout.session.completed",
        paidSession({ payment_status: "unpaid" }),
      ),
      deps,
    );

    expect(result).toEqual({ handled: false, outcome: "unpaid" });
    expect(calls.purchases).toHaveLength(0);
    expect(calls.events).toHaveLength(0);
  });

  test("'no_payment_required' is not 'paid' — nothing is granted", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleStripeEvent(
      stripeEvent(
        "checkout.session.completed",
        paidSession({ payment_status: "no_payment_required" }),
      ),
      deps,
    );
    expect(result.outcome).toBe("unpaid");
    expect(calls.purchases).toHaveLength(0);
  });

  test("a paid session with NO device id records nothing", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleStripeEvent(
      stripeEvent(
        "checkout.session.completed",
        paidSession({ metadata: {}, client_reference_id: null }),
      ),
      deps,
    );

    expect(result).toEqual({ handled: false, outcome: "no-device" });
    expect(calls.purchases).toHaveLength(0);
    expect(calls.events).toHaveLength(0);
  });

  test("client_reference_id is the fallback when metadata.device_id is absent", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleStripeEvent(
      stripeEvent(
        "checkout.session.completed",
        paidSession({ metadata: { price_id: PRICE_FAMILY }, client_reference_id: DEVICE }),
      ),
      deps,
    );
    expect(result.handled).toBe(true);
    expect(calls.purchases[0].deviceId).toBe(DEVICE);
    expect(calls.purchases[0].plan).toBe("Family / Teacher");
  });

  test("an UNKNOWN price id still records the purchase, with the tier unknown", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleStripeEvent(
      stripeEvent(
        "checkout.session.completed",
        paidSession({
          metadata: { device_id: DEVICE, price_id: "price_mystery" },
          amount_total: 1234,
        }),
      ),
      deps,
    );

    // The money moved: the device is pro. The tier is not invented.
    expect(result).toEqual({
      handled: true,
      outcome: "purchase-recorded-unknown-tier",
    });
    expect(calls.purchases).toHaveLength(1);
    expect(calls.purchases[0].plan).toBeNull();
    expect(calls.purchases[0].priceId).toBe("price_mystery");
    expect(eventProps(calls.events[0]).tier).toBe("unknown");
  });

  test("no metadata.price_id: the tier is resolved from amount + currency", async () => {
    const { deps, calls } = makeDeps();
    await handleStripeEvent(
      stripeEvent(
        "checkout.session.completed",
        paidSession({ metadata: { device_id: DEVICE }, amount_total: 3999 }),
      ),
      deps,
    );
    expect(calls.purchases[0].priceId).toBe(PRICE_COMPLETE);
    expect(calls.purchases[0].plan).toBe("NoteSnap Pro — Complete");
  });

  test("a DUPLICATE delivery creates no second purchase and no second event", async () => {
    const { deps, calls } = makeDeps();
    const event = stripeEvent("checkout.session.completed", paidSession());

    const first = await handleStripeEvent(event, deps);
    const second = await handleStripeEvent(event, deps);

    expect(first.outcome).toBe("purchase-recorded");
    expect(second).toEqual({ handled: false, outcome: "duplicate" });
    // The database saw both attempts; only one row exists.
    expect(calls.purchases).toHaveLength(2);
    // ...and the receipt was counted exactly once.
    expect(calls.events).toHaveLength(1);
  });

  test("a telemetry failure never fails the purchase", async () => {
    const { deps, calls } = makeDeps({ recordEvent: async () => false });
    const result = await handleStripeEvent(
      stripeEvent("checkout.session.completed", paidSession()),
      deps,
    );
    expect(result).toEqual({ handled: true, outcome: "purchase-recorded" });
    expect(calls.purchases).toHaveLength(1);
  });
});

// --- C. The subscription branch is unchanged -------------------------------

describe("subscription events still work (unchanged branch)", () => {
  test("checkout.session.completed mode=subscription upserts a subscription row", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleStripeEvent(
      stripeEvent(
        "checkout.session.completed",
        paidSession({
          mode: "subscription",
          payment_status: "paid",
          subscription: "sub_test_1",
          metadata: { device_id: DEVICE },
        }),
      ),
      deps,
    );

    expect(result).toEqual({ handled: true, outcome: "subscription-upserted" });
    expect(calls.subscriptionRetrievals).toEqual(["sub_test_1"]);
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0]).toEqual({
      deviceId: DEVICE,
      customerId: "cus_test_0001",
      subscriptionId: "sub_test_1",
      priceId: "price_from_subscription",
      plan: null, // not one of our one-time prices → honestly unknown
      status: "active",
      currentPeriodEnd: new Date(1_800_000_000 * 1000),
    });
    // A subscription session must NOT create a purchase row.
    expect(calls.purchases).toHaveLength(0);
    expect(calls.events).toHaveLength(0);
  });

  test("customer.subscription.updated updates status and period end", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleStripeEvent(
      stripeEvent("customer.subscription.updated", {
        id: "sub_test_1",
        status: "past_due",
        current_period_end: 1_900_000_000,
        items: { data: [{ price: { id: PRICE_PRO } }] },
      }),
      deps,
    );

    expect(result).toEqual({ handled: true, outcome: "subscription-past_due" });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toEqual({
      subscriptionId: "sub_test_1",
      priceId: PRICE_PRO,
      plan: "NoteSnap Pro",
      status: "past_due",
      currentPeriodEnd: new Date(1_900_000_000 * 1000),
    });
  });

  test("customer.subscription.deleted marks the row canceled", async () => {
    const { deps, calls } = makeDeps();
    await handleStripeEvent(
      stripeEvent("customer.subscription.deleted", {
        id: "sub_test_1",
        status: "active", // Stripe still reports the pre-delete status
        items: { data: [{ price: { id: PRICE_PRO } }] },
      }),
      deps,
    );
    expect(calls.updates[0].status).toBe("canceled");
  });

  test("unrelated events are acknowledged and ignored", async () => {
    const { deps, calls } = makeDeps();
    const result = await handleStripeEvent(
      stripeEvent("invoice.paid", { id: "in_test_1" }),
      deps,
    );
    expect(result).toEqual({ handled: false, outcome: "ignored" });
    expect(calls.purchases).toHaveLength(0);
    expect(calls.events).toHaveLength(0);
  });
});

// --- D. GET /api/entitlement ----------------------------------------------

describe("GET /api/entitlement answers from purchases AND subscriptions", () => {
  const depsFor = (
    purchase: Awaited<ReturnType<typeof getPurchaseLike>> | null,
    subscription: { plan: string | null; currentPeriodEnd: string | null } | null,
  ) => ({
    getActiveSubscription: async () => subscription,
    getPurchase: async () => purchase,
  });

  async function getPurchaseLike() {
    return {
      priceId: PRICE_COMPLETE,
      plan: "NoteSnap Pro — Complete",
      amountTotal: 3999,
      currency: "aud",
      createdAt: "2026-11-03T00:00:00.000Z",
    };
  }

  test("a device with a purchase is pro, permanently, with its tier", async () => {
    const purchase = await getPurchaseLike();
    const entitlement = await getEntitlement(DEVICE, depsFor(purchase, null));
    expect(entitlement).toEqual({
      pro: true,
      plan: "NoteSnap Pro — Complete",
      currentPeriodEnd: null, // a one-time purchase never expires
      source: "purchase",
    });
  });

  test("a device with only a subscription is pro via the subscription", async () => {
    const entitlement = await getEntitlement(
      DEVICE,
      depsFor(null, { plan: "NoteSnap Pro", currentPeriodEnd: "2026-12-01T00:00:00.000Z" }),
    );
    expect(entitlement).toEqual({
      pro: true,
      plan: "NoteSnap Pro",
      currentPeriodEnd: "2026-12-01T00:00:00.000Z",
      source: "subscription",
    });
  });

  test("a device with BOTH reports pro and keeps the subscription's period end", async () => {
    const purchase = await getPurchaseLike();
    const entitlement = await getEntitlement(
      DEVICE,
      depsFor(purchase, { plan: "NoteSnap Pro", currentPeriodEnd: "2026-12-01T00:00:00.000Z" }),
    );
    expect(entitlement.pro).toBe(true);
    expect(entitlement.source).toBe("subscription");
    expect(entitlement.currentPeriodEnd).toBe("2026-12-01T00:00:00.000Z");
  });

  test("a device with neither is not pro", async () => {
    const entitlement = await getEntitlement(DEVICE, depsFor(null, null));
    expect(entitlement).toEqual({
      pro: false,
      plan: null,
      currentPeriodEnd: null,
      source: null,
    });
  });

  test("HTTP: 200 with pro for a purchasing device", async () => {
    const purchase = await getPurchaseLike();
    const res = await handleEntitlement(
      new Request(`https://notesnap.app/api/entitlement?device=${DEVICE}`),
      depsFor(purchase, null),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      pro: true,
      plan: "NoteSnap Pro — Complete",
      currentPeriodEnd: null,
      source: "purchase",
    });
  });

  test("HTTP: 400 without a device, 405 on POST", async () => {
    const deps = depsFor(null, null);
    const missing = await handleEntitlement(
      new Request("https://notesnap.app/api/entitlement"),
      deps,
    );
    expect(missing.status).toBe(400);
    const wrongMethod = await handleEntitlement(
      new Request("https://notesnap.app/api/entitlement?device=x", { method: "POST" }),
      deps,
    );
    expect(wrongMethod.status).toBe(405);
  });
});

// --- E. purchase_complete is server-only ----------------------------------

describe("purchase_complete cannot be forged by a client", () => {
  test("it is a SERVER event, not one of the client's nine", () => {
    expect([...EVENT_NAMES]).toHaveLength(9);
    expect(EVENT_NAMES as readonly string[]).not.toContain("purchase_complete");
    expect(SERVER_EVENT_NAMES as readonly string[]).toContain("purchase_complete");
  });

  test("validateOneEvent rejects it by default and accepts it for the server", () => {
    const raw = {
      name: "purchase_complete",
      install_id: DEVICE,
      props: { tier: "NoteSnap Pro" },
    };
    const asClient = validateOneEvent(raw);
    expect(asClient.ok).toBe(false);
    const asServer = validateOneEvent(raw, SERVER_EVENT_NAMES);
    expect(asServer.ok).toBe(true);
  });

  test("the emitted event passes the endpoint's own validation rules", async () => {
    const { deps, calls } = makeDeps();
    await handleStripeEvent(stripeEvent("checkout.session.completed", paidSession()), deps);
    const validated = validateOneEvent(calls.events[0], SERVER_EVENT_NAMES);
    expect(validated.ok).toBe(true);
  });
});

// --- F. Source guards for the money path ----------------------------------

describe("money-path source guards", () => {
  const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

  test("idempotency is enforced by the schema, not by a read-then-write", () => {
    const ddl = read("src/db/migrations/007_purchases.sql");
    expect(ddl).toMatch(/stripe_session_id\s+text\s+NOT NULL UNIQUE/i);
    const script = read("scripts/migrate-purchases-table.ts");
    expect(script).toMatch(/stripe_session_id text NOT NULL UNIQUE/);
    const service = read("src/services/entitlement.ts");
    expect(service).toMatch(/ON CONFLICT \(stripe_session_id\) DO NOTHING/);
    expect(service).toMatch(/RETURNING id/);
  });

  test("the webhook no longer drops one-time payments", () => {
    const webhook = read("src/services/webhook-handler.ts");
    expect(webhook).toMatch(/session\.mode === "payment"/);
    expect(webhook).toMatch(/payment_status !== "paid"/);
    // The old line that threw every one-time payment away must be gone.
    expect(webhook).not.toMatch(/one-time payments don't create entitlements/);
  });

  test("checkout creates a PAYMENT session with a live price, not a subscription", () => {
    // Comments in the source legitimately MENTION the old mode (they explain the
    // bug), so the scan runs on code lines only — otherwise the guard would trip
    // over its own documentation.
    const stripComments = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n");
    const checkout = stripComments(read("src/services/checkout-handler.ts"));
    expect(checkout).toMatch(/mode: "payment"/);
    expect(checkout).not.toMatch(/mode: "subscription"/);
    expect(checkout).not.toMatch(/price_1U3SE/);
    expect(checkout).toMatch(/LIVE_PRICE_IDS/);
  });

  test("the free-recognition cap is lifted by a purchase, not only a subscription", () => {
    const recognize = read("src/services/recognize-handler.ts");
    expect(recognize).toMatch(/hasProEntitlement\(deviceId\)/);
  });
});
