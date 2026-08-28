# On-device "No Match" — REAL-capture root cause (2026-08-28)

Diagnosed from the **actual ground-truth captures** persisted from live
`/api/recognize` (R2 bucket `notesnapscores`, `debug/` prefix, 11 objects). This
supersedes the synthetic-reproduction work (PR #67): the real phone-mic captures
fail in a way the synthetic harsh chains could not reproduce, and the real files
are the only ground truth that matters.

## Bottom line

**The robust landmark matcher is NOT the reason the owner's captures failed.**
It is proven correct on a genuine capture (Für Elise → confidence 1.000) and on
the synthetic harsh/room reproductions (1.000 / 0.782, noise → clean no-match).
The owner's 11 persisted captures fall into two groups, **neither of which any
matcher can name without guessing**:

1. **8 of 11 are decoded digital silence** (0 landmarks in both extractors) —
   the phone recorded no audible audio. This is a **capture-side** failure (mic
   not engaged / nothing playing / too faint), not a matcher defect.
2. **The only owner capture with audio** (`b270decd`, 02:29) is a heavily
   degraded ~12 s room recording whose **audible content is not the fingerprinted
   Für Elise reference** (it scores Träumerei/Erlkönig-like, best window conf
   ~0.54, and is ambiguous) — so it correctly returns **no-match**. Forcing a
   match here would produce a false positive, exactly what the launch
   "no-confident-wrong" rule forbids.

## The 11 captures

| Timestamp | Size | Decoded | Robust landmarks | Robust outcome |
|---|---|---|---|---|
| 01:03 `e2cc8a05` | 1.10 MB | **real Für Elise** (132 s) | 2022 | **OK For Elise conf 1.000** (engineer verify) |
| 01:04 `e9b5e432` | 706 KB | real (8 s WAV) | 1278 | NO-MATCH (below-threshold) — engineering control |
| 01:43 `1404589` | 115 KB | **silence** | 0 | NO-MATCH |
| 02:03 `2604101` | 143 KB | **silence** | 0 | NO-MATCH |
| 02:07 `2847605` | 147 KB | **silence** | 0 | NO-MATCH |
| 02:07 `2865217` | 147 KB | **silence** | 0 | NO-MATCH |
| 02:08 `2913035` | 146 KB | **silence** | 0 | NO-MATCH |
| 02:09 `2941259` | 148 KB | **silence** | 0 | NO-MATCH |
| 02:10 `3039139` | 148 KB | **silence** | 0 | NO-MATCH |
| 02:10 `3055810` | 148 KB | **silence** | 0 | NO-MATCH |
| 02:29 `b270decd` | 195 KB | real, degraded | 2022 | NO-MATCH (below-threshold); content ≠ Für Elise |

Decoding was double-checked with **two independent decoders** (ffmpeg native AAC
→ `Peak level -inf`; `audio-decode` → all-zero float32) plus raw `od` inspection
of the 16 kHz PCM (1,030,144 bytes, zero non-zero samples), so the silence is
real in the persisted files — not a decode artifact. The silent files carry a
~96 kbps constant-bitrate AAC payload (normal for an Android recorder encoding
near-silence at a fixed bitrate), which is why they are 143 KB despite holding no
audible signal.

## What the one audio-bearing capture (b270decd) contains

- waveform: peak **−0.7 dBFS**, RMS **−20.5 dBFS** → ~20 dB crest factor;
  active-fraction 14%; energy concentrated in the **final ~2–3 s** of the 12 s
  window (frames ramp −39…−3,0 dB rel max) — i.e. ~9 s of near-silence + ~2.5 s
  of music.
- spectral/melodic probe: ~658 Hz (E5), ~580 Hz (D5), ~531/519 Hz (C5/B4) appear
  in bursts — consistent with *some* piano melody, but buried under dominant
  ~100–230 Hz room rumble and **not** a clean Für Elise line.
- Live matcher, full 12 s window (robust): top = Träumerei **0.297**, Waterfall
  0.266, Kuriose 0.216, Study 0.184, Erlkönig 0.147 → **below the 0.45 policy
  floor → no-match**.

## Fixes tested (all rejected with evidence — none help without hurting)

| Change | Result on b270decd | Why rejected |
|---|---|---|
| Global RMS/AGC normalization | identical (0.297) | extractor is scale-invariant (relative frame-max floor); gain is irrelevant |
| High-pass 150/200 Hz | Für Elise rises to ~0.183 but stays out of top-3, below floor | insufficient; does not recover a confident match |
| Raise robust BIN_MIN 7→16 (~250 Hz) | **worse** (Träumerei 526→183 votes) | low bins carry genuine reference hashes; discarding them harms |
| Active-window (keep most-energetic 2–4 s) | best-window conf rises (0.54) but is **ambiguous** (Träumerei vs Erlkönig tied) **and** it **breaks the genuine 132 s capture** (1.000 → NO-MATCH) | unfaithful on real music-length clips; cannot be default-on |

No matcher/preprocessing change makes b270decd a confident Für Elise without
forcing a wrong/ambiguous guess. The honest outcome on this file is **no-match**,
which the current pipeline already returns.

## Recommended next actions (owner / lead)

1. **Confirm capture quality before attributing to matcher.** The dominant real
   failure is silent or near-silent recordings. Re-run the on-device test with:
   music playing **loud** from a second device ~0.5–1 m from the Pixel, the music
   audible **across the whole 12 s window** (not just its tail), and confirm the
   recording is audible before tapping Identify.
2. **App-side (recommended):** add a **pre-upload loudness gate** in the recorder
   so a silent/muted capture is immediately flagged ("No audio detected — move
   closer / turn up the music") instead of silently returning no-match. This is
   the real fix for 8/11 captures and lives in the React Native app, not the
   matcher. (The backend already 400s on 0 landmarks.)
3. **Re-verify with the harness in this PR** once a good capture is produced:
   `bun scripts/analyze-real-capture.ts <capture>` reproduces the exact live
   pipeline locally (stats + classic/robust + policy) so the next owner capture
   is validated in one command before any matcher change is contemplated.

## Files / evidence

- Real captures: R2 `notesnapscores`, `debug/recognize-*.m4a` (11 objects listed above).
- Diagnostic harness: `scripts/analyze-real-capture.ts` (this PR) — decode stats
  + classic/robust live-DB match + policy for any capture.
- A/B tooling already committed: `scripts/ab-extract.ts`, `scripts/device-harsh-repro.ts`,
  `scripts/dia-rvb.ts`, `scripts/fp-control.ts`; synthetic baselines in `/tmp/repro`.
