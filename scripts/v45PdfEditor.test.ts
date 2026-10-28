/**
 * v45PdfEditor.test.ts — v45 slice 5: print / share as PDF FROM THE NOTATION
 * EDITOR, exporting the TRANSPOSED score.
 *
 * The reader's export is pinned by `scripts/scorePdf.test.ts` (v44 slice C) and
 * that suite is untouched by this one. What is proven HERE:
 *
 * 1. THE TRANSPOSED EXPORT IS THE SAME WHOLE SCORE, RE-KEYED. The editor hands
 *    the builder `transposedAbc` + `keyLabels.to` + `offset`; taking a bundled
 *    public-domain piece through exactly that path keeps every bar of the original
 *    and produces a header/file name that say the new key — while an export of the
 *    ORIGINAL ABC produces a visibly different document. That difference is the
 *    defect class the guards below exist to catch, proven on real score data.
 *
 * 2. THE EDITOR IS WIRED. The real screen is read as SOURCE (tier1 never compiles
 *    screens) and the four v45PdfEditorContract predicates must hold on it.
 *
 * 3. THE GUARDS BITE. Each predicate is fed a MUTATED copy of that same real text
 *    — handler stripped, ABC sliced, the ORIGINAL ABC handed over instead of the
 *    transposed one, the accessibility label dropped, the hint dropped, the CTA
 *    wired to nothing, the key label dropped, the offset dropped, an edition claim
 *    typed in, a link added — and must FAIL. A guard that survives a mutation is a
 *    tautology, not a guard.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
import { PUBLIC_DOMAIN_ABC_SCORES } from '../src/data/abcScores';
import { extractAbcKey, transposeAbc, transposeKeyLabel } from '../src/services/abcTranspose';
import { countAbcBars } from '../src/services/transposedScore';
import { buildScorePdf, scorePdfFileName } from '../src/services/scorePdf';
import {
  EDITOR_SCREEN_PATH,
  editorExportsTheTransposedWholeScore,
  editorHasPrintPdfControl,
  editorPdfCopyMakesNoEditionClaim,
  editorPdfExportStaysLocal,
} from '../src/services/v45PdfEditorContract';

declare const require: any;
declare const process: any;

let passes = 0;
let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  try {
    assert.deepStrictEqual(actual, expected);
    passes += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures += 1;
    console.error(
      `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'app.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

// ─── 1. The transposed export is the whole score, re-keyed ──────

console.log('\nv45S5-1 — the editor\'s export path prints every bar, in the key on screen');
const piece = PUBLIC_DOMAIN_ABC_SCORES[0];
const offset = 2;
const transposedAbc = transposeAbc(piece.abc, offset);
const sourceKeyLabel = extractAbcKey(piece.abc) ?? piece.keyLabel ?? 'C';
const keyLabels = transposeKeyLabel(sourceKeyLabel, offset);

/** THE EDITOR'S OWN CALL SHAPE (what `handleExportPdf` passes), end to end. */
const fromEditor = buildScorePdf({
  abc: transposedAbc,
  title: piece.title,
  keyLabel: keyLabels.to,
  offset,
});
/** The same export if it handed over the ORIGINAL/opened ABC (the defect). */
const fromOriginalAbc = buildScorePdf({
  abc: piece.abc,
  title: piece.title,
  keyLabel: keyLabels.to,
  offset,
});

assertEq(countAbcBars(transposedAbc), countAbcBars(piece.abc), 'the transposed ABC keeps every bar of the piece');
assertEq(fromEditor ? fromEditor.drawnMeasures : -1, countAbcBars(transposedAbc), 'the PDF drawn from it carries every bar (no excerpt)');
assertEq(fromEditor ? fromEditor.drawnMeasures : -2, fromEditor ? fromEditor.measureCount : -2, 'every parsed bar is drawn');
assertEq(fromEditor ? fromEditor.drawnNotes : -1, fromEditor ? fromEditor.noteCount : -1, 'every parsed note is drawn');
assertEq(
  fromEditor ? fromEditor.headerLine.indexOf(`transposed to ${keyLabels.to} (+${offset} semitones)`) >= 0 : false,
  true,
  'the page says the key it is in and by how much',
);
assertEq(
  scorePdfFileName({ title: piece.title, keyLabel: keyLabels.to, offset }).indexOf(`(transposed ${keyLabels.to})`) >= 0,
  true,
  'the file itself is named as a transposed copy in that key',
);
assertEq(
  fromEditor && fromOriginalAbc ? fromEditor.contents.join('') !== fromOriginalAbc.contents.join('') : false,
  true,
  'the PDF built from the TRANSPOSED ABC is a different document from one built from the ORIGINAL ABC (the notes move)',
);
assertEq(
  fromEditor && fromOriginalAbc ? fromEditor.headerLine === fromOriginalAbc.headerLine : false,
  true,
  'the page header cannot tell those two apart (keyLabel and offset are passed in) — which is exactly why a SOURCE guard has to pin the transposed ABC',
);

