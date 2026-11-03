-- Migration: one-time purchases (payment entitlement)
-- One row per PAID Stripe Checkout Session (mode=payment). A one-time purchase
-- never renews and never expires, so a row here is a permanent entitlement —
-- unlike `subscriptions`, which is keyed to a period end and a status.
--
-- Written by the Stripe webhook (src/services/webhook-handler.ts) after it has
-- confirmed `payment_status = 'paid'`; read by GET /api/entitlement and by the
-- free-recognition-cap check.
--
-- IDEMPOTENCY LIVES IN THE SCHEMA: `stripe_session_id` is UNIQUE, and the insert
-- is ON CONFLICT (stripe_session_id) DO NOTHING. Stripe retries webhook
-- deliveries; two concurrent deliveries of the same session cannot both insert,
-- so a purchase can never be recorded twice and `purchase_complete` can never be
-- counted twice.
CREATE TABLE IF NOT EXISTS purchases (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,                  -- app device UUID (not PII)
    stripe_session_id TEXT NOT NULL UNIQUE,   -- one row per Checkout Session
    stripe_payment_intent_id TEXT,
    stripe_customer_id TEXT,
    price_id TEXT,                            -- live AUD one-time price id
    plan TEXT,                                -- tier label the app prints; NULL = paid, tier unknown
    amount_total INTEGER,                     -- Stripe amount_total, AUD cents
    currency TEXT,                            -- 'aud'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The entitlement lookup: "the newest purchase for this device".
CREATE INDEX IF NOT EXISTS idx_purchases_device_id_created_at
    ON purchases(device_id, created_at DESC);

COMMENT ON TABLE purchases IS
    'Paid one-time Stripe purchases (AUD, 2026-11). Permanent entitlement: a row means pro, forever. Idempotent by stripe_session_id UNIQUE. No PII — the device id is a random per-install UUID.';
