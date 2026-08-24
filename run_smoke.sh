#!/bin/bash
cd /home/team/shared/site
export DATABASE_URL=$(grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')
# 1) Generate the two WAV fixtures (Für Elise re-render; unrelated Chopin)
bun run scripts/smoke-gen.ts > /tmp/smoke_gen.log 2>&1
echo "GEN_EXIT=$? $(tail -1 /tmp/smoke_gen.log)"
ls -la /tmp/smoke_elise_rerender.wav /tmp/smoke_chopin_trim.wav 2>&1
echo "========== (a) Für Elise RE-RENDER (different gain + 18dB noise) =========="
curl -s -m 60 -X POST http://127.0.0.1:3000/api/recognize \
  -H "x-user-id: smoke-a-001" \
  -F "audio=@/tmp/smoke_elise_rerender.wav;type=audio/wav"
echo
echo "========== (b) Unrelated Chopin Nocturne Op.9 No.2 (NOT in catalog) =========="
curl -s -m 60 -X POST http://127.0.0.1:3000/api/recognize \
  -H "x-user-id: smoke-b-001" \
  -F "audio=@/tmp/smoke_chopin_trim.wav;type=audio/wav"
echo
