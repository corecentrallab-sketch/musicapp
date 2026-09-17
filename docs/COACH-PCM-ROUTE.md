# POST /api/coach/pcm — practice-coach audio decode (backend half of "coach mic capture")

**Status:** shipped, deployed and live-verified 2026-09-17 (site PR: see the PR for this
branch). Closes Option A of the slice-3 decision gate in the app repo
(`musicapp-update/docs/coach-capture.md`), which is why the merged **Coached practice**
card can now actually score a real microphone take.

## Why it exists

The app records practice takes with expo-av, which on Android can only write compressed
**AAC/.m4a** and exposes a file URI — never PCM samples (`AndroidOutputFormat` has no
WAV/LPCM member). The app therefore uploads the clip and asks the backend to decode it.
The app side (`src/services/coachCapture.ts`) is already written and **frozen** against
the contract below, so this route must not drift from it.

## Contract (frozen — do not change without the app side)

```
POST /api/coach/pcm
  multipart/form-data, field `audio` = the recorded .m4a clip

200  { success: true,
       sampleRate:   22050,            # rate of the samples below
       channels:     1,                # mono (already downmixed)
       pcm16Base64:  "...",            # base64 of little-endian signed 16-bit PCM
       durationSec:  <number>,         # seconds of audio returned
       sourceSampleRate, sourceChannels, truncated }   # additive diagnostics
400  missing / empty / oversized / undecodable upload   (JSON { success:false, error })
405  any non-POST method    (the app reads 404/405/501/503 as "decoder unavailable",
                             so a GET must never look like a working decoder)
429  per-IP rate limit (60/min)
500  unexpected server failure
```

The app decodes the payload with `wavCapture.decodePcm16Base64(..., channels)` →
`toCoachSamples()`, which resamples to its own 22.05 kHz coach rate. Because we already
return 22.05 kHz mono, that funnel is a no-op and the payload is half the size of the raw
44.1 kHz stereo capture.

## Decode reuse (the whole point)

The bytes go through **`decodeToMonoSamples()` in `src/services/fpcalc.ts`** — the exact
same decoder `/api/recognize` and `/api/hum` use. That is the `audio-decode` npm package
(pure JS/WASM); AAC/.m4a support comes from `@audio/decode-aac`'s FAAD2 WASM module, which
`build-vercel.sh` copies to `.vercel/output/functions/render.func/src/aac.wasm.cjs` so the
runtime `createRequire(import.meta.url)('./src/aac.wasm.cjs')` resolves inside the bundle.
**There is no ffmpeg anywhere in this stack** (deliberately — a 100 MB+ binary would blow
Vercel's function size limit).

The route adds only the packaging: downmix (done by the decoder) → linear resample to
22.05 kHz → int16 LE → base64. No new dependencies.

## Operational notes

- **Decode-and-return only.** This route never writes the upload to storage and never logs
  audio bytes — practice audio leaves the device and is discarded. (Unlike
  `/api/recognize` and `/api/hum`, which have debug persistence gated behind
  `PERSIST_RECOGNIZE_AUDIO`.)
- **Limits:** 4 MB upload (same as hum), 60 s of returned audio (a Vercel function
  response caps around 4.5 MB; 60 s mono @22.05 kHz ≈ 3.5 MB base64). Longer takes are
  decoded and truncated at the tail, reported via `durationSec` + `truncated`.
- **No identity/gating.** The app sends no `x-user-id` on this route, so it is not tied
  into the free-tier recognition cap; it has its own generous per-IP limiter (in-memory,
  resets on cold start — same caveat as `recognize-handler`'s limiter).
- **Wiring:** because TanStack Start v1.158 has no `createAPIFileRoute`, the route is
  intercepted in **both** server entries — `serve.ts` (working site, port 3000) and
  `vercel-entry.ts` (production function). Adding a route to only one of them is the
  classic way this site silently ships a 404 in production.

## Tests

`src/services/coach-pcm.test.ts` (run with `bun test`): WAV round-trip compared
sample-for-sample through a local copy of the app's own `decodePcm16Base64`, 44.1 kHz →
22.05 kHz resampling, the little-endian int16 encoder, a **real .m4a/AAC capture** from
`/home/team/shared/gate-test/` (skipped honestly if that fixture is absent), and the
400/405 paths.
