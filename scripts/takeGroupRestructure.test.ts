/**
 * takeGroupRestructure.test.ts — UX ROUND 1, STEP 2: "Correct your Take" becomes
 * TWO grouped sections (owner's "Corrections" ask, spec
 * ux-round-1/correct-your-take-spec.md).
 *
 * THE OWNER'S CONFIRMED WORDS WIN OVER THE SPEC DRAFT. The spec's §2 header text
 * ("1 · YOUR NOTES" / "2 · HEAR IT & SEND IT") was the designer's own assumption
 * — the spec says so in its own assumption block. The owner has since confirmed
 * the wording, and it is:
 *
 *      Group 1 → header "Fix Notes"        sub-label "Adjust Pitch"
 *      Group 2 → header "Listen & Send"    sub-label "Confirm Take"
 *
 * This suite holds those four strings as literals and reads the editor's own
 * constants back out of its source, so a drift in either direction fails here.
 *
 * WHY A SOURCE SCAN AND NOT A RENDER TEST. The editor is a 1,551-line React
 * Native component and this box has no emulator, so a screen-level regression —
 * a control that stops being rendered because it was left out of the regrouped
 * markup, a header whose words were retyped instead of read from its constant —
 * is invisible to every pure-logic test we have. The point of this change is a
 * LAYOUT one, and THE CONTROLS THEMSELVES ARE UNCHANGED, so the guard is about
 * what is still on the page and which group it sits in:
 *
 *   1. exactly two group headers, carrying the owner's words, read from the
 *      editor's own constants (never a retyped literal in the JSX);
 *   2. every pre-existing label constant of the editor still RENDERS;
 *   3. every control of the spec's §3 inventory sits in its group — the pitch
 *      rail, the timing buttons, the chord block and the whole-take batch fixes
 *      in group 1; the listen rows, the Hum-Along preview and the MIDI/PDF
 *      export in group 2; the view switch above both, the save bar below both;
 *   4. the honest lines are byte-identical, no line claims a studio
 *      transcription, and nothing hides a fixing tool behind a disclosure.
 *
 * Layers, the team's usual shape: PURE SCANNERS → PRE-FIX FIXTURES (each asserted
 * to FAIL the guard) → LIVE SOURCE SCAN (with floors) → MUTATION PROBES.
 *
 * Plain Node — no react-native, no emulator, no network. Run: npm run test:tier1
 */
import { maskComments } from '../src/services/modalBackContract';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passes = 0;
let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}
function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

/** The one file this change touches (plus the two gate lists it must join). */
export const EDITOR_SOURCE_PATH = 'src/components/TakeCorrectionEditor.tsx';

/** THE OWNER'S CONFIRMED WORDS (10-18). They win over the spec's §2 draft. */
export const GROUP_FIX_LABEL = 'Fix Notes';
export const GROUP_FIX_SUB = 'Adjust Pitch';
export const GROUP_SEND_LABEL = 'Listen & Send';
export const GROUP_SEND_SUB = 'Confirm Take';

/** The numerals the spec puts in front of each header (`1 · Fix Notes`). */
export const GROUP_FIX_NUM = '1';
export const GROUP_SEND_NUM = '2';

// ─── PURE SCANNERS ────────────────────────────────────────────

export interface GroupHeader {
  /** Offset in the masked source where the header's JSX starts. */
  index: number;
  /** The numeral attribute, verbatim. */
  num: string;
  /** The CONSTANT the label is read from ('' when a literal was written). */
  labelConst: string;
  /** The CONSTANT the sub-label is read from ('' when a literal was written). */
  subConst: string;
}

function attributeValue(block: string, name: string): string {
  const match = new RegExp(name + '="([^"]*)"').exec(block);
  return match ? match[1] : '';
}
function expressionAttribute(block: string, name: string): string {
  const match = new RegExp(name + '=\\{\\s*([A-Za-z0-9_]+)\\s*\\}').exec(block);
  return match ? match[1] : '';
}

/**
 * Every rendered group header, in source order. Comments are blanked first, so a
 * commented-out header is not a header, and the tag is `EditorGroupHeader` — a
 * look-alike component is not counted.
 */
