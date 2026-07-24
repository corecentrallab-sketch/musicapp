-- Migration: Audio Recognition Foundation
-- Creates tables for the NoteSnap fingerprint-based music recognition pipeline
-- Requires: PostgreSQL with intarray extension enabled

-- Enable intarray extension for GIN indexing on integer arrays
CREATE EXTENSION IF NOT EXISTS intarray;

-- Core pieces table: represents a musical work in our library
CREATE TABLE pieces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    composer TEXT NOT NULL,
    catalog TEXT,              -- e.g. "BWV 846"
    genre TEXT,
    difficulty INTEGER CHECK (difficulty BETWEEN 1 AND 10),
    duration_s INTEGER,
    album_art_url TEXT,
    sheet_music_url TEXT,
    tab_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Fingerprints table: Chromaprint 32-bit integer fingerprints for audio segments
CREATE TABLE fingerprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    piece_id UUID NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    segment_start_s REAL NOT NULL,
    segment_end_s REAL NOT NULL,
    fingerprint INTEGER[] NOT NULL,   -- Chromaprint 32-bit ints
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- GIN index for fast overlap queries using intarray operators
CREATE INDEX idx_fingerprints_gin ON fingerprints USING GIN (fingerprint gin__int_ops);

-- B-tree index for piece lookups
CREATE INDEX idx_fingerprints_piece_id ON fingerprints(piece_id);

-- Recognition history: tracks user recognition requests for rate limiting and analytics
CREATE TABLE recognition_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_identifier TEXT NOT NULL,    -- hash or anonymous ID (not PII)
    piece_id UUID REFERENCES pieces(id),
    fingerprint_id UUID REFERENCES fingerprints(id),
    confidence REAL,
    query_duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for rate-limit queries (look up recents per user)
CREATE INDEX idx_recognition_history_user_time
    ON recognition_history(user_identifier, created_at DESC);
