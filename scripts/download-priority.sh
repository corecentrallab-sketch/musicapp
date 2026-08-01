#!/usr/bin/env bash
# Fast Mutopia downloader — targets priority composers, parallel downloads
# Key insight: Mutopia requires --tls-max 1.2 for HTTPS
set -euo pipefail

BASE="https://www.mutopiaproject.org/ftp"
OUT="/home/team/shared/mutopia-data"
CURL="curl -sf --connect-timeout 15 --tls-max 1.2 --max-time 45"
PARALLEL=4
mkdir -p "$OUT"

# Priority composers covering ~80% of our 500-piece target list
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

download_file() {
  local url="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  $CURL "$url" -o "$dest" 2>/dev/null && echo "  ✓ $(basename "$dest")" || echo "  ✗ $(basename "$dest")"
}

process_composer() {
  local comp="$1"
  echo "[$comp] Scanning..."
  
  local pieces
  pieces=$($CURL "$BASE/$comp/" 2>/dev/null | grep -oP 'href="\K[^"]+/' | grep -v '^\?\|^/\|Parent' | head -80)
  [ -z "$pieces" ] && { echo "  No pieces"; return; }
  
  local pcount=0 total=0
  local piece_count
  piece_count=$(echo "$pieces" | grep -c . || echo 0)
  
  while IFS= read -r piece; do
    [ -z "$piece" ] && continue
    pcount=$((pcount + 1))
    local pname="${piece%/}"
    
    # Try direct files at this level
    local files
    files=$($CURL "$BASE/$comp/$pname/" 2>/dev/null | grep -oP 'href="\K[^"]+\.(zip|pdf|mid|midi|mxl|ly)$' | head -20)
    
    # Also try one level deeper
    if [ -z "$files" ]; then
      local subs
      subs=$($CURL "$BASE/$comp/$pname/" 2>/dev/null | grep -oP 'href="\K[^"]+/' | grep -v '^\?\|^/\|Parent' | head -3)
      for sub in $subs; do
        local sname="${sub%/}"
        local subfiles
        subfiles=$($CURL "$BASE/$comp/$pname/$sname/" 2>/dev/null | grep -oP 'href="\K[^"]+\.(zip|pdf|mid|midi|mxl|ly)$' | head -20)
        for f in $subfiles; do
          download_file "$BASE/$comp/$pname/$sname/$f" "$OUT/$comp/$pname/$sname/$f" &
          total=$((total + 1))
          if [ $((total % PARALLEL)) -eq 0 ]; then wait; fi
        done
      done
    else
      for f in $files; do
        download_file "$BASE/$comp/$pname/$f" "$OUT/$comp/$pname/$f" &
        total=$((total + 1))
        if [ $((total % PARALLEL)) -eq 0 ]; then wait; fi
      done
    fi
  done <<< "$pieces"
  wait
  echo "  → $total files from $pcount pieces"
}

echo "=== NoteSnap Mutopia Ingestion ==="
echo "Composers: ${#COMPOSERS[@]}"
echo "Parallel: $PARALLEL"
echo ""

for comp in "${COMPOSERS[@]}"; do
  process_composer "$comp"
done

echo ""
echo "=== Done ==="
find "$OUT" -type f | wc -l | xargs echo "Total files:"
du -sh "$OUT" 2>/dev/null || true