export function groupHeaders(source: string): GroupHeader[] {
  const masked = maskComments(source);
  const out: GroupHeader[] = [];
  // The tag, and NOT the type annotation on the component's own definition line
  // (`React.FC<EditorGroupHeaderProps>` contains `<EditorGroupHeader`) — a tag name
  // is never followed by another identifier character.
  const tag = /<EditorGroupHeader(?![A-Za-z0-9_])/g;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(masked)) !== null) {
    const at = match.index;
    const end = masked.indexOf('/>', at);
    const block = end < 0 ? masked.slice(at) : masked.slice(at, end + 2);
    out.push({
      index: at,
      num: attributeValue(block, 'num'),
      labelConst: expressionAttribute(block, 'label'),
      subConst: expressionAttribute(block, 'sub'),
    });
  }
  return out;
}

/** The value of a single-line `export const NAME = '…'` in a file, or null. */
export function constValue(source: string, name: string): string | null {
  const match = new RegExp("export const " + name + " =\\s*'((?:[^'\\\\]|\\\\.)*)'").exec(source);
  return match ? match[1] : null;
}

/**
 * The value of ANY `export const NAME = …;` declaration, including the multi-line
 * ones the pure models use (`export const X =\n  '…';`). Adjacent literals are
 * joined, which is how the repo writes a long honest line across a fold.
 */
export function constValueLoose(source: string, name: string): string | null {
  const at = source.indexOf('export const ' + name + ' =');
  if (at < 0) return null;
  const end = source.indexOf(';', at);
  if (end < 0) return null;
  const decl = source.slice(at, end);
  const parts: string[] = [];
  const re = /'((?:[^'\\]|\\.)*)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(decl)) !== null) parts.push(match[1]);
  return parts.length > 0 ? parts.join('') : null;
}

/**
 * Where a name is USED in the render — the offset of its first appearance in a
 * render position (`{NAME}`, `= {NAME}`, `: NAME`, `? NAME`), NOT its own
 * declaration. `-1` means the constant is declared and never rendered, which is
 * exactly the silent-drop shape this suite exists to catch.
 */
export function renderedUsage(source: string, name: string): number {
  const masked = maskComments(source);
  const match = new RegExp('[{=,?:>]\\s*' + name + '\\b').exec(masked);
  return match ? match.index : -1;
}

/** The body of a `name: { … }` block in the editor's StyleSheet, or ''. */
export function styleBlock(source: string, name: string): string {
  const at = source.indexOf(name + ': {');
  if (at < 0) return '';
  const end = source.indexOf('},', at);
  return end < 0 ? source.slice(at) : source.slice(at, end + 2);
}

export type GroupName = 'top' | 'fix' | 'listen' | 'bottom' | 'missing';

/**
 * Which band of the page a marker sits in:
 *   top     — above the first group header (the view switch, the facts card)
 *   fix     — inside "Fix Notes"
 *   listen  — inside "Listen & Send"
 *   bottom  — below "Listen & Send", at the sticky save bar
 *   missing — the marker is not rendered at all
 * The bands are read from the real source: the two headers and the save bar.
 */
export function groupOf(source: string, marker: string): GroupName {
  const masked = maskComments(source);
  const headers = groupHeaders(source);
  const g1 = headers.length > 0 ? headers[0].index : -1;
  const g2 = headers.length > 1 ? headers[1].index : -1;
  const bar = masked.indexOf('styles.saveBar');
  const at = masked.indexOf(marker);
  if (at < 0) return 'missing';
  if (at < g1) return 'top';
  if (at < g2) return 'fix';
  if (bar >= 0 && at > bar) return 'bottom';
  return 'listen';
}

// ─── THE SPEC'S CONTROL INVENTORY, BY GROUP ───────────────────

