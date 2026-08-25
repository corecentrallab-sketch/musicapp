# Landmark Fingerprint Accuracy Audit — Findings (engineer, 2026-08-25)

Full audit of every stored landmark fingerprint in `piece_landmarks`, triggered by
the launch-blocking on-device false positive (real Für Elise recording → matched
Schumann "Träumerei" Op.15 No.7 conf 1.0 on live /api/recognize).

## Headline result
- **The reported Für Elise→Träumerei false positive is NOT reproducible against the
  current DB.** With the real pipeline (verified-correct public-domain Mutopia MIDI →
  16kHz fluidsynth → +10dB room-noise rendition → `extractLandmarks` →
  `matchLandmarks` against live `piece_landmarks`):
  - Für Elise (WoO 59)  → **Für Elise, conf 1.000**
  - Träumerei (Op.15 No.7) → **Träumerei, conf 1.000**
  - Op.15 No.1 → Op.15 No.1, conf 1.000
- The false positive belonged to PR #53's collapse/swap contamination (Träumerei's
  fingerprint was built from a wrong sibling MIDI), which was **already fixed on the
  shared Neon DB** by PR #53 re-grounding + Clair-de-Lune PR #56. This audit found it
  is clean now.

## Audit method (reproducible)
- `scripts/audit-full-sweep.ts`: for every fingerprinted piece, render a
  **verified-correct public-domain Mutopia MIDI** (manual source manifest, raw-byte
  md5) → room-noise 22s rendition → match against live DB; classify
  PASS / CONFIDENT-WRONG / CROSS_FP(self-correct) / MISS / NOT_SOURCED; plus
  non-catalog controls.
- `scripts/audit-reground.ts`: re-ground contaminated pieces from verified-correct
  sources (PR53/56 convention), with reversible backup to /tmp.

## Full-sweep result (49 fingerprinted pieces before fix)
- **20 PASS** (self top ≥0.3, no other piece ≥0.3)
- **2 CONFIDENT WRONG** (another piece top ≥0.3): Op.52 Ballade No.4 → Op.10 No.1;
  Op.46 No.4 In the Hall of the Mountain King → Op.10 No.5
- **7 CROSS_FP** (SELF is top at high conf 0.81–1.0; a lower secondary also ≥0.3 —
  matcher precision, NOT wrong-top): Clair de Lune, Träumerei, Op.9 No.1, Op.31 No.2,
  Op.111, Op.13, Op.10 No.1
- **7 MISS** (no self ≥0.3 — returns honest empty): D.935 No.2, Op.72 No.1, Op.67,
  Op.92, Op.37a, BWV565, Op.69 No.2
- **13 NOT_SOURCED** (no verified-correct local MIDI — deferred, NOT deleted):
  BWV903, K397, BWV817, Op.50, BWV827, K457, K309, Op.11, Op.60, Op.6, Op.55, K265, D.733
- **Controls: 0 false positives** (white noise and sine sweep both returned EMPTY)

## Fixes applied (2 contaminated pieces)
| Piece | Correct source | Correct md5 | Stored before | Action | After |
|---|---|---|---|---|---|
| Op.46 No.4 Mountain King | fresh5/GriegE/O46/Dans_l_antre...mid | 2f537720b2... | self NONE / wrong-top Op.10 No.5 0.387 | REGROUND | **self conf 1.000** ✅ |
| Op.52 Ballade No.4 | fresh5/ChopinFF/O52/ballade-4/ballade-4.mid | 59c8471d65... | self 0.32 / wrong-top Op.10 No.1 0.35 | REGROUND then DELETED (cross-piece collision on correct data) | clean MISS (no confident-wrong) ✅ |

Op.52 note: after re-grounding from the CORRECT Ballade-4 MIDI it still produced a
near-tie wrong top (Op.10 No.1 ~0.35 ≈ self ~0.32) — a genuine cross-piece
collision/ranking gap on correct data, not contamination. Per the launch gate (no
confident-wrong title), its landmarks were removed so it degrades to a clean MISS.
Re-usable from /tmp/backup_Op._52.json when the matcher/render improves. Backups:
`/tmp/backup_Op._46_No._4.json`, `/tmp/backup_Op._52.json`, `/tmp/reground_audit_report.json`.

## Final trustworthy recognizable count
- **48 fingerprinted pieces** after Op.52 removal (Op.46 was fixed in place, count
  unchanged there). 1,153,551 landmark rows.
- Of these, the **audit-proven trustworthy** (self-match verified, top correct) =
  20 PASS + 7 CROSS_FP (top correct) = **27**; the 7 MISS return honest empties (no
  wrong answer); 13 NOT_SOURCED are unverified (deferred — may be correct, not
  proven). No remaining CONFIDENT-WRONG.

## Honest limitations / what remains uncertain
1. Sources for the 37 non-PR53/56 pieces were manually resolved from Mutopia; a few
   (esp. multi-movement sonatas/symphonies) use the first-movement render, so their
   MISS may be render-slice artifacts, not wrong data. Each requires a content
   workstream pass to fully confirm.
2. The 7 CROSS_FP pieces return the CORRECT title at top, but also produce a lower
   secondary match ≥0.3. The matcher's permissiveness (secondary collisions between
   e.g. Träumerei & Moment Musical, Op.10 No.1 & Träumerei — symmetric, so not
   contamination) is a precision concern, not a wrong-title one.
3. No provenance table exists in the schema; source md5s live only as code manifests.

## Recommends (follow-ups)
- Fix the shared MIDI resolver used by ingest/validate (PR#53 follow-up #1) so
  re-ingest never collapses distinct pieces onto one wrong file again.
- Add a `piece_landmarks_provenance` table (source md5 per piece) so provenance is
  auditable at rest.
- Content workstream to re-source & verify the MISS + NOT_SOURCED pieces from
  correct Mutopia/IMSLP sources before widening coverage.
