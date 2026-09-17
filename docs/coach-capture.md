# Practice-coach capture path (slice 3 decision gate)

**Status:** the coach UI, scoring pipeline and history are complete and merged
(slices 1–3). The single open item is turning a *recorded practice take* into
the mono Float32 samples `scoreCoachRun()` needs. This note records exactly what
was verified on the device path, what shipped, and the options for closing it.

## What was verified (2026-09-17)

| Question | Finding |
| --- | --- |
| What does the existing recorder produce? | `src/hooks/useAudioRecorder.ts` records with explicit `Audio.RecordingOptions`: Android = MPEG-4 container / **AAC** encoder / 44.1 kHz / stereo / 128 kbps, extension `.m4a`. iOS = MPEG4AAC `.m4a`. |
| Does it expose samples? | **No.** expo-av's `Audio.Recording` exposes `getURI()` and `getStatusAsync()` (duration, metering dB) only. There is no PCM buffer API. |
| Can expo-av record WAV/LPCM on Android? | **No.** `Audio.AndroidOutputFormat` = DEFAULT, THREE_GPP, MPEG_4, AMR_NB, AMR_WB, AAC_ADIF, AAC_ADTS, RTP_AVP, MPEG2TS, WEBM — no WAV/LPCM/RAW member. `AndroidAudioEncoder` has no PCM encoder either, and Android's `MediaRecorder` cannot write a PCM container at all. |
| Is there an in-app decode path? | **Not with the current dependencies.** No ffmpeg/AAC decoder package is installed (`expo-av`, `react-native-blob-util` offer no decode-to-PCM), and this session was not allowed to add npm dependencies. |

So on Android today, the app can *record* practice audio but cannot *decode* it
to samples in-process. Nothing was faked: the card shows an honest
"coaching needs one more piece" state, keeps the accuracy row hidden, and saves
nothing to the practice history.

## What shipped in slice 3

- `src/services/wavCapture.ts` — the bytes→samples decoder (RIFF/WAVE PCM8/16/24/32
  and float32, any channel count downmixed, base64 PCM16, linear resampling, and
  the `toCoachSamples()` funnel that fixes the coach rate at 22.05 kHz). Strictly
  tested on synthetic buffers.
- `src/services/coachCapture.ts` — **the seam**: `SamplesProvider =
  (uri) => {samples, sampleRate, durationSec}`. Ships the remote-decode provider
  (contract below) and fails with `CoachCaptureUnavailableError` when the decoder
  is absent. Injecting a different provider (in-app decoder, fixtures) requires no
  UI change.
- `src/hooks/useCoachRun.ts` — record → decode → score → save, built on the
  existing `useAudioRecorder` permission/recorder flow.
- `src/components/CoachPracticeCard.tsx` — the "Coached practice" card on the
  piece screen (`PieceDetailScreen`).
- `src/services/coachRun.ts`, `src/services/pieceAbc.ts` — the pure state machine,
  the honest outcome copy, and the reference-melody resolver.

## Options for wiring the microphone through to the coach

**Option A — backend decode route (RECOMMENDED).** Add
`POST /api/coach/pcm` to the site: reuse the AAC→PCM decode the hum pipeline
already performs, return PCM16, and the app side is already written:

```
POST {baseUrl}/api/coach/pcm
  multipart/form-data, field `audio` = the recorded .m4a clip
200 → { success: true, sampleRate, pcm16Base64, durationSec?, channels? }
    or a WAV body (Content-Type: audio/wav)
404/405/501/503 → the app shows the honest unavailable state
```

Cost: one small route handler (+ the same decode helper the hum route uses), no
app dependency change, works on Android and iOS identically, and the payload is
~1/2 the clip size after downmix/resample. Notes: keep `/api/coach/pcm` free of
storage (decode + return), rate-limit it like the recognition routes, and decide
with the owner whether practice audio should ever leave the device (it does not
today — the app sends nothing until the route exists).

**Option B — in-app decode via a hidden WebView + Web Audio.** Android's
WebView (Chromium) *can* `decodeAudioData()` an AAC/MP4 file and expose
`AudioBuffer.getChannelData()`; base64 the clip into a hidden WebView and post
Float32 (or Int16) chunks back. No backend, no new npm dependency, offline.
Cost/risk: new moving machinery in the app (base64 of ~200 KB, chunked
bridge transfer, WebView lifecycle under a Modal), must be device-verified, and
it only works where a WebView with the audio codecs exists.

**Option C — PCM-capable recorder dependency.** `expo-audio` /
`react-native-audio-api` / a small config-plugin `AudioRecord` bridge can write
PCM/WAV directly, then `decodeWavToFloat32()` (already shipped) reads it on disk.
Cleanest signal path, but it needs a dependency + a new native build, which puts
the v18 release timing at risk and was outside this session's constraints.

**Recommendation:** Option A now (fastest to a genuinely working v18 check,
reuses a decoder we already operate), then Option B or C later if the owner wants
coach audio to stay strictly on-device. The seam in `coachCapture.ts` means the
later switch is a one-line provider swap.

## ABC source for the reference melody

`src/services/pieceAbc.ts` resolves: catalog `abc` (preferred) → bundled
public-domain seeds (mirrors of the backend's `hum/melody-seeds.ts`, so the hum
recogniser and the coach agree on a piece's melody) → honest "coming soon". The
backend already stores abc in `melody_skeletons.abc`; exposing it on
`/api/daily-challenge` (and `/api/pieces/:id`) as an `abc` field needs no app
change — `fetchDailyChallenge()` already passes it through and the card prefers it.
Until then the coach covers the public-domain practice phrases (Für Elise, Ode to
Joy, Twinkle, Greensleeves, Jingle Bells, Canon in D, Happy Birthday, Anvil
Chorus) and says so honestly for everything else.
