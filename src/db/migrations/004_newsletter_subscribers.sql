-- Migration: Newsletter subscribers — "Daily practice note" opt-in signup
-- One row per email address. `source` records where the signup came from
-- ('site' = the marketing-site form). `unsubscribed_at` is set by the
-- unsubscribe link; re-subscribing clears it (upsert re-activates the row).
-- Storage only: the send pipeline is owned by the team lead, not this migration.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    instrument TEXT,
    source TEXT NOT NULL DEFAULT 'site',
    subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    unsubscribed_at TIMESTAMPTZ
);

-- Active-subscriber lookups for the send pipeline.
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_active
    ON newsletter_subscribers(subscribed_at)
    WHERE unsubscribed_at IS NULL;
