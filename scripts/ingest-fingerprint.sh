#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# ingest-fingerprint.sh — Ingest a WAV file + metadata into the fingerprint DB
#
# Usage:
#   ./scripts/ingest-fingerprint.sh <wav_file> <title> <composer> [catalog] [genre]
#
# Prerequisites:
#   - ffmpeg and fpcalc installed (apt-get install ffmpeg libchromaprint-tools)
#   - DATABASE_URL environment variable set (Neon PostgreSQL connection string)
#   - psql available (or uses the Neon serverless driver — falls back to psql)
#
# Flow:
#   1. ffmpeg: convert input to 16kHz mono 16-bit PCM WAV
#   2. fpcalc: generate Chromaprint fingerprint as int[] literal
#   3. INSERT piece metadata into pieces table
#   4. INSERT fingerprint into fingerprints table
# ---------------------------------------------------------------------------

set -euo pipefail

# --- Argument parsing ---
if [ $# -lt 3 ]; then
  echo "Usage: $0 <wav_file> <title> <composer> [catalog] [genre]"
  exit 1
fi

WAV_FILE="$1"
TITLE="$2"
COMPOSER="$3"
CATALOG="${4:-}"
GENRE="${5:-}"

if [ ! -f "$WAV_FILE" ]; then
  echo "Error: file not found: $WAV_FILE"
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL is not set"
  exit 1
fi

# --- Temporary directory ---
TMPDIR=$(mktemp -d -t notesnap-ingest-XXXXXX)
trap 'rm -rf "$TMPDIR"' EXIT

NORMALIZED="$TMPDIR/normalized.wav"

echo "[1/4] Normalizing audio to 16kHz mono 16-bit PCM..."
ffmpeg -y -i "$WAV_FILE" -ar 16000 -ac 1 -sample_fmt s16 -f wav "$NORMALIZED" 2>/dev/null

echo "[2/4] Generating Chromaprint fingerprint..."
FP_OUTPUT=$(fpcalc -raw -length 120 "$NORMALIZED")
DURATION=$(echo "$FP_OUTPUT" | grep "^DURATION=" | cut -d= -f2)
FP_RAW=$(echo "$FP_OUTPUT" | grep "^FINGERPRINT=" | cut -d= -f2)

if [ -z "$FP_RAW" ]; then
  echo "Error: fpcalc produced no fingerprint (audio may be too short or silent)"
  exit 1
fi

# Convert space-separated ints to PostgreSQL array literal: {1,2,3,...}
FP_ARRAY="{$FP_RAW}"
FP_ARRAY="${FP_ARRAY// /,}"  # Replace spaces with commas

echo "   Duration: ${DURATION}s"
echo "   Fingerprint length: $(echo "$FP_RAW" | wc -w) ints"

echo "[3/4] Inserting piece metadata..."
# Using psql for the insert — in production this could use the Neon HTTP API
PIECE_ID=$(psql "$DATABASE_URL" -t -A -c "
  INSERT INTO pieces (title, composer, catalog, genre)
  VALUES ('$TITLE', '$COMPOSER', '${CATALOG:-NULL}', '${GENRE:-NULL}')
  RETURNING id;
" 2>/dev/null || echo "")

if [ -z "$PIECE_ID" ]; then
  echo "Error: failed to insert piece — is DATABASE_URL valid and does the pieces table exist?"
  exit 1
fi

echo "   piece_id: $PIECE_ID"

echo "[4/4] Inserting fingerprint..."
psql "$DATABASE_URL" -c "
  INSERT INTO fingerprints (piece_id, segment_start_s, segment_end_s, fingerprint)
  VALUES ('$PIECE_ID', 0, ${DURATION:-0}, '$FP_ARRAY'::int[]);
" 2>/dev/null

echo ""
echo "Done! Ingested:"
echo "  Title:     $TITLE"
echo "  Composer:  $COMPOSER"
echo "  Catalog:   ${CATALOG:-n/a}"
echo "  Duration:  ${DURATION:-0}s"
echo "  piece_id:  $PIECE_ID"
