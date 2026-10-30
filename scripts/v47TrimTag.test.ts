/**
 * v47TrimTag.test.ts — ITEM 2 (CLIP + LABEL → TEACHER SEND): the model suite AND
 * the live-source guard suite, in one run (v47 part B).
 *
 * THE ONE THING THIS FILE EXISTS TO PROVE, ABOVE ALL ELSE: the clip keeps the
 * notes on the right clock. The take's note times are AUDIO seconds; the video's
 * clock is `note.startSec + audioOffsetMs / 1000`; a window is chosen on the VIDEO
 * clock. For every note that survives the window the suite asserts
 *
 *     trimmed.startSec + span.startSec  ===  original.startSec + audioOffsetMs/1000
 *
 * i.e. 0:00 of the clipped PDF/MIDI is the first frame of the window, and every
 * later note sits exactly where it did on the video. It also proves the negative:
 * a filtered-but-not-rebased take would put the first note at 2.5 s, not 0.5 s.
 *
 * The second half is the guard suite, asserted on the real files and then
 * MUTATION-PROVEN in memory (each guard must FAIL on deliberately broken bytes):
 * the clip step mounted in the send sheet, ONE span feeding BOTH pair members, the
 * span persisted on the row and applied to the video, the label persisted on the
 * take and carried on every member, and no network call anywhere in the path.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  TAKE_TAG_PRESETS,
  TAKE_TAG_MAX_CHARS,
  TRIM_MIN_SECONDS,
  TRIM_STEP_SECONDS,
  TRIM_VIDEO_WHOLE_LINE,
  applyTrimToTake,
  normaliseTakeTag,
  normaliseTrimSpan,
  nudgeTrimSpan,
  pairMemberTitle,
  tagForTitle,
  tagLineFor,
  tagPresetIsActive,
  trimPlaybackShouldPause,
  trimSpanLabel,
  trimSpanProblem,
  trimmedSendPair,
} from '../src/services/takeClipTag';
import { videoSummaryText } from '../src/services/videoSendTo';
import type { SavedCaptureTake } from '../src/services/midiExport';
import type { PracticeVideoRef } from '../src/services/practiceVideoRef';
import {
  CLIP_TAG_EDITOR_PATH,
  CLIP_TAG_MODEL_PATH,
  PARTB_SCREEN_PATH,
  PARTB_SEND_SHEET_PATH,
  clipIsPersistedAndAppliedToTheVideo,
  clipTagEditorIsMountedInSendSheet,
  partBAddsNoNetworkCall,
  partBIsGated,
  partBModelsStayPure,
  tagIsPersistedAndCarried,
  trimSpanIsAppliedToBothPairMembers,
} from '../src/services/v47PartBContract';

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

function close(actual: number, expected: number, msg: string): void {
  if (Math.abs(Number(actual) - Number(expected)) < 1e-6) {
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
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}

function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

// ─── fixtures ────────────────────────────────────────────────────────────────

function take(notes: Array<{ midi: number; startSec: number; durationSec: number }>): SavedCaptureTake {
  return { notes, tempoBpm: 90, durationSec: 40, key: null, capturedAt: '2026-10-30T00:00:00.000Z' };
}

function ref(durationSec: number, audioOffsetMs = 0): PracticeVideoRef {
  return {
    uri: 'file:///practice.mp4',
    durationSec,
    audioOffsetMs,
    measuredOffsetMs: audioOffsetMs,
    filmedAt: '2026-10-30T00:00:00.000Z',
    sizeBytes: 1024,
  };
}

/** Video onsets 1.5 / 2.5 / 3.5 / 5.5 (audio onsets 1 / 2 / 3 / 5, offset +500 ms). */
const OFFSET_MS = 500;
const TAKE = take([
  { midi: 60, startSec: 1, durationSec: 0.5 },
  { midi: 62, startSec: 2, durationSec: 0.5 },
  { midi: 64, startSec: 3, durationSec: 2 },
  { midi: 65, startSec: 5, durationSec: 0.5 },
]);
const SPAN = { startSec: 2, endSec: 4 };

// ─── THE SPAN ────────────────────────────────────────────────────────────────
console.log('\nv47 item 2 — the window is ordered, inside the video, and never collapses');