// ─── 2. The editor screen is really wired ──────────────────────

console.log('\nv45S5-2 — the notation editor renders a real export control, wired to the transposed score');
const editorSource = read(EDITOR_SCREEN_PATH);
assertEq(editorHasPrintPdfControl(editorSource), true, 'the editor has the print / share-as-PDF control and its handler calls the export');
assertEq(editorExportsTheTransposedWholeScore(editorSource), true, 'the editor hands over `transposedAbc` — every bar, in the key on screen — never a slice and never the loaded ABC');
assertEq(editorPdfCopyMakesNoEditionClaim(editorSource), true, 'the control\'s words are the builder\'s own constants, and no edition claim is made');
assertEq(editorPdfExportStaysLocal(editorSource), true, 'the export is local: no link, no retailer, no browser');
assertEq(
  editorSource.indexOf('abc: transposedAbc,') >= 0 &&
    editorSource.indexOf('keyLabel: keyLabels.to,') >= 0,
  true,
  'the call site itself carries the transposed ABC (not the original) and the key label',
);
assertEq(
  editorSource.indexOf("export const EDITOR_PDF_CTA = SCORE_PDF_CTA;") >= 0 &&
    editorSource.indexOf('export const EDITOR_PDF_HINT = SCORE_PDF_HINT;') >= 0,
  true,
  'the editor\'s copy is IMPORTED from the builder, never re-typed',
);

// ─── 3. The guards bite (in-suite mutations of the REAL source) ─

console.log('\nv45S5-3 — each guard FAILS on a mutated copy of the real editor source');

/**
 * THE EXPORT CALL SITE, pinpointed. `abc: transposedAbc,` also appears in
 * `handleOpenReader`'s navigate params (the same score, opened instead of
 * exported), so a probe that replaces the FIRST occurrence would mutate the
 * reader handoff and leave the export intact — a probe that proves nothing. The
 * mutations below anchor on the export call's own two lines.
 */
const SEND_TRANSPOSED = 'abc: transposedAbc,\n        title: selected.title,';
assertEq(
  editorSource.split(SEND_TRANSPOSED).length - 1,
  1,
  'the export call site is uniquely identifiable in the real source (probes anchor on it)',
);

