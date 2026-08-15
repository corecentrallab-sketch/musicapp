#!/usr/bin/env bash
# Rebuild the site and (re)start the production server on port 3000.
# Build runs in the foreground so errors surface; the server is launched in a new
# session (setsid) so it keeps running after this script — and your shell — exits.
# serve.ts frees the port (across user boundaries, retrying on races) before
# binding, so this is safe to re-run no matter who started the current server.
set -euo pipefail
cd "$(dirname "$0")"

# Group-writable so any team member can publish over another member's build.
umask 002
mkdir -p .run

# The workspace starts as sources only (the coming-soon placeholder serves from
# the image's pre-built copy), so the first publish installs deps here. No-op
# once node_modules is current.
bun install
bun run build

# Provision the native fpcalc binary where the recognition pipeline spawns it
# (src/services/fpcalc.ts resolves it from dirname(import.meta.url)). The preview
# server (serve.ts) imports the API handlers from source, so it looks in
# src/services/fpcalc; the SSR bundle (dist/server) has a bundled copy of the same
# module, so it also gets one beside it. build-vercel.sh provisions its own copy
# inside render.func for Vercel; without this the preview's /api/recognize can
# never fingerprint real audio. Prefer an existing local binary, then fall back
# to the same GitHub release build-vercel.sh uses. Idempotent.
provision_fpcalc() {
  local dst
  for dst in src/services/fpcalc dist/server/fpcalc; do
    if [ -x "$dst" ]; then continue; fi
    local src
    for src in /usr/local/bin/fpcalc .vercel/output/functions/render.func/fpcalc; do
      if [ -x "$src" ]; then
        cp "$src" "$dst" && chmod 755 "$dst" && break
      fi
    done
    if [ ! -x "$dst" ]; then
      local url="https://github.com/acoustid/chromaprint/releases/download/v1.6.1/chromaprint-fpcalc-1.6.1-linux-x86_64.tar.gz"
      local tmp; tmp=$(mktemp -d)
      if curl -L --fail --silent --show-error "$url" -o "$tmp/fpcalc.tgz"; then
        tar -xzf "$tmp/fpcalc.tgz" -C "$tmp"
        cp "$tmp/chromaprint-fpcalc-1.6.1-linux-x86_64/fpcalc" "$dst"
        chmod 755 "$dst"
      fi
      rm -rf "$tmp"
    fi
  done
  if [ ! -x src/services/fpcalc ]; then
    echo "warning: could not provision fpcalc — /api/recognize will reject real audio" >&2
  fi
}
provision_fpcalc
# Load .env for the server process (setsid doesn't auto-load Bun's .env)
export $(grep -v '^#' .env | xargs) 2>/dev/null || true
setsid nohup env DATABASE_URL="$DATABASE_URL" bun run start > .run/server.log 2>&1 < /dev/null &

# Wait for the new server to actually answer before reporting success, so a
# startup crash surfaces here instead of silently leaving the old page live.
for _ in $(seq 1 50); do
  if curl -sf -o /dev/null http://localhost:3000; then
    echo "site published; serving on port 3000"
    exit 0
  fi
  sleep 0.2
done
echo "warning: published, but the server isn't responding — check .run/server.log" >&2
exit 1