/** Group 1 — "Fix Notes" / "Adjust Pitch": the notes and the harmony. */
export const FIX_GROUP_MARKERS: readonly string[] = [
  '<AbcScoreView', // the staff (block 1)
  '{EDITOR_LANE_LABEL}', // the touch layer's own instruction (block 2)
  'styles.rail', // THE PITCH RAIL — the audible semitone chips
  '{EDITOR_SHORTER_CTA}', // timing
  '{EDITOR_LONGER_CTA}',
  '{EDITOR_ADD_NOTE_CTA}', // structure
  '{EDITOR_REMOVE_NOTE_CTA}',
  '{EDITOR_REST_CTA}',
  '{EDITOR_REDETECT_CTA}',
  '{EDITOR_LAST_NOTE_REASON}', // the disabled-reason lines stay with their buttons
  '{EDITOR_NO_REDETECT_REASON}',
  '{TAB_LABEL}', // the tabs button (block 3b)
  '{EDITOR_CHORD_LABEL}', // the chord block
  '{EDITOR_CHORD_USE_CTA}',
  '{EDITOR_CHORD_RESET_CTA}',
  '{EDITOR_CHORD_RESET_ALL_CTA}',
  '{EDITOR_NO_KEY_LINE || EDITOR_NO_CHORDS_LINE}', // the chord empty state
  '{EDITOR_TRANSPOSE_LABEL}', // whole take + escape hatches
  '{EDITOR_SNAP_TO_KEY_CTA}',
  '{EDITOR_UNDO_CTA}',
  '{EDITOR_REDO_CTA}',
  '{EDITOR_RESET_CTA}',
  '{NOTE_TAG_DETECTED}', // the tags legend closes the group
];

/** Group 2 — "Listen & Send" / "Confirm Take": hear it, then use it. */
export const LISTEN_GROUP_MARKERS: readonly string[] = [
  '{listenRow}', // the two listen rows (block 0b, moved here by the restructure)
  '<TakePreviewSection', // the docked Hum-Along preview (block 7)
  'accessibilityLabel={MIDI_EXPORT_LABEL}', // the export block (block 8)
  'accessibilityLabel={SEND_TO_CTA}',
];

/** Above both groups: the page's own frame, unchanged. */
export const TOP_MARKERS: readonly string[] = [
  '{EDITOR_COACH_TIP}',
  '{EDITOR_VIEW_LABEL}',
  '{EDITOR_NO_TAKE_LINE}',
];

/** Below both groups: the sticky save bar, still the last thing on the page. */
export const BOTTOM_MARKERS: readonly string[] = ['? EDITOR_SAVING_LABEL'];

/**
 * EVERY pre-existing label constant the editor renders (local and imported).
 * Declared and never rendered is the failure this list catches — it is the shape
 * that silently drops a control whose markup the restructure had to move.
 */
export const EDITOR_LABEL_CONSTANTS: readonly string[] = [
  'EDITOR_COACH_TIP',
  'EDITOR_INTRO',
  'EDITOR_TITLE',
  'EDITOR_DONE_CTA',
  'EDITOR_VIEW_LABEL',
  'EDITOR_NO_TAKE_LINE',
  'EDITOR_LANE_LABEL',
  'EDITOR_SHORTER_CTA',
  'EDITOR_LONGER_CTA',
  'EDITOR_ADD_NOTE_CTA',
  'EDITOR_REMOVE_NOTE_CTA',
  'EDITOR_REST_CTA',
  'EDITOR_REDETECT_CTA',
  'EDITOR_LAST_NOTE_REASON',
  'EDITOR_NO_REDETECT_REASON',
  'EDITOR_CHORD_LABEL',
  'EDITOR_CHORD_FREE_HINT',
  'EDITOR_CHORD_USE_CTA',
  'EDITOR_CHORD_RESET_CTA',
  'EDITOR_CHORD_RESET_ALL_CTA',
  'EDITOR_NO_CHORDS_LINE',
  'EDITOR_NO_KEY_LINE',
  'EDITOR_TRANSPOSE_LABEL',
  'EDITOR_SNAP_TO_KEY_CTA',
  'EDITOR_UNDO_CTA',
  'EDITOR_REDO_CTA',
  'EDITOR_RESET_CTA',
  'EDITOR_ORIGINAL_TITLE',
  'EDITOR_VIEW_CORRECTED_CTA',
  'EDITOR_SAVING_LABEL',
  'NOTE_TAG_DETECTED',
  'NOTE_TAG_CORRECTED',
  'NOTE_TAG_ADDED',
  'CHORD_TAG_SUGGESTED',
  'CHORD_TAG_YOURS',
  'TAB_LABEL',
  'MIDI_EXPORT_LABEL',
  'SEND_TO_CTA',
];