assertEq(normaliseTrimSpan(null, 40), null, 'no window means the whole take');
assertEq(normaliseTrimSpan(SPAN, 40)?.startSec, 2, 'a window inside the video is kept as picked');
assertEq(normaliseTrimSpan({ startSec: -5, endSec: 10 }, 40)?.startSec, 0, 'a start before zero is clamped to zero');
assertEq(normaliseTrimSpan({ startSec: 30, endSec: 90 }, 40)?.endSec, 40, 'an end past the video is clamped to its length');
assertEq(normaliseTrimSpan({ startSec: 10, endSec: 10.2 }, 40), null, 'a window shorter than the minimum is refused');
assertEq(normaliseTrimSpan(SPAN, 0.5), null, 'a video shorter than the minimum has no usable window');
assertEq(normaliseTrimSpan({ startSec: Number.NaN, endSec: 4 }, 40), null, 'a NaN bound is refused');
assertEq(trimSpanProblem({ startSec: 10, endSec: 10.2 }, 40), 'That window is too short to send — pick at least one second.', 'the refusal has a sentence the surface prints');
assertEq(trimSpanProblem(null, 40), null, 'no window is not a problem');

assertEq(trimSpanLabel({ startSec: 12, endSec: 38 }), '0:12–0:38', 'the window prints as one label');
assertEq(trimSpanLabel(null), null, 'no window, no label');
assertEq(nudgeTrimSpan(null, 'end', -TRIM_STEP_SECONDS, 40)?.endSec, 39, 'a nudge from no window starts at the whole take');
assertEq(nudgeTrimSpan({ startSec: 10, endSec: 20 }, 'start', 20, 40)?.startSec, 19, 'the start cannot pass the end (it stops one minimum short)');
assertEq(nudgeTrimSpan({ startSec: 10, endSec: 20 }, 'end', -20, 40)?.endSec, 11, 'the end cannot pass the start');
assertEq(TRIM_MIN_SECONDS, 1, 'the minimum window is one second');

// ─── THE ALIGNMENT PROOF ─────────────────────────────────────────────────────
console.log('\nv47 item 2 — THE ALIGNMENT: the clipped take is on the WINDOW’s clock');

const trimmed = applyTrimToTake(TAKE, SPAN, OFFSET_MS);
assertEq(trimmed.trimmed, true, 'a window really trims');
assertEq(trimmed.totalCount, 4, 'the take has four notes');
assertEq(trimmed.keptCount, 2, 'only the notes inside the window are kept (video onsets 2.5 and 3.5)');
assertEq(trimmed.droppedCount, 2, 'the two outside it are dropped, never clamped');
close(trimmed.take?.durationSec ?? -1, 2, 'the clipped take’s own length IS the window’s length');
close(trimmed.take?.notes[0].startSec ?? -1, 0.5, 'the first kept note sits 0.5 s into the window (video 2.5 − window start 2)');
close(trimmed.take?.notes[1].startSec ?? -1, 1.5, '…and the second 1.5 s in (video 3.5 − 2)');
assert(
  (trimmed.take?.notes[0].startSec ?? -1) !== 2.5,
  'NEGATIVE: a filtered-but-not-rebased take would have said 2.5 s — the clock would be wrong',
);
close(trimmed.take?.notes[1].durationSec ?? -1, 0.5, 'a note running past the window’s end is cut at the end (2 s note → 0.5 s)');
for (const kept of trimmed.take?.notes ?? []) {
  const original = TAKE.notes.find((note) => note.midi === kept.midi);
  const originalVideoOnset = (original?.startSec ?? 0) + OFFSET_MS / 1000;
  close(
    kept.startSec + SPAN.startSec,
    originalVideoOnset,
    `PROOF: kept note ${kept.midi} — window-relative ${kept.startSec}s + window start ${SPAN.startSec}s = its video onset ${originalVideoOnset}s`,
  );
}
assertEq(TAKE.notes.length, 4, 'the ORIGINAL take is untouched by the trim (reads only)');
close(TAKE.notes[1].startSec, 2, '…its note times are exactly what they were');

const untouched = applyTrimToTake(TAKE, null, OFFSET_MS);
assertEq(untouched.take, TAKE, 'NO WINDOW returns the SAME take object — what we sent before is what we send now');
assertEq(untouched.trimmed, false, '…and says it did not trim');

const negativeOffset = applyTrimToTake(TAKE, { startSec: 0.5, endSec: 3 }, -500);
assertEq(negativeOffset.keptCount, 3, 'a negative measured offset is applied in the same direction (video onsets 0.5 / 1.5 / 2.5)');
close(negativeOffset.take?.notes[0].startSec ?? -1, 0, '…so the first note lands exactly on the window start');

