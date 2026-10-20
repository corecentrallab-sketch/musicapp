/**
 * uxr-v42-fixes.test.ts — THE v42 FIX-BATCH CONTRACTS (part 1).
 *
 * Four complaints from the v41 on-device pass (owner checklist email, 10-20), each
 * with a guard that BITES on the pre-fix code — every detector is exercised against
 * the real source AND against a mutation of it that restores the old defect:
 *
 *  A. TRANSPOSED FULL SCORE, "ONLY 4 BARS AGAIN". The notation editor's score card
 *     grew from a measurement that had already been clamped to the app's 4000px
 *     BOX ceiling, while the viewer stayed non-interactive — everything below the
 *     ceiling was unreachable on that surface. It now takes the reader's
 *     `wholeWork` band and applies no height of its own.
 *  B1. BLACK NOTES. The take's staff was painted with DARK palette literals passed
 *     as PROPS (the theme remapper only repaints StyleSheets), so in light mode it
 *     was a black block with dim grey notes on it. The paper/ink pair is now the
 *     shared palette, and its CONTRAST is asserted (WCAG AA) rather than eyeballed.
 *  B2. A ONE-BAR TAKE. The staff sat in a FIXED 132px box with `overflow: hidden`,
 *     so any take was clipped to about one bar. The box is a floor the viewer grows
 *     into (non-interactive by default, so it measures its own document).
 *  C. THE SCANNED SCORE'S DEAD CONTROLS. A photo has no notes the app can read (no
 *     OMR), no score following and no audio — so BPM auto-scroll and its Play
 *     button could only ever turn pages on a timer blind to the music. Removed from
 *     that surface, with the reason stated; the PDF reader keeps the control.
 *  D. THE OCR PREFILL. A read-from-a-photo string was written into the query field
 *     and the debounced search ran on the first frame, so garbage became an
 *     invisible auto-query and a "No Match". A read is now a PROPOSAL: visible,
 *     editable, and never searched until the user acts.
 *
 * Source-scan guards read the .tsx at RUNTIME, so they bite without a recompile.
 */
import {
  MIN_LEGIBLE_CONTRAST,
  contrastRatio,
  relativeLuminance,
} from '../src/services/inkContrast';
import { maskSourceComments } from '../src/services/audioFocusContract';
import {
  OCR_PREFILL_EMPTY_NOTE,
  OCR_PREFILL_NOTE,
  OCR_PREFILL_SEARCH_CTA,
  canConfirmOcrPrefill,
  confirmOcrPrefill,
  initialOcrPrefillState,
  maySearchOcrPrefill,
  ocrPrefillNote,
} from '../src/services/ocrPrefill';
import {
  TAKE_STAFF_CLEANED_INK,
  TAKE_STAFF_PAPER,
  TAKE_STAFF_RAW_INK,
} from '../src/services/takeStaffPalette';
import {
  editorScoreIsWholeWork,
  editorScorePreClampsBox,
  fixedHeightOf,
  hasMinHeight,
  ocrPrefillAutoSearches,
  ocrPrefillIsExplicit,
  pdfViewerKeepsAutoScroll,
  scannedViewerExplainsNoAutoScroll,
  scannedViewerHasDeadControls,
  styleBlock,
  takeStaffClipsToOneBar,
  takeStaffContrast,
  takeStaffPaletteIsLegible,
  takeStaffPaintsDarkLiterals,
  takeStaffShowsTheWholeTake,
  takeStaffUsesThePalette,
} from '../src/services/uxrV42Contract';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ FAILED: ${label}`);
  }
}
function assertEq(actual: unknown, expected: unknown, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, ok ? label : `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let at = 0; at < 6; at += 1) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}

