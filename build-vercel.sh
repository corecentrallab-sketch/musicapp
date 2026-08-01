#!/usr/bin/env bash
# Produce a Vercel Build Output API bundle (.vercel/output) for this site, then
# deploy it with:  bunx vercel deploy --prebuilt
#
# Why Build Output API instead of Vercel's Vite/framework detection:
#  - TanStack Start emits a host-agnostic fetch handler (dist/server/server.js)
#    that dynamic-imports its own ./assets chunks and externalizes node deps.
#    Letting Vercel trace/detect that is fragile.
#  - Bundling it into one self-contained file (deps + dynamic chunks inlined) in a
#    single render.func removes all tracing/detection risk. vercel-entry.ts adapts
#    the Node (req,res) launcher to the web fetch handler.
set -euo pipefail
cd "$(dirname "$0")"
umask 002

echo "[1/3] vite build (light — safe under the sandbox memory cap)"
# The workspace starts as sources only (deps live with the image's pre-built
# placeholder copy); no-op once node_modules is current.
bun install
bun run build

echo "[2/3] assemble .vercel/output (Build Output API v3)"
rm -rf .vercel/output
mkdir -p .vercel/output/functions/render.func
cp -R dist/client .vercel/output/static
rm -f .vercel/output/static/index.html   # SSR owns "/", not a static shell

echo "[3/4] bundle SSR handler + deps into the render function"
bun build vercel-entry.ts --target node \
  --outfile .vercel/output/functions/render.func/index.mjs

# Native fpcalc is tiny and statically linked. Audio conversion is deliberately
# done with audio-decode (WASM/JS) in src/services/fpcalc.ts, avoiding ffmpeg's
# 100MB+ binary and Vercel's 50MB uncompressed function limit.
BIN_DIR=$(mktemp -d)
trap 'rm -rf "$BIN_DIR"' EXIT
FPCALC_URL="https://github.com/acoustid/chromaprint/releases/download/v1.6.1/chromaprint-fpcalc-1.6.1-linux-x86_64.tar.gz"
echo "Downloading fpcalc ($(curl -LsI "$FPCALC_URL" | awk 'tolower($0) ~ /^content-length:/ {print $2}' | tail -1 | tr -d '\r') bytes)"
curl -L --fail --silent --show-error "$FPCALC_URL" -o "$BIN_DIR/fpcalc.tgz"
tar -xzf "$BIN_DIR/fpcalc.tgz" -C "$BIN_DIR"
cp "$BIN_DIR/chromaprint-fpcalc-1.6.1-linux-x86_64/fpcalc" .vercel/output/functions/render.func/fpcalc
chmod 755 .vercel/output/functions/render.func/fpcalc

cat > .vercel/output/functions/render.func/.vc-config.json <<'JSON'
{ "runtime": "nodejs22.x", "handler": "index.mjs", "launcherType": "Nodejs", "supportsResponseStreaming": true }
JSON
cat > .vercel/output/config.json <<'JSON'
{ "version": 3, "routes": [ { "handle": "filesystem" }, { "src": "/(.*)", "dest": "/render" } ] }
JSON

echo "done -> .vercel/output ready for: bunx vercel deploy --prebuilt"
