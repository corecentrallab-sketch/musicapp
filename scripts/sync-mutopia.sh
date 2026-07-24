#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# sync-mutopia.sh — Mirror Mutopia Project scores and parse metadata
#
# Usage:
#   ./scripts/sync-mutopia.sh [--dry-run] [--output-dir /path/to/staging]
#
# Prerequisites:
#   - rsync installed
#   - xmllint (libxml2-utils) for RDF parsing
#   - Sufficient disk space (~4GB for full mirror)
#
# Flow:
#   1. rsync Mutopia repository to /tmp/mutopia/
#   2. Walk the directory tree for RDF metadata files
#   3. Parse composer, title, catalog, format info
#   4. Identify guitar arrangements (files with "guitar" in path or metadata)
#   5. Copy PDF/MIDI/LilyPond files to staging dir organised by composer/catalog
#   6. Output JSON summary log to stdout
# ---------------------------------------------------------------------------

set -euo pipefail

# --- Defaults ---
DRY_RUN=false
STAGING_DIR="/tmp/mutopia-staging"
MUTOPIA_MIRROR="/tmp/mutopia"
RSYNC_HOST="mutopiaproject.org::mutopia"
START_TIME=$(date -u +%s)

# --- Argument parsing ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --output-dir)
      STAGING_DIR="$2"
      shift 2
      ;;
    --mirror-dir)
      MUTOPIA_MIRROR="$2"
      shift 2
      ;;
    --skip-rsync)
      SKIP_RSYNC=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--dry-run] [--output-dir DIR] [--mirror-dir DIR] [--skip-rsync]"
      exit 1
      ;;
  esac
done

# --- Ensure tools are available ---
for tool in rsync find xmllint grep sed sort uniq wc; do
  if ! command -v "$tool" &>/dev/null; then
    echo "Warning: '$tool' not found — some features may not work" >&2
  fi
done

# ---------------------------------------------------------------------------
# Step 1: Sync Mutopia mirror via rsync
# ---------------------------------------------------------------------------
if [[ "${SKIP_RSYNC:-false}" != "true" ]]; then
  echo "=== [1/4] Syncing Mutopia repository ==="
  echo "Source: $RSYNC_HOST"
  echo "Dest:   $MUTOPIA_MIRROR"

  if $DRY_RUN; then
    echo "[DRY RUN] Would execute: rsync -avz --progress $RSYNC_HOST/ $MUTOPIA_MIRROR/"
  else
    mkdir -p "$MUTOPIA_MIRROR"
    # --partial keeps partial transfers; --timeout prevents hangs
    rsync -avz --partial --timeout=120 --progress \
      "$RSYNC_HOST/" "$MUTOPIA_MIRROR/" 2>&1 | tail -5
    echo "rsync complete."
  fi
else
  echo "=== [1/4] Skipping rsync (--skip-rsync) ==="
fi

# ---------------------------------------------------------------------------
# Step 2: Discover and parse RDF metadata
# ---------------------------------------------------------------------------
echo ""
echo "=== [2/4] Parsing RDF metadata ==="

# Mutopia stores RDF as *.rdf or *.rdf.xml files alongside scores.
# The RDF uses Dublin Core terms: dc:title, dc:creator (composer),
# dc:date, dc:identifier, etc.
#
# We also check for index files (piece-list.dat, etc.)

PIECES_FOUND=0
GUITAR_PIECES=0
COMPOSERS_FOUND=0

# Temporary file for structured output
SUMMARY_JSON="/tmp/mutopia-summary.json"
echo '{"pieces": [], "stats": {}}' > "$SUMMARY_JSON"

if $DRY_RUN; then
  echo "[DRY RUN] Would scan $MUTOPIA_MIRROR for RDF files"