/** The editor's OWN honest lines, verbatim (spec §1 — they must survive). */
export const LOCAL_HONEST_LINES: ReadonlyArray<readonly [string, string]> = [
  [
    'EDITOR_COACH_TIP',
    'Notes are suggestions — tap any note to fix it. Your corrections are what exports and playback use.',
  ],
  ['EDITOR_LANE_LABEL', 'Tap a note · drag it up or down for pitch · drag its edges for timing'],
  ['EDITOR_NO_CHORDS_LINE', 'No chords to change on this take yet.'],
  ['EDITOR_SHORTER_CTA', 'Shorter'],
  ['EDITOR_LONGER_CTA', 'Longer'],
  ['EDITOR_ADD_NOTE_CTA', '+ Add note after'],
  ['EDITOR_REMOVE_NOTE_CTA', 'Remove note'],
  ['EDITOR_REST_CTA', 'Insert rest after'],
  ['EDITOR_REDETECT_CTA', 'Re-detect this note'],
  ['EDITOR_CHORD_LABEL', 'Chords'],
  ['EDITOR_CHORD_USE_CTA', 'Use this chord'],
  ['EDITOR_CHORD_RESET_CTA', 'Back to suggested'],
  ['EDITOR_CHORD_RESET_ALL_CTA', 'Reset all chords'],
  ['EDITOR_TRANSPOSE_LABEL', 'Whole take'],
  ['EDITOR_SNAP_TO_KEY_CTA', 'Snap to key'],
  ['EDITOR_UNDO_CTA', '↶ Undo'],
  ['EDITOR_REDO_CTA', '↷ Redo'],
  ['EDITOR_RESET_CTA', 'Reset to detected'],
  ['EDITOR_DONE_CTA', '← Back to my take'],
  ['EDITOR_SAVING_LABEL', 'Saving…'],
];

/**
 * The honest lines the editor IMPORTS (their wording lives in the pure models).
 * Checked in their own file so a copy tweak made "while regrouping" fails here.
 */
export const IMPORTED_HONEST_LINES: ReadonlyArray<readonly [string, string, string]> = [
  ['src/services/takeEditor.ts', 'EDITOR_TITLE', 'Correct your take'],
  [
    'src/services/takeEditor.ts',
    'EDITOR_INTRO',
    'Every note here is yours: tap a note to change its pitch (you will hear it), drag its edges to move the timing, or add and remove notes. Your corrections are the take from now on — History, MIDI and playback all use them.',
  ],
  [
    'src/services/takeEditor.ts',
    'EDITOR_LAST_NOTE_REASON',
    'A take needs at least one note — add a note before removing this one.',
  ],
  [
    'src/services/takeEditor.ts',
    'EDITOR_NO_REDETECT_REASON',
    'Re-detect needs the audio analysis of this take, which this device could not read. Your pitch edits still work.',
  ],
  [
    'src/services/editorTakeLoad.ts',
    'EDITOR_NO_TAKE_LINE',
    'No notes were saved for this melody, so there is nothing to correct yet — record another take and its notes will be here.',
  ],
  // A chord is "suggested" until the user overrides it (spec §1) — the words the
  // chord row prints must not change shape in a layout pass.
  ['src/services/takeEditor.ts', 'CHORD_TAG_SUGGESTED', 'suggested'],
  ['src/services/takeEditor.ts', 'CHORD_TAG_YOURS', 'yours'],
];

// ─── THE LIVE SCAN ────────────────────────────────────────────

const EDITOR = readAppFile(EDITOR_SOURCE_PATH);
const MASK = maskComments(EDITOR);
const HEADERS = groupHeaders(EDITOR);
const G1 = HEADERS.length > 0 ? HEADERS[0].index : -1;
const G2 = HEADERS.length > 1 ? HEADERS[1].index : -1;
const HEADER_COMPONENT_START = MASK.indexOf('const EditorGroupHeader');
const HEADER_COMPONENT_END = MASK.indexOf('export const TakeCorrectionEditor');
const HEADER_COMPONENT =
  HEADER_COMPONENT_START >= 0 && HEADER_COMPONENT_END > HEADER_COMPONENT_START
    ? MASK.slice(HEADER_COMPONENT_START, HEADER_COMPONENT_END)
    : '';

