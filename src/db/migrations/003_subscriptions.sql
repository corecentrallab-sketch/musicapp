-- Migration: Stripe Subscriptions (payment entitlement)
-- Tracks one row per Stripe subscription, keyed to the app's anonymous device id.
-- The app's device id is passed as Checkout Session metadata.device_id and used to
-- answer GET /api/entitlement?device=<id> for pro-state enforcement.
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,                  -- app device UUID (not PII)
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT UNIQUE,       -- one row per Stripe subscription
    price_id TEXT,
    plan TEXT,                                -- pro-monthly | pro-yearly | family
    status TEXT NOT NULL DEFAULT 'active',    -- active | canceled | past_due | unpaid | ...
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
-- Fast lookups for entitlement checks (per-device) and webhook updates (per-sub).
CREATE INDEX IF NOT EXISTS idx_subscriptions_device_id ON subscriptions(device_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