else
  # Find all RDF files
  RDF_FILES=$(find "$MUTOPIA_MIRROR" -type f \( -name "*.rdf" -o -name "*.rdf.xml" -o -name "*.rdf+xml" \) 2>/dev/null || true)

  if [ -z "$RDF_FILES" ]; then
    echo "No RDF files found in $MUTOPIA_MIRROR — checking for alternative metadata..."

    # Mutopia may use a flat index file (piece-list.dat) instead
    INDEX_FILE=$(find "$MUTOPIA_MIRROR" -maxdepth 2 -name "piece-list.dat" -o -name "index.html" 2>/dev/null | head -1 || true)

    if [ -n "$INDEX_FILE" ]; then
      echo "Found index file: $INDEX_FILE"
      # Parse index file: typical format: composer/title/piece-name
      while IFS= read -r line; do
        # Skip comments and empty lines
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line// }" ]] && continue

        PIECES_FOUND=$((PIECES_FOUND + 1))
        # Extract composer from first path component
        COMPOSER=$(echo "$line" | cut -d'/' -f1 | tr '_' ' ')
        TITLE=$(echo "$line" | cut -d'/' -f2- | tr '_' ' ')
      done < "$INDEX_FILE"
    else
      # Fallback: walk directory tree and infer from path structure
      echo "No RDF or index found — inferring from directory structure..."
      COMPOSER_DIRS=$(find "$MUTOPIA_MIRROR" -mindepth 1 -maxdepth 2 -type d 2>/dev/null || true)

      for dir in $COMPOSER_DIRS; do
        # Count PDF/MIDI/LY files in this directory as a "piece"
        FILE_COUNT=$(find "$dir" -maxdepth 1 -type f \( -name "*.pdf" -o -name "*.mid" -o -name "*.midi" -o -name "*.ly" \) 2>/dev/null | wc -l)
        if [ "$FILE_COUNT" -gt 0 ]; then
          PIECES_FOUND=$((PIECES_FOUND + 1))

          # Check for guitar keywords
          GUITAR_CHECK=$(find "$dir" -maxdepth 1 -type f -iname "*guitar*" -o -iname "*gtr*" 2>/dev/null | wc -l)
          if [ "$GUITAR_CHECK" -gt 0 ]; then
            GUITAR_PIECES=$((GUITAR_PIECES + 1))
          fi
        fi
      done

      COMPOSERS_FOUND=$(echo "$COMPOSER_DIRS" | sort -u | wc -l)
    fi
  else
    # Parse individual RDF files
    while IFS= read -r rdf_file; do
      if [ ! -f "$rdf_file" ]; then
        continue
      fi

      # Extract Dublin Core metadata using xmllint (if available)
      TITLE=""
      COMPOSER=""
      CATALOG=""

      if command -v xmllint &>/dev/null; then
        TITLE=$(xmllint --xpath 'string(//*[local-name()="title"])' "$rdf_file" 2>/dev/null || echo "")
        COMPOSER=$(xmllint --xpath 'string(//*[local-name()="creator"])' "$rdf_file" 2>/dev/null || echo "")
        CATALOG=$(xmllint --xpath 'string(//*[local-name()="identifier"])' "$rdf_file" 2>/dev/null || echo "")
      else
        # Basic grep-based extraction for dc:title / dc:creator
        TITLE=$(grep -oP '(?<=<dc:title>).*?(?=</dc:title>)' "$rdf_file" 2>/dev/null | head -1 || echo "")
        COMPOSER=$(grep -oP '(?<=<dc:creator>).*?(?=</dc:creator>)' "$rdf_file" 2>/dev/null | head -1 || echo "")
      fi

      # Fallback to directory name if metadata is empty
      if [ -z "$TITLE" ]; then
        TITLE=$(basename "$(dirname "$rdf_file")")
      fi
      if [ -z "$COMPOSER" ]; then
        COMPOSER=$(basename "$(dirname "$(dirname "$rdf_file")")")
      fi

      PIECES_FOUND=$((PIECES_FOUND + 1))

      # Check for guitar arrangements in the same directory
      PIECE_DIR=$(dirname "$rdf_file")
      GUITAR_FILES=$(find "$PIECE_DIR" -maxdepth 1 -type f \
        \( -iname "*guitar*" -o -iname "*gtr*" -o -iname "*tab*" -o -iname "*guitare*" \) \
        2>/dev/null | wc -l)
      if [ "$GUITAR_FILES" -gt 0 ]; then
        GUITAR_PIECES=$((GUITAR_PIECES + 1))
      fi
    done <<< "$RDF_FILES"

    COMPOSERS_FOUND=$(echo "$RDF_FILES" | while IFS= read -r f; do dirname "$(dirname "$f")"; done | sort -u | wc -l)
  fi
