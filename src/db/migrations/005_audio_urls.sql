-- Migration: Curated practice audio URLs
--
-- Adds a nullable `audio_url` column to `pieces`. When present, the piece has a
-- curated, playable score audio render stored in R2 (`audio/<piece_id>.wav`),
-- served by GET /api/audio/<piece_id>.wav (see src/services/audio-handler.ts).
--
-- The practice player (DailyChallengePiece.audioUrl in the app) uses this to
-- play the REAL piece audio for deep-work practice (looping hard sections,
-- slowing it down) instead of the bundled public-domain Für Elise preview.
--
-- Honesty rule: a row only gets audio_url after a verified public-domain
-- (Mutopia) MIDI has been rendered and the object actually uploaded to R2 —
-- see scripts/render-score-audio.ts. NULL / absent means "no curated audio"
-- and the client degrades gracefully.
ALTER TABLE pieces
  ADD COLUMN IF NOT EXISTS audio_url TEXT;