console.log('\ntake groups — the owner’s confirmed words, read from the editor’s own constants');
assertEq(constValue(EDITOR, 'EDITOR_GROUP_FIX_LABEL'), GROUP_FIX_LABEL, 'group 1’s header constant says “Fix Notes”');
assertEq(constValue(EDITOR, 'EDITOR_GROUP_FIX_SUB'), GROUP_FIX_SUB, 'group 1’s sub-label constant says “Adjust Pitch”');
assertEq(constValue(EDITOR, 'EDITOR_GROUP_SEND_LABEL'), GROUP_SEND_LABEL, 'group 2’s header constant says “Listen & Send”');
assertEq(constValue(EDITOR, 'EDITOR_GROUP_SEND_SUB'), GROUP_SEND_SUB, 'group 2’s sub-label constant says “Confirm Take”');

console.log('\ntake groups — exactly two headers, in order, and never a retyped literal');
assertEq(HEADERS.length, 2, 'the page renders TWO group headers (no more, no fewer)');
assertEq(HEADERS[0] ? HEADERS[0].labelConst : 'none', 'EDITOR_GROUP_FIX_LABEL', 'header 1 reads its words from the group-1 constant');
assertEq(HEADERS[0] ? HEADERS[0].subConst : 'none', 'EDITOR_GROUP_FIX_SUB', 'header 1’s sub-label reads from its constant');
assertEq(HEADERS[1] ? HEADERS[1].labelConst : 'none', 'EDITOR_GROUP_SEND_LABEL', 'header 2 reads its words from the group-2 constant');
assertEq(HEADERS[1] ? HEADERS[1].subConst : 'none', 'EDITOR_GROUP_SEND_SUB', 'header 2’s sub-label reads from its constant');
assertEq(HEADERS[0] ? HEADERS[0].num : 'none', GROUP_FIX_NUM, 'header 1 carries the numeral 1');
assertEq(HEADERS[1] ? HEADERS[1].num : 'none', GROUP_SEND_NUM, 'header 2 carries the numeral 2');
assert(G1 >= 0 && G2 > G1, '“Fix Notes” is rendered above “Listen & Send”');

console.log('\ntake groups — the grouping is drawn (label, sub-label, hairline divider, spacing)');
assert(HEADER_COMPONENT.length > 200, `the shared header component is in the file (${HEADER_COMPONENT.length} chars)`);
for (const style of ['styles.groupHeader', 'styles.groupLabel', 'styles.groupSub', 'styles.groupRule']) {
  assert(HEADER_COMPONENT.indexOf(style) >= 0, `the header component draws ${style}`);
}
const ruleBlock = styleBlock(EDITOR, 'groupRule');
const headerBlock = styleBlock(EDITOR, 'groupHeader');
const labelBlock = styleBlock(EDITOR, 'groupLabel');
const subBlock = styleBlock(EDITOR, 'groupSub');
assert(ruleBlock.length > 0 && ruleBlock.indexOf('height: 1') >= 0, 'the divider is a 1 px hairline (spec §2)');
assert(headerBlock.indexOf('marginTop: 32') >= 0, 'each group header sits ~32 dp below the block above it (spec §2)');
assert(labelBlock.indexOf("textTransform: 'uppercase'") >= 0, 'the group label is an uppercase micro-label');
assert(labelBlock.indexOf('letterSpacing') >= 0, 'and it carries the spec’s letter-spacing');
assert(subBlock.length > 0, 'the sub-label has its own style');

console.log('\ntake groups — every pre-existing label constant still RENDERS');
for (const name of EDITOR_LABEL_CONSTANTS) {
  assert(renderedUsage(EDITOR, name) >= 0, `${name} is still used in the render (not only declared)`);
}
assertEq(
  renderedUsage("export const EDITOR_SHORTER_CTA = 'Shorter';", 'EDITOR_SHORTER_CTA'),
  -1,
  'PRE-FIX: a constant that is DECLARED and never rendered does not pass by omission',
);
assertEq(
  renderedUsage("const x = <Text>{EDITOR_SHORTER_CTA}</Text>;", 'EDITOR_SHORTER_CTA') >= 0,
  true,
  'a real render site is seen',
);

