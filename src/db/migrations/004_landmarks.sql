-- Migration: Landmark Fingerprints (Shazam-style robust matcher)
-- New reference storage for the landmark/peak-pair fingerprinter (src/services/landmark.ts).
--
-- Unlike `fingerprints` (exact Chromaprint raw-value set-overlap), these rows store
-- packed peak-pair hashes with their anchor time. Matching uses hash lookup + time-offset
-- alignment voting, which is robust to different synthesis, performance, compression and
-- mic/room noise. See src/services/landmark-matching.ts.
--
-- The legacy `fingerprints` table is intentionally KEPT (not dropped) so we can fall back
-- to the old exact matcher while the new one is verified. This table is additive.
CREATE TABLE piece_landmarks (
    id BIGSERIAL PRIMARY KEY,
    piece_id UUID NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    hash INTEGER NOT NULL,        -- packed 27-bit anchor/target peak-pair hash
    tc INTEGER NOT NULL,          -- anchor time in centiseconds
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Fast lookup: given a query hash, fetch all candidate (piece, time) rows.
CREATE INDEX idx_piece_landmarks_hash ON piece_landmarks(hash);
-- Piece-scoped queries / rebuilds.
CREATE INDEX idx_piece_landmarks_piece ON piece_landmarks(piece_id);
