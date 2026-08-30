# Hum / Whistle / Sing-to-Search — Phase 1 (SoundHound-style)

Tier-1 differentiator (#1 of the owner-approved launch spine). A SEPARATE,
harder algorithm than the Shazam-like audio-landmark matcher: it transcribes a
monophonic hummed/whistled/sung melody into a **relative-interval pitch contour**
and matches it against melody skeletons of catalog pieces, tolerant of key,
octave, and tempo drift. Scope: backend algorithm + `/api/hum` endpoint + tests.
**The mobile app UI is a follow-up — not built here.**

## Pipeline

```
upload (.m4a/.wav/.ogg)
  → decodeToMonoSamples()            (reuse fpcalc.ts audio-decode → mono PCM)
  → extractF0Track()                 f0.ts   YIN pitch estimation per frame
  → hzToMidi + smoothMidiTrack()     f0.ts   median filter (kills octave spikes)
  → segmentMidiToNotes()             contour.ts  collapse stable pitch runs
  → notesToPolyline()                contour.ts  → relative-interval DELTAS
  → matchMelody()                    matcher.ts  subsequence DTW vs skeletons
  → applyHumMatchPolicy()            matcher.ts  "no confident-wrong" gate
```

### f0 extraction (f0.ts)
YIN (de Cheveigné & Kawahara): difference function + cumulative-mean-normalized
difference, absolute-threshold + local-minimum search, parabolic interpolation,
per-frame voiced confidence. Window 60ms / hop 20ms over a 55–1000 Hz range
(covers hum to whistle). Output = per-frame f0 + voiced flag.

### Normalization to intervals (contour.ts)
Each stable voiced run becomes ONE note (median MIDI pitch). The contour is the
sequence of **adjacent semitone deltas** (`midi[i+1]-midi[i]`). Because deltas are
transposition-invariant, a hum in any key or hoctave yields the same contour —
in-melody octave leaps still surface as ±12 deltas. Durations are dropped, so
**tempo is automatically invariant** (a phrase hummed fast or slow gives the
same delta sequence). `NOTE_MERGE_SEMITONES=0.5` keeps genuine 1-semitone steps
(e.g. the E→D♯ alternation in Für Elise's opening) from being merged.

### Melody reference skeletons (skeleton.ts + melody-seeds.ts)
Reference skeletons are the same delta representation, derived from ABC via the
existing pure-TS `parseAbc` (rests dropped, chords→median). Phase 1 ships **8
public-domain pieces** mirrored from the app's notation-editor bundle
(`musicapp-update/src/data/abcScores.ts`): Für Elise, Ode to Joy, Twinkle,
Greensleeves, Jingle Bells, Canon in D, Happy Birthday, Anvil Chorus. Persistent
store = Neon `melody_skeletons` table (migration 006) + `scripts/build-melody-
skeletons.ts`; the runtime loader prefers the DB and **falls back to the bundled
seeds** when the table is empty/unavailable (zero cold-start cost).

### Matcher (dtw.ts + matcher.ts)
Subsequence DTW: free start (`D[0][j]=0`) so a short hummed motif is matched
inside a longer reference tune; symmetric gap penalty (1.0 semitone-equivalent)
absorbs inserted/skipped notes (e.g. extraction merges re-articulated repeated
notes); local pitch error is the |query−ref| semitone cost. Confidence =
`exp(-normalizedCost)`. Gating copies /api/recognize's philosophy: absolute floor
(0.55) + margin (0.12) + ratio (1.35) + single-match floor (0.7) + min query
length (4 deltas). Ambiguous/weak → empty matches (honest no-match).

## Endpoint

`POST /api/hum` — multipart/form-data with an `audio` file (same upload
contract as `/api/recognize`).

```jsonc
{
  "success": true,
  "matches": [ { "piece_id": "fur-elise", "title": "Für Elise",
                 "composer": "Ludwig van Beethoven", "confidence": 0.77 } ],
  "query_duration_ms": 25,
  "db_available": true,
  "contour_stats": { "notes": 9, "deltas": 8, "voiced_frames": .., "total_frames": ..,
                     "extracted_pitches": [..], "extracted_deltas": [..] },
  "no_confident_match_reason": "…only when the gate declines to name a piece"
}
```

Wired into `serve.ts` (dev) and `vercel-entry.ts` (prod). Type-checked clean via
`tsconfig.hum-check.json` (`bunx tsc -p tsconfig.hum-check.json` → 0 errors;
this scoped config avoids the repo-wide pre-existing Bun-typing noise).

## Tests (bun test src/services/hum/hum.test.ts) — all pass, deterministic

1. Relative-interval normalization — deltas invariant to key change (+7) and octave shift (+12).
2. `skeletonFromAbc` — Für Elise reference contour == [-1,1,-1,1,-5,3,-2,-3].
3. Tempo-warp — faster hum still matches (conf > 0.6).
4. No-false-positive control — unrelated melody → gate rejects (no confident match).
5. Extract→match round-trip — synthesized hum of Für Elise's opening
   (imperfect ±0.3 semitone, octave-offset) → **top = Für Elise conf ~0.84–0.87**,
   runner-up Greensleeves ~0.52–0.56 (margin well above gate).
6. `/api/hum` end-to-end (through audio-decode) — Für Elise WAV → **Für Elise,
   conf 0.77**, 5/5 repeated runs.

## Phase 1 does NOT include
- The mobile app "tap to hum → search" screen/UI (follow-up).
- Full-catalog skeleton population beyond the 8 bundled public-domain seeds
  (the Neon `melody_skeletons` table + build script are ready; populating the
  remaining ~48 fingerprinted / 525 catalog pieces from their ABC/MIDI is a data
  step, not yet wired to production ABC locations for all pieces).
- Duration-weighted/rhythm scoring (deltas are pitch-only, so rhythm is unused).
- Deployment to Vercel (deliberately left to the lead).