console.log('\ntake groups — the honest lines are byte-identical (no copy change in a regroup)');
for (const [name, value] of LOCAL_HONEST_LINES) {
  assertEq(constValue(EDITOR, name), value, `${name} is unchanged`);
}
for (const [file, name, value] of IMPORTED_HONEST_LINES) {
  const read = constValueLoose(readAppFile(file), name);
  assertEq(read, value, `${name} (in ${file}) is unchanged`);
}
assertEq(MASK.toLowerCase().indexOf('studio') < 0, true, 'no line on the page claims a studio transcription');
assertEq(
  MASK.indexOf('accordion') < 0 && MASK.indexOf('collapsed') < 0,
  true,
  'no fixing tool is hidden behind a disclosure (both groups are always visible)',
);

console.log('\ntake groups — THE CONTROL INVENTORY, BY GROUP (nothing silently dropped)');
for (const marker of FIX_GROUP_MARKERS) {
  assertEq(groupOf(EDITOR, marker), 'fix', `${marker} is in “Fix Notes”`);
}
for (const marker of LISTEN_GROUP_MARKERS) {
  assertEq(groupOf(EDITOR, marker), 'listen', `${marker} is in “Listen & Send”`);
}
for (const marker of TOP_MARKERS) {
  assertEq(groupOf(EDITOR, marker), 'top', `${marker} is still above both groups`);
}
for (const marker of BOTTOM_MARKERS) {
  assertEq(groupOf(EDITOR, marker), 'bottom', `${marker} is still below both groups (the sticky save bar)`);
}
assert(FIX_GROUP_MARKERS.length >= 20, `the group-1 inventory is complete (${FIX_GROUP_MARKERS.length} controls)`);
assert(LISTEN_GROUP_MARKERS.length >= 4, `the group-2 inventory is complete (${LISTEN_GROUP_MARKERS.length} controls)`);
assertEq(groupOf(EDITOR, '{NOT_A_THING}'), 'missing', 'a marker that is not on the page reads as missing');

console.log('\ntake groups — the live scan saw a real file (floors)');
assert(EDITOR.length > 40000, `read the editor itself (${EDITOR.length} chars)`);
assertEq(
  EDITOR.indexOf('TakeCorrectionEditor: React.FC<TakeCorrectionEditorProps>') >= 0,
  true,
  'the scan is on the real editor component',
);
assertEq(MASK.length, EDITOR.length, 'the comment-masked source keeps the file’s offsets');

console.log('\ntake groups — the gate lists know about this suite');
const tsconfig = readAppFile('tsconfig.tier1.json');
const pkg = readAppFile('package.json');
assertEq(tsconfig.indexOf('scripts/takeGroupRestructure.test.ts') >= 0, true, 'this suite is compiled by the gate');
assertEq(pkg.indexOf('takeGroupRestructure.test.js') >= 0, true, 'and it is chained into npm run test:tier1');