const emptyWindow = applyTrimToTake(TAKE, { startSec: 20, endSec: 30 }, OFFSET_MS);
assertEq(emptyWindow.keptCount, 0, 'a window with no notes keeps none (and says so on the surface)');
assertEq(emptyWindow.droppedCount, 4, '…counting every note it left out');

console.log('\nv47 item 2 — the player stops at the window’s end');
assertEq(trimPlaybackShouldPause(1500, { startSec: 1, endSec: 2 }), false, 'inside the window, the video keeps playing');
assertEq(trimPlaybackShouldPause(2000, { startSec: 1, endSec: 2 }), true, 'at the window’s end, it pauses');
assertEq(trimPlaybackShouldPause(9000, null), false, 'with no window, nothing stops it');
assertEq(trimPlaybackShouldPause(Number.NaN, { startSec: 1, endSec: 2 }), false, 'a NaN position never pauses by accident');

// ─── THE PAIR ────────────────────────────────────────────────────────────────
console.log('\nv47 item 2 — ONE window, BOTH members');

const pair = trimmedSendPair({ ref: ref(40, OFFSET_MS), take: TAKE, span: SPAN, note: 'bars 12–16', title: 'Practice video' });
assertEq(pair.span?.startSec, 2, 'the pair carries the window it was derived from');
assertEq(pair.video?.uri, 'file:///practice.mp4', 'the video member is the user’s own local file');
assertEq(pair.video?.trim?.endSec, 4, 'the video member carries the SAME window on it');
assertEq(pair.take?.notes.length, 2, 'the take member is the window’s notes');
close(pair.take?.notes[0].startSec ?? -1, 0.5, '…on the window’s clock');
assertEq(pair.title, 'Practice video — bars 12–16 — 0:02–0:04', 'the video’s dialog title names the window and the label');
assertEq(pair.takeTitle, 'Take — bars 12–16 — 0:02–0:04', 'the PDF/MIDI title names the same window and label');
assertEq(pair.noteLine, 'Note: bars 12–16', 'the label rides the pair');
assert(pair.spanLine !== null && pair.spanLine.indexOf('0:02–0:04') > 0, 'the pair says which window it covers');
assertEq(pair.spanHasNoNotes, false, 'a window with notes is not the empty case');
assert(TRIM_VIDEO_WHOLE_LINE.indexOf('travels whole') > 0, 'the surface states that the video file itself cannot be cut');

const wholePair = trimmedSendPair({ ref: ref(40, OFFSET_MS), take: TAKE, span: null, note: null });
assertEq(wholePair.span, null, 'no window, no span');
assertEq(wholePair.take, TAKE, 'no window: the take member is the original object');
assertEq(wholePair.spanLine, null, 'no window: no window line');
assertEq(wholePair.noteLine, null, 'no label: no label line (an older take is unchanged)');
assertEq(wholePair.title, 'Practice video', 'no window and no label: the title is the plain one');
assertEq(
  trimmedSendPair({ ref: ref(40, OFFSET_MS), take: TAKE, span: { startSec: 20, endSec: 30 }, note: null }).spanHasNoNotes,
  true,
  'a window with no notes flags the empty case so the PDF/MIDI are not offered',
);
assertEq(pairMemberTitle('take', null, null), 'Take', 'a member title with nothing to add is just the member');
assertEq(tagForTitle('x'.repeat(80))?.length, 40, 'a long label is shortened for a file name');

// ─── THE LABEL ───────────────────────────────────────────────────────────────
console.log('\nv47 item 2 — the label is the take’s own text, and absence stays absence');

assertEq(normaliseTakeTag('   bars   12–16  '), 'bars 12–16', 'the label is collapsed and trimmed');
assertEq(normaliseTakeTag('   '), null, 'an empty label is null, never an empty string');
assertEq(normaliseTakeTag(null), null, 'no label is null');
assertEq(normaliseTakeTag('x'.repeat(TAKE_TAG_MAX_CHARS + 40))?.length, TAKE_TAG_MAX_CHARS, 'the label is capped at the take note’s own limit');
assertEq(tagLineFor(null), null, 'no label → NO LINE AT ALL (the older-take rule)');
assertEq(tagLineFor('Timing'), 'Note: Timing', 'a label prints on one line');
assertEq(tagPresetIsActive('Timing', 'timing'), true, 'a preset is active whatever the case');
assertEq(tagPresetIsActive('Timing', null), false, 'no label means no active preset');
assert(TAKE_TAG_PRESETS.length >= 4 && TAKE_TAG_PRESETS.length <= 8, 'the preset set is small enough to read');
assert(TAKE_TAG_PRESETS.indexOf('Tricky bars') >= 0, 'the presets name things to listen for');