const ROOT = repoRoot();
function read(relative: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

const editor = read('src/screens/NotationEditorScreen.tsx');
const takeCard = read('src/components/TakeStaffCard.tsx');
const scanned = read('src/screens/ScannedViewerScreen.tsx');
const pdfViewer = read('src/screens/PdfViewerScreen.tsx');
const findPiece = read('src/screens/FindPieceScreen.tsx');
const reader = read('src/screens/TransposedScoreReaderScreen.tsx');

// ═════════════════════ FIX A — the editor's score card ══════════════════════

console.log('\nFIX A — transposed full score renders every bar on the EDITOR surface');

assert(editor.length > 2000, `the editor source was read (${editor.length} chars)`);
assertEq(editorScorePreClampsBox(editor), false, 'the editor does not pre-clamp its score to a box');
assertEq(editorScoreIsWholeWork(editor), true, 'the editor hands the transposed score the whole-work band');
assert(editor.indexOf('wholeWork') >= 0, 'the viewer is asked for a whole work');
assert(editor.indexOf('onDocumentHeight') < 0, 'the editor applies no measured height of its own');
assert(
  maskSourceComments(editor).indexOf('abcScoreContainerHeight') < 0,
  'the 4000px BOX cap is not used on the editor surface (code, not prose)',
);
// The reader — the surface UX round 1 fixed — is unchanged and still whole-work.
assert(
  /<AbcScoreView[^>]*wholeWork/.test(reader),
  'the full-score reader still renders the whole work (no regression)',
);

// MUTATIONS: put each half of the old defect back and prove the guard bites.
const editorMutations: { label: string; source: string }[] = [
  {
    label: 'the capped measurement rule is imported back',
    source: editor.replace(
      "} from '../services/transposedScore';",
      "} from '../services/transposedScore';\nimport { abcScoreContainerHeight } from '../services/scoreHeight';",
    ),
  },
  {
    label: 'the box grows from a clamped height again',
    source: editor.replace(
      '<AbcScoreView abc={transposedAbc} wholeWork />',
      '<AbcScoreView abc={transposedAbc} interactive={false} onDocumentHeight={(h) => setScoreHeight(h)} />',
    ),
  },
  {
    label: 'the whole-work band is dropped',
    source: editor.replace('<AbcScoreView abc={transposedAbc} wholeWork />', '<AbcScoreView abc={transposedAbc} interactive={false} />'),
  },
];
for (const mutation of editorMutations) {
  assert(mutation.source !== editor, `the mutation "${mutation.label}" changed the real screen`);
  assertEq(
    editorScoreIsWholeWork(mutation.source),
    false,
    `MUTATION: ${mutation.label} FAILS the editor score contract`,
  );
}
// The pre-fix rule itself, spelled the way the old editor spelled it.
const preFixEditor =
  editor.replace(
    '<AbcScoreView abc={transposedAbc} wholeWork />',
    '<AbcScoreView abc={transposedAbc} interactive={false} onDocumentHeight={handleDocumentHeight} />',
  ) +
  "\nconst handleDocumentHeight = (height: number) => setScoreHeight(abcScoreContainerHeight({ interactive: false, measuredHeight: height }));\n";
assertEq(editorScorePreClampsBox(preFixEditor), true, 'the pre-fix editor pattern IS detected as a box cap');

// ════════════════════ FIX B1 — the notes are readable ══════════════════════

console.log('\nFIX B1 — the take-notes staff is legible in BOTH themes');

const contrast = takeStaffContrast();
console.log(
  `  · paper ${TAKE_STAFF_PAPER} · raw ${TAKE_STAFF_RAW_INK} (${contrast.raw?.toFixed(2)}:1) · cleaned ${TAKE_STAFF_CLEANED_INK} (${contrast.cleaned?.toFixed(2)}:1) · AA floor ${MIN_LEGIBLE_CONTRAST}:1`,
);
assertEq(takeStaffPaletteIsLegible(), true, 'both inks clear WCAG AA on the take paper');
assert((contrast.raw ?? 0) >= MIN_LEGIBLE_CONTRAST, 'the RAW trace ink is readable, not a dim ghost');
assert(
  (contrast.cleaned ?? 0) >= MIN_LEGIBLE_CONTRAST,
  'the AUTO-CLEANED ink is readable, not the brand teal on white (1.7:1)',
);
assert(contrast.cleaned !== null && contrast.raw !== null && contrast.cleaned > contrast.raw,
  'the cleaned line is the CRISPER of the two (the "after")');
assertEq(takeStaffUsesThePalette(takeCard), true, 'the card takes its paper/ink from the shared palette');
assertEq(takeStaffPaintsDarkLiterals(takeCard), false, 'the card no longer paints DARK palette literals');

// MUTATIONS: the pre-fix palette, and the brand teal on white paper.
const paletteMutations: { label: string; paper: string; raw: string; cleaned: string }[] = [
  { label: 'the dark paper the owner saw', paper: '#16213e', raw: '#9aa0b4', cleaned: '#4ecdc4' },
  { label: 'the brand teal on white paper', paper: '#ffffff', raw: '#6b7280', cleaned: '#4ecdc4' },
  { label: 'grey ink on white paper', paper: '#ffffff', raw: '#d0d0d0', cleaned: '#0f766e' },
];
for (const mutation of paletteMutations) {
  const raw = contrastRatio(mutation.raw, mutation.paper);
  const cleaned = contrastRatio(mutation.cleaned, mutation.paper);
  const paperLight = (relativeLuminance(mutation.paper) ?? 0) >= 0.5;
  const legible =
    paperLight &&
    raw !== null &&
    cleaned !== null &&
    raw >= MIN_LEGIBLE_CONTRAST &&
    cleaned >= MIN_LEGIBLE_CONTRAST;
  assertEq(legible, false, `MUTATION: ${mutation.label} FAILS the legibility contract`);
}
// The card's own dark fill literal is a THEME role the remapper repaints — it must
// not be the staff's paper (a prop the remapper cannot reach).
assert(
  takeCard.indexOf('background={TAKE_STAFF_PAPER}') >= 0,
  'the staff is painted with the palette paper, not the card literal',
);

// ════════════════════ FIX B2 — the whole take renders ══════════════════════

console.log('\nFIX B2 — the take staff shows the WHOLE take, not one bar');

assertEq(fixedHeightOf(takeCard, 'staffBox'), null, 'the staff box has NO fixed height');
assertEq(hasMinHeight(takeCard, 'staffBox'), true, 'the staff box is a FLOOR (minHeight)');
assertEq(takeStaffClipsToOneBar(takeCard), false, 'the staff box cannot clip a take to one bar');
assertEq(takeStaffShowsTheWholeTake(takeCard), true, 'the card renders the whole take');
assert(
  /interactive\s*=\s*false/.test(takeCard),
  'the viewer is non-interactive by default, so it measures and grows its own box',
);
assert(
  (takeCard.match(/<AbcScoreView/g) || []).length >= 2,
  'both rows (raw + auto-cleaned) still render',
);

// MUTATION: the pre-fix fixed box.
const clippedCard = takeCard.replace(
  `    minHeight: STAFF_MIN_HEIGHT,
    marginTop: 6,`,
  `    height: STAFF_MIN_HEIGHT,
    marginTop: 6,`,
);
assert(clippedCard !== takeCard, 'the clip mutation changed the real card');
assertEq(takeStaffClipsToOneBar(clippedCard), true, 'MUTATION: a fixed staff box IS a one-bar clip');
assertEq(takeStaffShowsTheWholeTake(clippedCard), false, 'MUTATION: the clipped card FAILS the contract');

// ═══════════════ FIX C — no dead Play / autoscroll on a photo ═══════════════

console.log('\nFIX C — the scanned-score page exposes no dead Play / auto-scroll control');

assertEq(scannedViewerHasDeadControls(scanned), false, 'the scanned page offers no auto-scroll control');
assertEq(scannedViewerExplainsNoAutoScroll(scanned), true, 'the page says WHY there is no auto-scroll');
assert(
  scanned.indexOf('SCANNED_NO_AUTOSCROLL_LINE') >= 0,
  'the honest line is the exported constant the gate asserts',
);
assertEq(pdfViewerKeepsAutoScroll(pdfViewer), true, 'the PDF reader KEEPS the control (per-surface decision)');

// MUTATIONS: the pre-fix controls, put back one at a time.
const scannedMutations: { label: string; source: string }[] = [
  {
    label: 'the auto-scroll bar is rendered again',
    source: scanned.replace(
      '<View style={styles.autoScrollNoteRow}>',
      '<AutoScrollControl autoScroll={autoScroll} disabled={pages.length < 2} />\n      <View style={styles.autoScrollNoteRow}>',
    ),
  },
  {
    label: 'the auto-scroll hook is started again',
    source: scanned.replace(
      '  const pages = item?.pageUris ?? [];',
      '  const pages = item?.pageUris ?? [];\n  const autoScroll = useAutoScroll({ currentPage: page, pageCount: pages.length, onTurnPage: () => undefined });',
    ),
  },
  {
    label: 'the reason is dropped while the controls stay away',
    source: scanned.replace(
      '<Text style={styles.autoScrollNote}>{SCANNED_NO_AUTOSCROLL_LINE}</Text>',
      '<Text style={styles.autoScrollNote}>Swipe to turn pages.</Text>',
    ),
  },
];
for (const mutation of scannedMutations) {
  assert(mutation.source !== scanned, `the mutation "${mutation.label}" changed the real screen`);
  const dead = scannedViewerHasDeadControls(mutation.source);
  const explained = scannedViewerExplainsNoAutoScroll(mutation.source);
  assertEq(dead || !explained, true, `MUTATION: ${mutation.label} FAILS the scanned-surface contract`);
}

// ═══════════════════ FIX D — the OCR prefill is a proposal ══════════════════

console.log('\nFIX D — the OCR text is visible, editable, and never auto-searched');

// The pure rule first.
const pending = initialOcrPrefillState('a-thy,Be-cause I\'m Freddie Mercury');
assertEq(pending.pending, true, 'a read-from-a-photo query starts PENDING');
assertEq(maySearchOcrPrefill(pending), false, 'a pending proposal may not search');
assertEq(ocrPrefillNote(pending), OCR_PREFILL_NOTE, 'the note says the words came from the photo');
assertEq(canConfirmOcrPrefill(pending), true, 'the confirm control is offered when there are words');
const confirmed = confirmOcrPrefill(pending);
assertEq(confirmed.pending, false, 'the user\'s action ends the proposal');
assertEq(confirmed.query, pending.query, 'the words themselves are untouched by confirming');
assertEq(maySearchOcrPrefill(confirmed), true, 'after the action the screen searches as it always did');
assertEq(ocrPrefillNote(confirmed), null, 'the note disappears once the search has run');
assertEq(initialOcrPrefillState(undefined).pending, false, 'a typed door opens with NO proposal');
assertEq(initialOcrPrefillState('   ').pending, false, 'a blank read is not a proposal');
assertEq(ocrPrefillNote(initialOcrPrefillState('')), null, 'an empty field shows no prefill note');
assertEq(
  canConfirmOcrPrefill({ query: '  ', pending: true }),
  false,
  'there is nothing to search for a blank proposal',
);
assertEq(OCR_PREFILL_SEARCH_CTA.length > 0 && OCR_PREFILL_EMPTY_NOTE.length > 0, true, 'the copy is present');

// Then the screen that must honour it.
assertEq(ocrPrefillAutoSearches(findPiece), false, 'the search does NOT run on a prefilled read');
assertEq(ocrPrefillIsExplicit(findPiece), true, 'the screen renders the proposal, not a result');
assert(
  findPiece.indexOf('onPress={handleSubmitPrefill}') >= 0,
  'the one control that runs the search is wired',
);
assert(
  findPiece.indexOf('onChangeText={setQuery}') >= 0,
  'the field stays editable (the read can be corrected)',
);
// The money path the v41 batch fixed must still be there (no regression).
assert(
  findPiece.indexOf('<SearchExternalSection') >= 0 && findPiece.indexOf('styles.resultsScroll') >= 0,
  'the no-match retailer CTAs still share the ONE results scroller',
);

// MUTATIONS: the pre-fix auto-query, and a proposal with no way to confirm it.
const findMutations: { label: string; source: string }[] = [
  {
    label: 'the query is seeded straight from the caller',
    source: findPiece.replace(
      "const [query, setQuery] = useState(() => initialOcrPrefillState(initialQuery).query);",
      "const [query, setQuery] = useState(initialQuery ?? '');",
    ),
  },
  {
    label: 'the gate is removed from the search effect',
    source: findPiece.replace('    if (prefillPending) {', '    if (false) {'),
  },
  {
    label: 'the confirm control is removed',
    source: findPiece.replace('onPress={handleSubmitPrefill}', 'onPress={() => undefined}'),
  },
  {
    label: 'the field is made read-only',
    source: findPiece.replace('onChangeText={setQuery}', 'editable={false}'),
  },
];
for (const mutation of findMutations) {
  assert(mutation.source !== findPiece, `the mutation "${mutation.label}" changed the real screen`);
  assertEq(
    ocrPrefillIsExplicit(mutation.source),
    false,
    `MUTATION: ${mutation.label} FAILS the OCR-prefill contract`,
  );
}
// The pre-fix shape, exactly as it was: the caller's string as the query state and
// no gate at all in the debounced effect.
const preFixFindPiece = findPiece
  .replace(
    "const [query, setQuery] = useState(() => initialOcrPrefillState(initialQuery).query);",
    "const [query, setQuery] = useState(initialQuery ?? '');",
  )
  .replace(/\n\s*const \[prefillPending[\s\S]*?\);\n/, '\n')
  .replace('    if (prefillPending) {', '    if (false) {');
assertEq(ocrPrefillAutoSearches(preFixFindPiece), true, 'the pre-fix screen IS detected as an auto-query');

// ═══════════════════════════════ SUMMARY ════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