// A. The handler calls no export at all.
const noExportCall = editorSource.replace(/shareScorePdf\(/g, 'noopShare(');
assertEq(noExportCall !== editorSource, true, 'probe A applied (the export call is stripped)');
assertEq(editorHasPrintPdfControl(noExportCall), false, '…the control guard FAILS (a button that exports nothing)');
assertEq(editorExportsTheTransposedWholeScore(noExportCall), false, '…and the whole-score guard FAILS');

// B. The export is fed a SLICE of the score.
const slicedAbc = editorSource.replace(
  SEND_TRANSPOSED,
  'abc: transposedAbc.slice(0, 120),\n        title: selected.title,',
);
assertEq(slicedAbc !== editorSource, true, 'probe B applied (a slice reaches the builder from the EXPORT call)');
assertEq(editorExportsTheTransposedWholeScore(slicedAbc), false, '…the whole-score guard FAILS (the 4-bar class is caught on the editor too)');

// C. The ORIGINAL/loaded ABC is handed over instead of the transposed one.
const originalAbc = editorSource.replace(
  SEND_TRANSPOSED,
  'abc: selected.abc,\n        title: selected.title,',
);
assertEq(originalAbc !== editorSource, true, 'probe C applied (the opened ABC is exported instead of the key on screen)');
assertEq(editorExportsTheTransposedWholeScore(originalAbc), false, '…the transposed-score guard FAILS');

// C2. …or the held source text, the other way to export the original key.
const heldSourceAbc = editorSource.replace(
  SEND_TRANSPOSED,
  'abc: sourceAbc,\n        title: selected.title,',
);
assertEq(heldSourceAbc !== editorSource, true, 'probe C2 applied (the held source ABC is exported)');
assertEq(editorExportsTheTransposedWholeScore(heldSourceAbc), false, '…and it FAILS on that too');

// D. No accessibility label: a control a screen reader cannot name.
const noLabel = editorSource.replace(/accessibilityLabel={EDITOR_PDF_CTA}/g, '');
assertEq(noLabel !== editorSource, true, 'probe D applied (the accessibility label is dropped)');
assertEq(editorHasPrintPdfControl(noLabel), false, '…the control guard FAILS');

// E. No honest explanation under the control.
const noHint = editorSource.replace(/\{EDITOR_PDF_HINT\}/g, '');
assertEq(noHint !== editorSource, true, 'probe E applied (the hint is dropped)');
assertEq(editorHasPrintPdfControl(noHint), false, '…the control guard FAILS');

// F. The control is wired to nothing (renders, does nothing).
const deadCta = editorSource.replace('onPress={handleExportPdf}', 'onPress={() => undefined}');
assertEq(deadCta !== editorSource, true, 'probe F applied (the Pressable calls nothing)');
assertEq(editorHasPrintPdfControl(deadCta), false, '…the control guard FAILS (the dead-area class is caught)');

// G. The key label is lost, so the file cannot say which key it is in.
const noKeyLabel = editorSource.replace(
  'keyLabel: keyLabels.to,\n        offset,',
  'keyLabel: "",\n        offset,',
);
assertEq(noKeyLabel !== editorSource, true, 'probe G applied (the key label is dropped from the export)');
assertEq(editorExportsTheTransposedWholeScore(noKeyLabel), false, '…the transposed-score guard FAILS');

// H. The offset is lost, so a transposed copy is named as the original.
const noOffset = editorSource.replace(
  '        keyLabel: keyLabels.to,\n        offset,\n',
  '        keyLabel: keyLabels.to,\n',
);
assertEq(noOffset !== editorSource, true, 'probe H applied (the offset is dropped from the export)');
assertEq(editorExportsTheTransposedWholeScore(noOffset), false, '…the transposed-score guard FAILS');

// I. An edition claim enters the copy.
const claimed = editorSource.replace(
  "export const EDITOR_PDF_CTA = SCORE_PDF_CTA;",
  "export const EDITOR_PDF_CLAIM = 'Official edition';\nexport const EDITOR_PDF_CTA = SCORE_PDF_CTA;",
);
assertEq(claimed !== editorSource, true, 'probe I applied (an edition claim is typed into the screen)');
assertEq(editorPdfCopyMakesNoEditionClaim(claimed), false, '…the no-claim guard FAILS');

// I2. The label is re-typed on the surface instead of reused.
const retyped = editorSource.replace(
  'export const EDITOR_PDF_CTA = SCORE_PDF_CTA;',
  "export const EDITOR_PDF_CTA = 'Print / share as PDF';",
);
assertEq(retyped !== editorSource, true, 'probe I2 applied (the label is re-typed instead of reused)');
assertEq(editorPdfCopyMakesNoEditionClaim(retyped), false, '…the no-claim guard FAILS');

// J. A link sneaks into a surface that must be a pure local export.
const url = 'htt' + 'ps://' + 'sheet' + 'musicdirect' + '.com/search';
const linked = editorSource.replace(
  'const outcome = await shareScorePdf({',
  'await Linking.' + "openURL('" + url + "');\n      const outcome = await shareScorePdf({",
);
assertEq(linked !== editorSource, true, 'probe J applied (a retailer link is opened from the export handler)');
assertEq(editorPdfExportStaysLocal(linked), false, '…the local-export guard FAILS');

// ─── Totals ────────────────────────────────────────────────────

console.log(`\nV45-PDF-EDITOR SUITE: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
