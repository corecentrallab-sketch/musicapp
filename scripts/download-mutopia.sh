#!/usr/bin/env bash
# Fast Mutopia downloader - uses curl for listing, xargs -P for parallel downloads
set -euo pipefail

BASE="https://www.mutopiaproject.org/ftp"
OUT="/home/team/shared/mutopia-data"
CURL="curl -sf --connect-timeout 30 --tls-max 1.2 --max-time 45"
PARALLEL=8

COMPOSERS=(
  "BachJS" "BeethovenLv" "MozartWA" "ChopinFF" "DebussyC" "SchubertF"
  "BrahmsJ" "HandelGF" "HaydnFJ" "LisztF" "MendelssohnF" "SchumannR"
  "TchaikovskyPI" "VivaldiA" "ScarlattiD" "PalestrinaG" "MonteverdiC"
  "PachelbelJ" "BuxtehudeD" "AlbenizIMF" "AguadoD" "SorF" "GiulianiM"
  "CarcassiM" "TarregaF" "PaganiniN" "GriegE" "DvorakA" "SibeliusJ"
  "RavelM" "FaureG" "SatieE" "BartokB" "ProkofievS" "ShostakovichD"
  "RachmaninoffS" "StravinskyI" "WagnerR" "VerdiG" "PucciniG"
  "BachCPE" "TelemannGP" "CorelliA" "PurcellH" "ByrdW" "DowlandJ"
)

mkdir -p "$OUT"

echo "=== NoteSnap Mutopia Downloader ==="
echo "Composers: ${#COMPOSERS[@]}"
echo "Parallel: $PARALLEL"
echo ""

START_TIME=$(date +%s)
TOTAL_DL=0
TOTAL_FAIL=0

# ---------------------------------------------------------------------------
# Phase 1: Build download list for all composers
# ---------------------------------------------------------------------------
DL_LIST="/tmp/mutopia-dl-list.txt"
rm -f "$DL_LIST"
touch "$DL_LIST"

for comp in "${COMPOSERS[@]}"; do
  echo "[scan] $comp"
  
  # Fetch composer listing
  HTML=$($CURL "$BASE/$comp/" 2>/dev/null || true)
  if [ -z "$HTML" ]; then
    echo "  ✗ Failed to fetch composer listing"
    continue
  fi
  
  # Extract catalog directories
  CATALOGS=$(echo "$HTML" | grep -oP 'href="\K[^"]+(?=/")' | grep -v '^\?\|^/\|Parent' | head -100 || true)
  CAT_COUNT=$(echo "$CATALOGS" | grep -c . 2>/dev/null || echo 0)
  echo "  $CAT_COUNT catalogs"
  
  PIECE_COUNT=0
  for cat in $CATALOGS; do
    [ -z "$cat" ] && continue
    CAT_HTML=$($CURL "$BASE/$comp/$cat/" 2>/dev/null || true)
    [ -z "$CAT_HTML" ] && continue
    
    # Check for sub-directories (piece names)
    PIECES=$(echo "$CAT_HTML" | grep -oP 'href="\K[^"]+(?=/")' | grep -v '^\?\|^/\|Parent' | head -10 || true)
    
    if [ -n "$PIECES" ]; then
      # 3-level: Composer/Catalog/Piece/files
      for piece in $PIECES; do
        [ -z "$piece" ] && continue
        PIECE_HTML=$($CURL "$BASE/$comp/$cat/$piece/" 2>/dev/null || true)
        [ -z "$PIECE_HTML" ] && continue
        
        # Get files
        FILES=$(echo "$PIECE_HTML" | grep -oP 'href="\K[^"]+\.(pdf|ly|mid|midi|rdf|zip)"' | head -20 || true)
        for f in $FILES; do
          SAFE_PIECE=$(echo "$piece" | tr ' ' '_' | tr -cd 'a-zA-Z0-9_-')
          DEST="$OUT/$comp/$cat/$SAFE_PIECE/$f"
          echo "$BASE/$comp/$cat/$piece/$f|$DEST" >> "$DL_LIST"
        done
        
        # Also get zip files (might not match the regex)
        ZIP_FILES=$(echo "$PIECE_HTML" | grep -oP 'href="\K[^"]+\.zip"' | head -10 || true)
        for f in $ZIP_FILES; do
          SAFE_PIECE=$(echo "$piece" | tr ' ' '_' | tr -cd 'a-zA-Z0-9_-')
          DEST="$OUT/$comp/$cat/$SAFE_PIECE/$f"
          echo "$BASE/$comp/$cat/$piece/$f|$DEST" >> "$DL_LIST"
        done
        
        PIECE_COUNT=$((PIECE_COUNT + 1))
      done
    fi
    
    # Check for files directly at catalog level
    DIRECT_FILES=$(echo "$CAT_HTML" | grep -oP 'href="\K[^"]+\.(pdf|ly|mid|midi|rdf|zip)"' | head -20 || true)
    for f in $DIRECT_FILES; do
      DEST="$OUT/$comp/$cat/$f"
      echo "$BASE/$comp/$cat/$f|$DEST" >> "$DL_LIST"
    done
  done
  
  echo "  → ~$PIECE_COUNT pieces"
