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

---

# ADDENDUM — vc13 (2026-08-28): loudness gate shipped, still "No Match found"
The vc13 pre-upload loudness gate (PR #70) was shipped and the owner reran the
on-device test with healthy telemetry (peak −3 dB / RMS −27 dB reported on-device).
Three captures were persisted from live `/api/recognize` at 05:06 / 05:09 / 05:10
(bucket `notesnapscores`, `debug/`):
`...1787893598230-70dc76b0`, `...1787893798069-be9e0825`, `...1787893821070-9cd8db4f`.

## Bottom line
**The loudness gate worked — all three vc13 captures are genuinely LOUD and
non-silent (no more 8/11-silent problem). But the audio content is NOT the
fingerprinted Für Elise reference.** Every capture produces a full landmark set
(1960–2790 query landmarks) yet converges on nothing (top confidence 0.15–0.29,
below the 0.45 policy floor) and has **zero Für Elise overlap**. The matcher and
the Für Elise reference are proven correct by control: the engineer's genuine
Für Elise capture (`e2cc8a05`) still scores **conf 1.000 (robust) / 0.855
(classic) → OK** through the exact same pipeline. No matcher/preprocessing
change can name these captures as Für Elise without a false positive → **no safe
fix exists**; this is an evidence + recommendation outcome, not a code change.

## The three vc13 captures (healthy, non-silent, but not Für Elise)
| File (suffix) | Peak / RMS / crest | active | q-landmarks (classic/robust) | Top candidate (robust conf) | Für Elise |
|---|---|---|---|---|---|
| `70dc76b0` (05:06) | −1.4 / −18.0 / 16.6 dB | 27.5% (18/24) | 2719 / 2006 | Nocturne E min 0.180 | **0 entries** |
| `be9e0825` (05:09) | −0.9 / −19.8 / 19.0 dB | 18.3% (9/24) | 2714 / 1964 | Nocturne E min 0.273 | **0 entries** |
| `9cd8db4f` (05:10) | −1.7 / −19.3 / 17.6 dB | 22.5% (13/24) | 2712 / 1962 | Minute Waltz 0.289 | **0 entries** |

All three show the classic "audio is not in the fingerprinted library" signature:
plenty of real landmarks but no piece reaches confidence, and the low random
top-candidate differs across captures (Nocturne / Black-Key & Minute Waltz /
Träumerei) — i.e. hash coincidences land on different pieces each time because
none of the fingerprinted references is actually present. The `70dc76b0` capture
is additionally dominant in the **low register (~40–260 Hz** fundamental), which
is not compatible with Für Elise's high-register theme.

## Control (proves matcher + reference are healthy)
`e2cc8a05` (engineer, genuine Für Elise, 132 s) through the SAME
`analyze-real-capture.ts --window 12`:
- CLASSIC: **Bagatelle in A Minor (Für Elise) conf 0.855** (votes 1812) → OK
- ROBUST: **Für Elise conf 1.000** (votes 1491) → OK

So a faithful Für Elise capture DOES match at high confidence. The vc13 captures
do not match because they do not contain that fingerprint.

## Recommendation (no code change)
1. **Play the exact fingerprinted reference.** The app only recognizes the Für
   Elise rendering that was fingerprinted (the one verified at conf 1.000). For
   the next on-device test, play **that same reference audio** (not a different
   recording/live performance/arrangement) from a second speaker ~0.5–1 m away,
   audible for the whole 12 s window.
2. **Verify before shipping another cycle:** after each test, run
   `bun scripts/analyze-real-capture.ts /path/capture.m4a` and confirm the top
   candidate is **Für Elise conf > 0.8**. If it isn't, the capture content is the
   issue — do not tap Identify / do not rebuild.
3. This is the expected behaviour of a fingerprint matcher: it matches the piece
   **rendering** it was fingerprinted against, not arbitrary performances of the
   same title. Broadening to "any real performance of Für Elise" is a
   *future* workstream (more reference renditions per piece), out of scope here.

## Files / evidence (vc13)
- Persisted captures: R2 `notesnapscores`, `debug/recognize-1787893{598230,798069,821070}-*.m4a`.
- Local copies + decoded WAV of the primary: `/home/team/shared/realcaptures-vc13/`
  (`vc13_70dc76b0.wav` is the listenable 16 kHz decode of the 05:06 capture).
- Diagnostics were produced with `scripts/analyze-real-capture.ts` (unchanged).

## Files / evidence
- A/B tooling already committed: `scripts/ab-extract.ts`, `scripts/device-harsh-repro.ts`,
  `scripts/dia-rvb.ts`, `scripts/fp-control.ts`; synthetic baselines in `/tmp/repro`.