console.log('\nv47 item 2 — the summary carries the label and the window, and nothing else');

const plainSummary = videoSummaryText({ video: ref(40, OFFSET_MS), take: TAKE }, { title: 'My take' });
assertEq(plainSummary.split('\n').length, 5, 'with no label and no window the summary is exactly the lines it always was');
assert(plainSummary.indexOf('Note:') < 0, 'no label → no note line');
assert(plainSummary.indexOf('Clip:') < 0, 'no window → no clip line');
const labelledSummary = videoSummaryText(
  { video: ref(40, OFFSET_MS), take: pair.take, note: 'bars 12–16' },
  { title: 'My take', trimSpan: pair.span },
);
assert(labelledSummary.indexOf('Note: bars 12–16') > 0, 'the label is in the summary the teacher receives');
assert(labelledSummary.indexOf('Clip: 0:02–0:04') > 0, 'the window is in the summary too');
assert(labelledSummary.indexOf('Notes:') > 0, '…and the window’s notes are listed');
assert(
  labelledSummary.indexOf('NoteSnap heard') > 0 || labelledSummary.indexOf('pair') > 0,
  'the pair line survives the addition',
);

// ─── THE GUARDS, ON THE REAL FILES ───────────────────────────────────────────
console.log('\nv47 item 2 — the guards hold on the real bytes');

const SHEET = readAppFile(PARTB_SEND_SHEET_PATH);
const SCREEN = readAppFile(PARTB_SCREEN_PATH);
const EDITOR = readAppFile(CLIP_TAG_EDITOR_PATH);
const MODEL = readAppFile(CLIP_TAG_MODEL_PATH);
const TSCONFIG = readAppFile('tsconfig.tier1.json');
const PACKAGE = readAppFile('package.json');

assertEq(clipTagEditorIsMountedInSendSheet(SHEET), true, 'the clip + label step is MOUNTED in the send sheet and handed the row’s window and label');
assertEq(trimSpanIsAppliedToBothPairMembers(SHEET), true, 'ONE trimmedSendPair call feeds the video, the PDF, the MIDI and the summary');
assertEq(clipIsPersistedAndAppliedToTheVideo(SCREEN), true, 'the window is stored on the row and it starts/stops the video the user watches');
assertEq(tagIsPersistedAndCarried(SCREEN, SHEET), true, 'the label is written to the take and handed to the pair');
assertEq(partBAddsNoNetworkCall([SHEET, SCREEN, EDITOR, MODEL]), true, 'no file in this path can reach a network');
assertEq(partBModelsStayPure([MODEL]), true, 'the clip/label model imports nothing native');
assertEq(partBIsGated(TSCONFIG, PACKAGE), true, 'both new modules and both suites are in BOTH gate lists');
assertEq(clipTagEditorIsMountedInSendSheet(''), false, 'an empty sheet mounts nothing');
assertEq(trimSpanIsAppliedToBothPairMembers(''), false, 'an empty sheet derives nothing');
assertEq(tagIsPersistedAndCarried('', ''), false, 'empty sources persist nothing');
assertEq(partBAddsNoNetworkCall([]), false, 'an empty set is not offline-by-omission');

// ─── MUTATION PROBES (in memory): every guard must BITE ──────────────────────
console.log('\nv47 item 2 — mutation probes: each guard fails on the real bytes it protects');