done

TOTAL_FILES=$(wc -l < "$DL_LIST")
echo ""
echo "Download list: $TOTAL_FILES files"
echo ""

# ---------------------------------------------------------------------------
# Phase 2: Download in parallel
# ---------------------------------------------------------------------------
download_one() {
  local entry="$1"
  local url="${entry%%|*}"
  local dest="${entry##*|}"
  
  mkdir -p "$(dirname "$dest")"
  
  for i in 1 2 3; do
    if curl -sf --connect-timeout 30 --tls-max 1.2 --max-time 90 "$url" -o "$dest" 2>/dev/null; then
      if [ -f "$dest" ] && [ -s "$dest" ]; then
        echo "OK"
        return 0
      fi
    fi
    [ $i -lt 3 ] && sleep 2
  done
  echo "FAIL"
  return 1
}

export -f download_one
export CURL OUT

echo "Downloading $TOTAL_FILES files with $PARALLEL parallel workers..."

# Use xargs for parallel download
cat "$DL_LIST" | xargs -P "$PARALLEL" -I {} bash -c 'download_one "$@"' _ {} > /tmp/mutopia-dl-results.txt 2>/dev/null

DL_OK=$(grep -c "OK" /tmp/mutopia-dl-results.txt 2>/dev/null || echo 0)
DL_FAIL=$(grep -c "FAIL" /tmp/mutopia-dl-results.txt 2>/dev/null || echo 0)

echo "Downloaded: $DL_OK, Failed: $DL_FAIL"

# ---------------------------------------------------------------------------
# Phase 3: Extract zips
# ---------------------------------------------------------------------------
echo ""
echo "Extracting zip files..."
ZIP_COUNT=0
find "$OUT" -type f -name "*.zip" | while read -r zf; do
  dest_dir="${zf%.zip}"
  mkdir -p "$dest_dir"
  if unzip -o "$zf" -d "$dest_dir" > /dev/null 2>&1; then
    rm -f "$zf"
    echo "extracted: $zf"
  fi
done | wc -l | { read cnt; ZIP_COUNT=$cnt; }
echo "Zips extracted: $ZIP_COUNT"

# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
FINAL_COUNT=$(find "$OUT" -type f | wc -l)
FINAL_SIZE=$(du -sh "$OUT" 2>/dev/null | cut -f1)

echo ""
echo "=== Summary ==="
echo "Files downloaded: $DL_OK"
echo "Failed: $DL_FAIL"
echo "Total files on disk: $FINAL_COUNT"
echo "Total size: $FINAL_SIZE"
echo "Time: ${ELAPSED}s"
