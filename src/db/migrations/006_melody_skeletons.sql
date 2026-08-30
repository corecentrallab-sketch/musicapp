-- Migration 006: Melody skeletons for hum/whistle/sing-to-search.
-- Stores the RELATIVE-INTERVAL melodic contour (derived from each piece's ABC
-- source) that the /api/hum matcher aligns a hummed query against.
-- Built and populated by scripts/build-melody-skeletons.ts.
CREATE TABLE IF NOT EXISTS melody_skeletons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    piece_id UUID REFERENCES pieces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    composer TEXT NOT NULL,
    abc TEXT NOT NULL,                -- source ABC the skeleton was derived from
    deltas INTEGER[] NOT NULL,        -- relative interval contour (semitone steps)
    pitches INTEGER[] NOT NULL,       -- absolute MIDI pitches (diagnostics)
    source TEXT DEFAULT 'abc',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (piece_id)
);
CREATE INDEX IF NOT EXISTS idx_melody_skeletons_piece_id ON melody_skeletons(piece_id);