const noEditorMount = SHEET.replace('<TakeClipTagEditor', '<EditorNotMountedAtAll');
assertEq(
  clipTagEditorIsMountedInSendSheet(noEditorMount),
  false,
  'PROBE 1: the clip step imported but NOT mounted → the mount guard FAILS',
);
const noSpanProp = SHEET.replace('span={trimSpan}', 'span={null}');
assertEq(
  clipTagEditorIsMountedInSendSheet(noSpanProp),
  false,
  'PROBE 2: the editor no longer handed the stored window → the mount guard FAILS',
);
const videoUnclipped = SHEET.replace(
  'sendPracticeVideo(sendRecord, { title: pair.title, trimSpan: pair.span })',
  'sendPracticeVideo(sendRecord, { title: pair.title })',
);
assertEq(
  trimSpanIsAppliedToBothPairMembers(videoUnclipped),
  false,
  'PROBE 3: the VIDEO member no longer carries the window → the pair guard FAILS',
);
const midiUnclipped = SHEET.replace('onSendMidi(pair.take)', 'onSendMidi(record.take ?? null)');
assertEq(
  trimSpanIsAppliedToBothPairMembers(midiUnclipped),
  false,
  'PROBE 4: the MIDI export handed the WHOLE take → the pair guard FAILS (a .mid on the wrong clock)',
);
const pdfUnclipped = SHEET.replace('exportTakePdfFromTake(pair.take, { title: pair.takeTitle', 'exportTakePdfFromTake(record.take, { title');
assertEq(
  trimSpanIsAppliedToBothPairMembers(pdfUnclipped),
  false,
  'PROBE 5: the PDF built from the WHOLE take → the pair guard FAILS',
);
const twoDerivations = SHEET.replace(
  'const sendRecord = useMemo<VideoSendRecord>(',
  'const spare = trimmedSendPair({ ref: record?.video ?? null, take: record?.take ?? null, span: null, note: null });\n  const sendRecord = useMemo<VideoSendRecord>(',
);
assertEq(
  trimSpanIsAppliedToBothPairMembers(twoDerivations),
  false,
  'PROBE 6: a SECOND pair derivation appears → the pair guard FAILS (two windows could disagree)',
);
const noPause = SCREEN.replace('trimPlaybackShouldPause(position, trimSpan)', 'false');
assertEq(
  clipIsPersistedAndAppliedToTheVideo(noPause),
  false,
  'PROBE 7: the window no longer stops the video → the persistence guard FAILS',
);
const notStored = SCREEN.replace('trim: bounded', 'trim: null');
assertEq(
  clipIsPersistedAndAppliedToTheVideo(notStored),
  false,
  'PROBE 8: the window no longer stored on the row → the persistence guard FAILS',
);
const noNoteWrite = SCREEN.replace('updatePersonalMelodyNote(row.rowId, cleaned)', 'logNote(row.rowId, cleaned)');
assertEq(
  tagIsPersistedAndCarried(noNoteWrite, SHEET),
  false,
  'PROBE 9: the label no longer written to the take → the label guard FAILS',
);
const noCarry = SHEET.replace('note: record?.note ?? null', 'note: null');
assertEq(
  tagIsPersistedAndCarried(SCREEN, noCarry),
  false,
  'PROBE 10: the label no longer handed to the pair → the label guard FAILS',
);
const networked = EDITOR.replace(
  'const { styles } = useThemedStyles(baseStyles);',
  "const { styles } = useThemedStyles(baseStyles);\n  void fetch('https://example.com/label');",
);
assertEq(
  partBAddsNoNetworkCall([SHEET, SCREEN, networked, MODEL]),
  false,
  'PROBE 11: a fetch added to the clip step → the offline guard FAILS',
);
const impure = MODEL.replace(
  "import type { MidiNoteEvent, SavedCaptureTake } from './midiExport';",
  "import { View } from 'react-native';\nimport type { MidiNoteEvent, SavedCaptureTake } from './midiExport';",
);
assertEq(
  partBModelsStayPure([impure]),
  false,
  'PROBE 12: a native import added to the model → the purity guard FAILS',
);
const ungated = TSCONFIG.replace('"src/services/takeClipTag.ts",', '');
assertEq(
  partBIsGated(ungated, PACKAGE),
  false,
  'PROBE 13: the model dropped from tsconfig.tier1.json → the gating guard FAILS',
);

// ─── the real bytes are untouched by the probes (they ran in memory) ─────────
console.log('\nv47 item 2 — the real files are unchanged by the probes');
assertEq(readAppFile(PARTB_SEND_SHEET_PATH).length, SHEET.length, 'the sheet on disk is byte-for-byte what was read');
assertEq(readAppFile(PARTB_SCREEN_PATH).length, SCREEN.length, 'the screen on disk is unchanged');
assertEq(readAppFile(CLIP_TAG_MODEL_PATH).length, MODEL.length, 'the model on disk is unchanged');
assertEq(trimSpanIsAppliedToBothPairMembers(SHEET), true, '…and the guards still pass on it');

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