fi

echo "   Pieces found:              $PIECES_FOUND"
echo "   Pieces with guitar:        $GUITAR_PIECES"
echo "   Unique composers (approx): $COMPOSERS_FOUND"

# ---------------------------------------------------------------------------
# Step 3: Organise files into staging directory
# ---------------------------------------------------------------------------
echo ""
echo "=== [3/4] Copying files to staging ==="
echo "Staging dir: $STAGING_DIR"

if $DRY_RUN; then
  echo "[DRY RUN] Would copy PDF/MIDI/LilyPond files to $STAGING_DIR"
else
  mkdir -p "$STAGING_DIR"

  COPIED_COUNT=0
  COPIED_BYTES=0

  # Walk the mirror and copy files organised by composer/catalog
  while IFS= read -r file; do
    # Determine composer and piece name from path
    REL_PATH="${file#$MUTOPIA_MIRROR/}"

    # Typical Mutopia path: ComposerName/PieceName/*.pdf
    COMPOSER_SLUG=$(echo "$REL_PATH" | cut -d'/' -f1 | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
    PIECE_SLUG=$(echo "$REL_PATH" | cut -d'/' -f2 | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
    EXT="${file##*.}"

    # Determine format subdirectory
    case "$EXT" in
      pdf|PDF)  FORMAT_DIR="pdf" ;;
      mid|midi|MID|MIDI) FORMAT_DIR="midi" ;;
      ly|LY)    FORMAT_DIR="lilypond" ;;
      mxl|MXL|xml|XML) FORMAT_DIR="musicxml" ;;
      *)        FORMAT_DIR="other" ;;
    esac

    DEST_DIR="$STAGING_DIR/$COMPOSER_SLUG/$PIECE_SLUG/$FORMAT_DIR"
    mkdir -p "$DEST_DIR"

    DEST_FILE="$DEST_DIR/$(basename "$file")"
    cp "$file" "$DEST_FILE" 2>/dev/null || true

    FILE_SIZE=$(stat -c%s "$file" 2>/dev/null || echo 0)
    COPIED_COUNT=$((COPIED_COUNT + 1))
    COPIED_BYTES=$((COPIED_BYTES + FILE_SIZE))
  done < <(find "$MUTOPIA_MIRROR" -type f \( -name "*.pdf" -o -name "*.mid" -o -name "*.midi" -o -name "*.ly" -o -name "*.mxl" \) 2>/dev/null || true)

  echo "   Files copied: $COPIED_COUNT"
  echo "   Total size:   $(numfmt --to=iec $COPIED_BYTES 2>/dev/null || echo "$COPIED_BYTES bytes")"
fi

# ---------------------------------------------------------------------------
# Step 4: Output summary
# ---------------------------------------------------------------------------
END_TIME=$(date -u +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo "=== [4/4] Summary ==="
echo "   Sync completed in:  ${ELAPSED}s"
echo "   Pieces found:       $PIECES_FOUND"
echo "   Guitar arrangements: $GUITAR_PIECES"
echo "   Composers:          $COMPOSERS_FOUND"

if ! $DRY_RUN && [ -d "$STAGING_DIR" ]; then
  TOTAL_STAGED=$(find "$STAGING_DIR" -type f 2>/dev/null | wc -l)
  TOTAL_SIZE=$(du -sh "$STAGING_DIR" 2>/dev/null | cut -f1 || echo "unknown")
  echo "   Staging files:      $TOTAL_STAGED"
  echo "   Staging size:       $TOTAL_SIZE"
fi

# Output JSON summary for downstream processing
cat <<JSONEOF
{
  "source": "mutopia",
  "sync_duration_s": $ELAPSED,
  "pieces_found": $PIECES_FOUND,
  "guitar_pieces": $GUITAR_PIECES,
  "composers_found": $COMPOSERS_FOUND,
  "staging_dir": "$STAGING_DIR",
  "dry_run": $DRY_RUN
}
JSONEOF
