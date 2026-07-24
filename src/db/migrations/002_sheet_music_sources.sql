-- Migration: Sheet Music Curation Foundation
-- Creates tables for the NoteSnap curation pipeline: source tracking,
-- cover art management, and audit logging.
-- Requires: 001_audio_recognition.sql already applied (pieces table exists)

-- sheet_music_sources: tracks where we found sheet music for each piece,
-- including source platform, ratings, download counts, and curation flags.
CREATE TABLE sheet_music_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    piece_id UUID NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    source_platform TEXT NOT NULL,
        -- 'musopen', 'mutopia', 'imslp', 'musescore', 'classtab', 'wikimedia'
    source_url TEXT NOT NULL,
    format TEXT NOT NULL,
        -- 'musicxml', 'pdf', 'midi', 'lilypond', 'text_tab', 'png'
    arrangement_type TEXT NOT NULL DEFAULT 'piano',
        -- 'piano', 'guitar', 'both', 'cover_art'
    rating REAL DEFAULT 0,
    vote_count INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    source_trust REAL DEFAULT 0.5,
        -- Musopen=1.0, Mutopia=0.9, IMSLP modern=0.7, IMSLP old=0.5, MuseScore=0.6, classtab=0.7
    curation_score REAL,
        -- Computed score from ranking algorithm:
        -- Score = (rating × 0.4) + (vote_log × 0.3) + (download_log × 0.2) + (source_trust × 0.1)
    is_primary BOOLEAN DEFAULT false,
        -- TRUE for the highest-scored arrangement of each type per piece
    is_flagged BOOLEAN DEFAULT false,
    flag_reason TEXT,
        -- e.g. 'low_readability', 'incomplete', 'wrong_key', 'duplicate'
    curated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),

    -- One primary arrangement per (piece, arrangement_type) pair
    CONSTRAINT one_primary_per_type UNIQUE (piece_id, arrangement_type, is_primary)
        DEFERRABLE INITIALLY DEFERRED
);

-- cover_art: image sources for each piece, with attribution tracking.
CREATE TABLE cover_art (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    piece_id UUID NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    source_platform TEXT NOT NULL,
        -- 'wikimedia', 'musopen', 'manual', 'mutopia'
    source_url TEXT NOT NULL,
    local_path TEXT,
        -- Cached path in R2 or local staging
    width INTEGER,
    height INTEGER,
    is_primary BOOLEAN DEFAULT false,
    attribution_text TEXT,
        -- Required for CC-licensed images; displayed below sheet music
    created_at TIMESTAMPTZ DEFAULT now()
);

-- curation_log: append-only audit trail of all curation decisions.
CREATE TABLE curation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    piece_id UUID REFERENCES pieces(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
        -- 'fetch', 'score', 'select', 'flag', 'upload', 'reject', 'sync_start', 'sync_end'
    source_platform TEXT,
    details JSONB,
        -- Arbitrary metadata: scores, error messages, file counts, etc.
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX idx_sheet_music_sources_piece_id
    ON sheet_music_sources(piece_id);
CREATE INDEX idx_sheet_music_sources_platform
    ON sheet_music_sources(source_platform, arrangement_type);
CREATE INDEX idx_sheet_music_sources_score
    ON sheet_music_sources(piece_id, curation_score DESC)
    WHERE is_flagged = false;

CREATE INDEX idx_cover_art_piece_id
    ON cover_art(piece_id);
CREATE INDEX idx_cover_art_primary
    ON cover_art(piece_id)
    WHERE is_primary = true;

CREATE INDEX idx_curation_log_piece_id
    ON curation_log(piece_id, created_at DESC);
CREATE INDEX idx_curation_log_action
    ON curation_log(action, created_at DESC);