console.log('\ntake groups — MUTATION PROBES (each guard must bite)');
function mutate(source: string, needle: string, replacement: string): string {
  return source.split(needle).join(replacement);
}
{
  const noHeaders = mutate(EDITOR, '<EditorGroupHeader', '<View');
  assert(noHeaders !== EDITOR, 'the mutation really removed the header elements');
  assertEq(groupHeaders(noHeaders).length, 0, 'MUTATION FAILS THE GUARD — a page with no group headers is caught');
  assertEq(
    groupOf(noHeaders, FIX_GROUP_MARKERS[2]),
    'listen',
    'MUTATION FAILS THE GUARD — with no groups, the pitch rail no longer reads as “in Fix Notes”',
  );

  const commentedHeader =
    '// ' + '<EditorGroupHeader num="1" label={EDITOR_GROUP_FIX_LABEL} sub={EDITOR_GROUP_FIX_SUB} />';
  assertEq(groupHeaders(commentedHeader).length, 0, 'MUTATION FAILS THE GUARD — a commented-out header is not a header');

  const retyped = mutate(EDITOR, 'label={EDITOR_GROUP_SEND_LABEL}', 'label={"Listen & Send"}');
  assert(retyped !== EDITOR, 'the mutation really retyped the second header’s words');
  assertEq(
    groupHeaders(retyped)[1] ? groupHeaders(retyped)[1].labelConst : 'none',
    '',
    'MUTATION FAILS THE GUARD — words retyped in the JSX stop reading the constant',
  );
  assertEq(
    constValue(retyped, 'EDITOR_GROUP_SEND_LABEL'),
    GROUP_SEND_LABEL,
    'the constant still holds the owner’s word, so only the render site fails',
  );

  const droppedLaneLabel = mutate(EDITOR, '{EDITOR_LANE_LABEL}', '{EDITOR_LANE_HINT}');
  assert(droppedLaneLabel !== EDITOR, 'the mutation really dropped the lane label’s render site');
  assertEq(
    renderedUsage(droppedLaneLabel, 'EDITOR_LANE_LABEL'),
    -1,
    'MUTATION FAILS THE GUARD — a control whose label stops rendering is caught',
  );
  assertEq(groupOf(droppedLaneLabel, '{EDITOR_LANE_LABEL}'), 'missing', 'MUTATION FAILS THE GUARD — and it leaves its group');

  const droppedPitchRail = mutate(EDITOR, 'styles.rail', 'styles.fretboard');
  assert(droppedPitchRail !== EDITOR, 'the mutation really removed the pitch rail');
  assertEq(
    groupOf(droppedPitchRail, 'styles.rail'),
    'missing',
    'MUTATION FAILS THE GUARD — the audible semitone rail cannot vanish silently',
  );

  const droppedChordBlock = mutate(EDITOR, '{EDITOR_CHORD_USE_CTA}', '');
  assert(droppedChordBlock !== EDITOR, 'the mutation really dropped the chord block’s CTA');
  assertEq(groupOf(droppedChordBlock, '{EDITOR_CHORD_USE_CTA}'), 'missing', 'MUTATION FAILS THE GUARD — the chord block cannot vanish');

  const exportMovedUp = mutate(
    EDITOR,
    '<EditorGroupHeader',
    'accessibilityLabel={MIDI_EXPORT_LABEL}\n          <EditorGroupHeader',
  );
  assert(exportMovedUp !== EDITOR, 'the mutation really moved the export block above the groups');
  assertEq(
    groupOf(exportMovedUp, 'accessibilityLabel={MIDI_EXPORT_LABEL}'),
    'top',
    'MUTATION FAILS THE GUARD — the export block belongs to “Listen & Send”',
  );

  const listenDropped = mutate(EDITOR, '{listenRow}', '');
  assert(listenDropped !== EDITOR, 'the mutation really dropped the listen rows');
  assertEq(groupOf(listenDropped, '{listenRow}'), 'missing', 'MUTATION FAILS THE GUARD — the two listen rows cannot vanish either');

  const switchedWords = mutate(
    EDITOR,
    "EDITOR_GROUP_FIX_LABEL = 'Fix Notes'",
    "EDITOR_GROUP_FIX_LABEL = 'Fix the Notes'",
  );
  assert(switchedWords !== EDITOR, 'the mutation really changed the owner’s word');
  assertEq(constValue(switchedWords, 'EDITOR_GROUP_FIX_LABEL'), 'Fix the Notes', 'the mutated constant is read back');
  assert(
    constValue(switchedWords, 'EDITOR_GROUP_FIX_LABEL') !== GROUP_FIX_LABEL,
    'MUTATION FAILS THE GUARD — drift from the owner’s confirmed wording',
  );

  const quieterHonestLine = mutate(
    EDITOR,
    'Notes are suggestions — tap any note to fix it.',
    'This is a studio transcription.',
  );
  assert(quieterHonestLine !== EDITOR, 'the mutation really changed the coach tip');
  assertEq(
    constValue(quieterHonestLine, 'EDITOR_COACH_TIP') === LOCAL_HONEST_LINES[0][1],
    false,
    'MUTATION FAILS THE GUARD — the coach tip is pinned verbatim',
  );
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
