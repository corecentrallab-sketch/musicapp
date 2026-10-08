/**
 * v34Fixes.test.ts — tier1 gate for the v34 batch's PURE half.
 *
 * What it pins, in the order the owner reported the defects (device pass
 * 2026-10-06: "Unable to hear any audio… device on max volume", "The Correct
 * Your Take page also freezes and will not scroll up", "opening Correct from a
 * History row showed a blank corrected take"):
 *
 *   1. audioDiagnostics — every audio failure has ONE honest sentence, the store
 *      is latest-wins, a dismiss clears it, and the chip text is NEVER blank;
 *   2. toneSourceLadder — the packaged `assets_…` name vs the identifier the app
 *      computes (`tones_…`), the rung order, and the remembered rung;
 *   3. editorGestures — never claim touch-down, pitch = vertical, timing =
 *      horizontal, and the page may scroll whenever a drag is not in flight;
 *   4. editorTakeLoad — which take the editor is showing, and exactly when it
 *      reloads (never under a user with edits in flight);
 *   5. the CLIP-LESS persisted take: a take read back from persistence with its
 *      notes and key intact feeds the editor model AND still produces a real
 *      Standard MIDI File (MThd header) — the History row's audio clip being gone
 *      must never cost the user their notation or their export;
 *   6. the pre-fix fixtures: the v33 rules (a model built once at mount, a lane
 *      that claims every touch, a silently swallowed failure) are asserted to
 *      FAIL, so a regression cannot pass by resembling the old code.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  AUDIO_CHIP_PREFIX,
  AUDIO_DETAIL_MAX,
  audioChipText,
  audioFailureListenerCount,
  audioFailureReasonLine,
  clearAudioFailure,
  currentAudioFailure,
  reportAudioFailure,
  subscribeAudioFailure,
  usableDetail,
  type AudioFailureReason,
} from '../src/services/audioDiagnostics';
import {
  ANDROID_RAW_ASSET_PREFIX,
  TONE_SOURCE_ORDER,
  androidResourceUri,
  describeToneSourceRung,
  orderToneSourceLadder,
  tonePackagedResourceName,
  toneResourceStem,
  toneSourceLadder,
} from '../src/services/toneSourceLadder';
import {
  EDITOR_DRAG_AXIS_RATIO,
  EDITOR_DRAG_MIN_PX,
  pageScrollEnabledDuringDrag,
  shouldCaptureEdgeDrag,
  shouldCapturePitchDrag,
  shouldStartEditorDrag,
} from '../src/services/editorGestures';
import {
  EDITOR_LOADED_TAKE_LINE,
  EDITOR_NO_TAKE_LINE,
  shouldReloadEditorModel,
  takeIdentityOf,
  takeNoteCount,
} from '../src/services/editorTakeLoad';
import { createEditorState, deriveTake } from '../src/services/takeEditor';
import { detectKeyFromNotes } from '../src/services/keyDetection';
import {
  MIDI_HEADER_BYTES,
  encodeMidiFile,
  type MidiNoteEvent,
  type SavedCaptureTake,
} from '../src/services/midiExport';

declare const process: { exit(code: number): never };

let passes = 0;
let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}

/** The owner's own case: a hummed melody saved with its key, then re-opened. */
function persistedTake(): SavedCaptureTake {
  const notes: MidiNoteEvent[] = [
    { midi: 67, startSec: 0, durationSec: 0.5, velocity: 90 },
    { midi: 69, startSec: 0.5, durationSec: 0.5, velocity: 88 },
    { midi: 71, startSec: 1, durationSec: 0.5, velocity: 84 },
    { midi: 72, startSec: 1.5, durationSec: 1, velocity: 96 },
    { midi: 71, startSec: 2.5, durationSec: 0.5, velocity: 80 },
    { midi: 69, startSec: 3, durationSec: 1.5, velocity: 76 },
  ];
  return {
    notes,
    tempoBpm: 96,
    durationSec: 4.5,
    key: detectKeyFromNotes(notes),
    capturedAt: '2026-10-06T09:15:00.000Z',
  };
}

/** What the app REALLY stores: the take as JSON, read back later (no clip). */
function throughPersistence(take: SavedCaptureTake): SavedCaptureTake {
  return JSON.parse(JSON.stringify(take)) as SavedCaptureTake;
}

// ── 1. the diagnostics store ────────────────────────────────────
function diagnosticsTests(): void {
  console.log('\nv34 fix 1 — every audio failure has one honest sentence');
  clearAudioFailure();
  assertEq(currentAudioFailure(), null, 'a healthy audio stack reports nothing');

  const reasons: AudioFailureReason[] = [
    'session-setup',
    'tone-load',
    'clip-missing',
    'clip-load',
    'recorder-error',
    'unknown',
  ];
  let allLong = true;
  let allDistinct = true;
  const seen: string[] = [];
  for (const reason of reasons) {
    const line = audioFailureReasonLine(reason);
    if (line.length < 20) allLong = false;
    if (seen.indexOf(line) >= 0) allDistinct = false;
    seen.push(line);
    assert(line.indexOf('unknown') < 0, `"${reason}" reads as plain words (${line})`);
  }
  assert(allLong, 'every reason maps to a real sentence, never a bare code');
  assert(allDistinct, 'every reason has its OWN sentence (no two defects look alike)');
  assert(
    audioFailureReasonLine('tone-load').indexOf('tones') > 0,
    'the owner\'s silent-tone case names the preview tones',
  );
  assert(
    audioFailureReasonLine('clip-missing').indexOf('not on this device') > 0,
    'a missing recording says so, and never blames the user',
  );

  // The chip's whole text: prefix + sentence, never blank, never a bare reason.
  assertEq(
    audioChipText(null),
    `${AUDIO_CHIP_PREFIX}: playback failed on this device`,
    'no failure at all still renders a complete sentence (never the word unknown)',
  );
  assertEq(
    audioChipText(null).indexOf('unknown'),
    -1,
    'the fallback never leaks the raw code "unknown" to the user',
  );

  const reported = reportAudioFailure({
    source: 'tone-preview',
    reason: 'tone-load',
    detail: '  module: Error: Unable to resolve asset   ',
  });
  assertEq(currentAudioFailure(), reported, 'a report is what the store holds');
  assertEq(reported.detail, 'module: Error: Unable to resolve asset', 'the detail is sanitized on the way in');
  const chip = audioChipText(currentAudioFailure());
  assert(chip.indexOf(AUDIO_CHIP_PREFIX + ': ') === 0, 'the chip starts with the fixed prefix');
  assert(chip.indexOf('preview tones') > 0, 'and carries the reason sentence');
  assert(chip.indexOf('module: Error') > 0, 'the device\'s own message rides along in the detail');

  // LATEST WINS — the user is looking at the button they just pressed.
  const second = reportAudioFailure({ source: 'take-playback', reason: 'clip-load', detail: 'boom' });
  assertEq(currentAudioFailure()?.reason, 'clip-load', 'a later failure replaces the earlier one');
  assertEq(currentAudioFailure()?.source, 'take-playback', 'including which part of the stack failed');
  assert(second.at >= reported.at, 'and it carries its own timestamp');

  // Subscribe / notify / unsubscribe.
  let notified = 0;
  const before = audioFailureListenerCount();
  const unsubscribe = subscribeAudioFailure(() => {
    notified += 1;
  });
  assertEq(audioFailureListenerCount(), before + 1, 'subscribing attaches one listener');
  reportAudioFailure({ source: 'recording', reason: 'recorder-error', detail: 'mic' });
  assertEq(notified, 1, 'a report notifies the subscriber (the chip re-renders)');
  assertEq(clearAudioFailure(), true, 'dismissing clears a standing failure');
  assertEq(notified, 2, 'a clear notifies too (the chip disappears)');
  assertEq(currentAudioFailure(), null, 'and the store is empty afterwards');
  assertEq(clearAudioFailure(), false, 'clearing an empty store is a no-op, not an error');
  unsubscribe();
  assertEq(audioFailureListenerCount(), before, 'unsubscribing detaches the listener (no leak)');
  reportAudioFailure({ source: 'audio-session', reason: 'session-setup', detail: 'late' });
  assertEq(notified, 2, 'a detached listener is never called again');

  // A broken listener must not take the audio path down with it.
  const thrower = subscribeAudioFailure(() => {
    throw new Error('listener blew up');
  });
  let stillCalled = false;
  const healthy = subscribeAudioFailure(() => {
    stillCalled = true;
  });
  reportAudioFailure({ source: 'tone-preview', reason: 'tone-load', detail: 'x' });
  assert(stillCalled, 'one broken listener does not stop the others');
  thrower();
  healthy();
  clearAudioFailure();

  // Detail bounds: a native exception must never take the whole screen.
  assertEq(usableDetail(''), '', 'no detail renders as nothing, not as "undefined"');
  assertEq(usableDetail(42), '', 'a non-text detail is not invented into text');
  assertEq(usableDetail({ message: 'failed' }), 'failed', 'an object detail uses its message');
  assertEq(usableDetail('  a\n\tb  '), 'a b', 'whitespace collapses to one line');
  const long = usableDetail('x'.repeat(400));
  assertEq(long.length, AUDIO_DETAIL_MAX, 'a long detail is bounded to one line');
  assertEq(long.charAt(long.length - 1), '…', 'and it is visibly truncated, never silently cut');
}

// ── 2. the tone source ladder ───────────────────────────────────
function toneLadderTests(): void {
  console.log('\nv34 fix 1b — how a bundled tone is found on an Android release build');
  assertEq(toneResourceStem('Piano', 60), 'tones_piano_m60', 'lowercased instrument + rounded pitch');
  assertEq(
    tonePackagedResourceName('piano', 60),
    'assets_tones_piano_m60',
    'the name the AAB really ships in res/raw (assets_ prefix present)',
  );
  assertEq(
    tonePackagedResourceName('piano', 60).indexOf(ANDROID_RAW_ASSET_PREFIX),
    0,
    'and that prefix is the documented one',
  );
  assert(
    toneResourceStem('piano', 60).indexOf(ANDROID_RAW_ASSET_PREFIX) < 0,
    'the identifier the app computes has the prefix STRIPPED (the mismatch the fix is about)',
  );
  assertEq(toneResourceStem('piano', 60.4), 'tones_piano_m60', 'a fractional pitch rounds like the runtime does');
  assertEq(toneResourceStem('piano', NaN), 'tones_piano_m0', 'a non-finite pitch never spells a malformed name');

  assertEq(
    androidResourceUri('com.notesnap.sheetmusic', 'assets_tones_piano_m60'),
    'android.resource://com.notesnap.sheetmusic/raw/assets_tones_piano_m60',
    'the scheme-qualified URI (the rung that skips both identifier computations)',
  );
  assertEq(androidResourceUri('  com.notesnap.sheetmusic  ', 'a'), 'android.resource://com.notesnap.sheetmusic/raw/a', 'a padded package name is trimmed');
  assertEq(androidResourceUri('', 'a'), null, 'no package name = no rung, never a malformed URI');
  assertEq(androidResourceUri(null, 'a'), null, 'a null package name is handled');
  assertEq(androidResourceUri('com.x', ''), null, 'an empty resource name is handled');

  const rungs = toneSourceLadder({
    instrument: 'piano',
    midi: 60,
    moduleId: 7,
    packageName: 'com.notesnap.sheetmusic',
  });
  assertEq(rungs.length, 3, 'all three rungs exist on Android when the module id is a number');
  assertEq(
    rungs.map((r) => r.kind).join(','),
    TONE_SOURCE_ORDER.join(','),
    'in the documented preference order (module first — it is correct on iOS and in dev)',
  );
  assertEq(
    (rungs[1].source as { uri: string }).uri,
    'android.resource://com.notesnap.sheetmusic/raw/assets_tones_piano_m60',
    'rung 2 is the PACKAGED name (assets_ present) — what the v33 AAB actually contains',
  );
  assertEq(
    (rungs[2].source as { uri: string }).uri,
    'android.resource://com.notesnap.sheetmusic/raw/tones_piano_m60',
    'rung 3 is the stripped name the app computes',
  );
  assertEq(rungs[0].source, 7, 'the module rung hands the require()d id straight to the player');

  const noModule = toneSourceLadder({ instrument: 'guitar', midi: 55, moduleId: null, packageName: 'com.x' });
  assertEq(noModule.length, 2, 'a missing module id drops that rung rather than passing junk');
  assertEq(noModule[0].kind, 'android-resource-packaged', 'and the ladder continues at the packaged rung');
  assertEq(
    toneSourceLadder({ instrument: 'strings', midi: 60, moduleId: 3, android: false }).length,
    1,
    'off Android only the module rung exists (no resource URIs are invented)',
  );
  assertEq(
    toneSourceLadder({ instrument: 'piano', midi: 60, moduleId: 3 }).length,
    1,
    'an unknown package name leaves one rung, never a broken URI',
  );

  const preferred = orderToneSourceLadder(rungs, 'android-resource-packaged');
  assertEq(preferred[0].kind, 'android-resource-packaged', 'a rung that already worked is tried FIRST');
  assertEq(preferred.length, 3, 'and no rung is lost by reordering');
  assertEq(
    orderToneSourceLadder(rungs, 'android-resource-stripped')[0].kind,
    'android-resource-stripped',
    'the same for the stripped rung',
  );
  assertEq(
    orderToneSourceLadder(rungs, null).map((r) => r.kind).join(','),
    TONE_SOURCE_ORDER.join(','),
    'no memory of a working rung = the documented default order',
  );
  assertEq(
    orderToneSourceLadder(rungs, 'module').map((r) => r.kind).join(','),
    TONE_SOURCE_ORDER.join(','),
    'and a remembered rung that is already first changes nothing',
  );
  assertEq(describeToneSourceRung(rungs[0]), 'module', 'a rung describes itself for the diagnostics detail');
  assert(
    describeToneSourceRung(rungs[1]).indexOf('android-resource-packaged:android.resource://') === 0,
    'a URI rung includes the URI it failed on',
  );
}

// ── 3. the editor's gestures ────────────────────────────────────
function gestureTests(): void {
  console.log('\nv34 fix 3 — a drag layer inside a scroller may only take a gesture it can use');
  assertEq(shouldStartEditorDrag(), false, 'the lane NEVER claims the touch on touch-down (the v33 freeze)');
  assertEq(EDITOR_DRAG_MIN_PX, 8, 'the activation distance is 8dp');
  assertEq(EDITOR_DRAG_AXIS_RATIO, 1.2, 'and the dominance ratio is 1.2');

  assertEq(shouldCapturePitchDrag(0, 20), true, 'a clearly vertical move is a pitch drag');
  assertEq(shouldCapturePitchDrag(0, -20), true, 'up and down both count');
  assertEq(shouldCapturePitchDrag(0, 5), false, 'a twitch below the threshold is left to the page');
  assertEq(shouldCapturePitchDrag(20, 5), false, 'a clearly horizontal move is NOT a pitch drag');
  assertEq(shouldCapturePitchDrag(20, 20), false, 'and a diagonal move is left to the page (no stolen scroll)');
  assertEq(shouldCapturePitchDrag(-20, -30), true, 'dominance, not sign, decides');

  assertEq(shouldCaptureEdgeDrag(20, 5), true, 'a clearly horizontal move is a timing drag (the edge handle)');
  assertEq(shouldCaptureEdgeDrag(-20, 5), true, 'left and right both count');
  assertEq(shouldCaptureEdgeDrag(5, 20), false, 'a vertical move is left to the page');
  assertEq(shouldCaptureEdgeDrag(20, 20), false, 'a diagonal move is left to the page');
  assertEq(shouldCaptureEdgeDrag(5, 0), false, 'a twitch below the threshold is left to the page');
  assertEq(shouldCaptureEdgeDrag(8, 8), false, 'the ratio outranks the threshold');

  // v36 fix 1 CHANGED THIS RULE ON PURPOSE. v34 froze the page while a note drag
  // was in flight; the owner's v35 device pass still read "Again page does not
  // scroll down", and a scroller switched off by editor state is a second,
  // independent way to lose scrolling for good (one stuck flag = a dead page). The
  // drag layer now blocks native scrolling on its own responder instead, so the
  // page is never frozen by editor state — asserted by v36Fixes.test.ts.
  assertEq(pageScrollEnabledDuringDrag(true), true, 'the page is NEVER frozen by editor state (v36)');
  assertEq(pageScrollEnabledDuringDrag(false), true, 'the page scrolls whenever no drag owns the gesture');
}

// ── 4. which take the editor is showing ─────────────────────────
function takeLoadTests(): void {
  console.log('\nv34 fix 2 — which take the correction editor is showing, and when it reloads');
  const take = persistedTake();
  const other: SavedCaptureTake = { ...take, capturedAt: '2026-10-06T09:31:00.000Z' };
  const shorter: SavedCaptureTake = { ...take, notes: take.notes.slice(0, 3) };

  assertEq(takeNoteCount(take), 6, 'the note count is read, never guessed');
  assertEq(takeNoteCount(null), 0, 'and a missing take has none');
  assertEq(takeNoteCount(undefined), 0, 'including an undefined one');

  const id = takeIdentityOf(take, 'row-1');
  assertEq(takeIdentityOf(take, 'row-1'), id, 'the same take + row is the same identity');
  assert(takeIdentityOf(other, 'row-1') !== id, 'a re-recorded take (new stamp) is a DIFFERENT take');
  assert(takeIdentityOf(shorter, 'row-1') !== id, 'a corrected copy (fewer notes) is a different take');
  assert(takeIdentityOf(take, 'row-2') !== id, 'a different History row is a different take');
  assert(takeIdentityOf(null, null).length > 0, 'and the no-take identity is a real value, not ""');
  assert(
    takeIdentityOf(throughPersistence(take), 'row-1') === id,
    'a take read back from persistence is the SAME take (the identity survives the round trip)',
  );

  const base = {
    loadedIdentity: id,
    incomingIdentity: id,
    opened: false,
    edited: false,
    currentNoteCount: 6,
    incomingNoteCount: 6,
  };
  assertEq(shouldReloadEditorModel(base), false, 'nothing changed = no reload (no flicker)');
  assertEq(
    shouldReloadEditorModel({ ...base, opened: true }),
    true,
    'EVERY open re-reads the host\'s take (the blank-editor fix)',
  );
  assertEq(
    shouldReloadEditorModel({ ...base, opened: true, edited: true }),
    true,
    'and a fresh open wins even over in-flight edits (the user asked for this take)',
  );
  assertEq(
    shouldReloadEditorModel({ ...base, incomingIdentity: takeIdentityOf(other, 'row-1') }),
    true,
    'a different take the user has not touched replaces the model',
  );
  assertEq(
    shouldReloadEditorModel({
      ...base,
      incomingIdentity: takeIdentityOf(other, 'row-1'),
      edited: true,
    }),
    false,
    'but NEVER under a user who has made an edit (their correction is not wiped)',
  );
  assertEq(
    shouldReloadEditorModel({
      ...base,
      loadedIdentity: 'row-1||0',
      incomingIdentity: takeIdentityOf(take, 'row-1'),
      currentNoteCount: 0,
      incomingNoteCount: 6,
      edited: true,
    }),
    true,
    'a take arriving LATE (History hydration) fills a blank editor even after an edit',
  );
  assertEq(
    shouldReloadEditorModel({
      ...base,
      incomingIdentity: takeIdentityOf({ ...take, notes: [] }, 'row-1'),
      currentNoteCount: 6,
      incomingNoteCount: 0,
      edited: true,
    }),
    false,
    'a late take that carries NO notes never wipes a model the user has corrected',
  );
  assertEq(
    shouldReloadEditorModel({
      ...base,
      incomingIdentity: takeIdentityOf(null, 'row-2'),
      currentNoteCount: 6,
      incomingNoteCount: 0,
      edited: false,
    }),
    true,
    'while an untouched model always follows the host (the host is authoritative)',
  );
  assert(
    EDITOR_NO_TAKE_LINE.indexOf('record another take') > 0,
    'and the empty state is a real sentence, not "No key detected"',
  );
  assert(
    EDITOR_LOADED_TAKE_LINE.indexOf('loaded') > 0,
    'while a loaded take SAYS it loaded (the user can tell the two apart)',
  );
  assert(
    (EDITOR_NO_TAKE_LINE as string) !== (EDITOR_LOADED_TAKE_LINE as string),
    'the two states never read alike',
  );
}

// ── 5. the persisted, clip-less take ────────────────────────────
function persistedTakeTests(): void {
  console.log('\nitem 4 — a persisted, CLIP-LESS take still feeds the editor and still exports MIDI');
  const take = persistedTake();
  const reloaded = throughPersistence(take);

  // The editor model from the take the app re-opened (no clip anywhere in it).
  const state = createEditorState(reloaded);
  assertEq(state.notes.length, 6, 'the editor model holds every note of the persisted take');
  assertEq(state.detected.length, 6, 'and the detected copy "Reset to detected" needs');
  assertEq(state.notes.map((n) => n.midi).join(','), '67,69,71,72,71,69', 'the pitches survived persistence intact');
  assertEq(state.notes.map((n) => n.startSec).join(','), '0,0.5,1,1.5,2.5,3', 'so did every onset');
  assertEq(state.tempoBpm, 96, 'and the tempo the take was captured with');
  assertEq(state.capturedAt, '2026-10-06T09:15:00.000Z', 'and its capture stamp');
  const keyLine = detectKeyFromNotes(reloaded.notes);
  assert(keyLine !== null, 'the persisted take still carries a detected key');
  const derived = deriveTake(state);
  assertEq(derived.key?.tonic, keyLine?.tonic, 'the editor re-derives the SAME tonic the take was saved with');
  assertEq(derived.key?.mode, keyLine?.mode, 'and the same mode (major/minor)');
  assert(!!derived.keyLabel && derived.keyLabel.length > 0, 'so the editor can name the key, never "No key detected"');
  assertEq(derived.take.notes.length, 6, 'the corrected take keeps all six notes for History / export / playback');

  // The blank-model default is what the reload rule exists to prevent.
  const blank = createEditorState(null);
  assertEq(blank.notes.length, 0, 'a model built from no take is empty (the v33 blank editor)');
  assertEq(blank.tempoBpm, 100, 'and falls back to 100 bpm rather than claiming a tempo');
  assertEq(shouldReloadEditorModel({
    loadedIdentity: takeIdentityOf(null, 'row-1'),
    incomingIdentity: takeIdentityOf(reloaded, 'row-1'),
    opened: false,
    edited: false,
    currentNoteCount: 0,
    incomingNoteCount: 6,
  }), true, 'and the reload rule replaces that blank model with the real take');

  // THE EXPORT: the History row's audio clip being gone must not cost the file.
  const bytes = encodeMidiFile({
    notes: reloaded.notes,
    tempoBpm: reloaded.tempoBpm,
    key: reloaded.key,
    title: 'Your take',
  });
  assert(bytes !== null, 'a clip-less take still encodes (the notes are the source of truth, not the clip)');
  const file = bytes as Uint8Array;
  assert(file.length > MIDI_HEADER_BYTES, `the file is longer than the header alone (${file.length} bytes)`);
  assertEq(
    String.fromCharCode(file[0], file[1], file[2], file[3]),
    'MThd',
    'and it starts with a real Standard MIDI File header chunk',
  );
  assertEq((file[8] << 8) | file[9], 1, 'with a Type-1 format in the header (multi-track from the start)');
  const text = Array.from(file).map((b) => String.fromCharCode(b)).join('');
  assert(text.indexOf('MTrk') > 0, 'and at least one track chunk follows');
  assert(text.indexOf(String.fromCharCode(0xff, 0x59)) > 0, 'the key signature meta event is present when the take has a key');

  assertEq(
    encodeMidiFile({ notes: [], tempoBpm: 96, key: null }),
    null,
    'while a take with no notes still refuses an empty file (never a fake export)',
  );
}

// ── 6. the pre-fix fixtures ─────────────────────────────────────
function preFixFixtures(): void {
  console.log('\nthe pre-fix (v33) behaviours are asserted to FAIL');
  // v33 asserted the touch on touch-down; the fix is a function that returns false.
  assertEq(shouldStartEditorDrag(), false, 'a lane that claims touch-down is not what we install');
  assertEq(shouldCapturePitchDrag(20, 3), false, 'v33\'s "any move at all" is not a pitch drag');
  // v33 froze the page behind its drag layer entirely; v36 keeps the page live and
  // moves the "do not steal my edit" job onto the responder itself.
  assertEq(pageScrollEnabledDuringDrag(true), true, 'and the page is scrollable even mid-drag (v36)');

  // v33 built the model ONCE at mount: the incoming take was never compared.
  const take = persistedTake();
  assertEq(
    shouldReloadEditorModel({
      loadedIdentity: null,
      incomingIdentity: '',
      opened: false,
      edited: false,
      currentNoteCount: 0,
      incomingNoteCount: takeNoteCount(take),
    }),
    true,
    'the v33 blank-editor case (no identity loaded, take available) reloads now',
  );
  clearAudioFailure();
  assertEq(currentAudioFailure(), null, 'and a healthy stack still renders no chip at all');
}

function main(): void {
  diagnosticsTests();
  toneLadderTests();
  gestureTests();
  takeLoadTests();
  persistedTakeTests();
  preFixFixtures();
  if (failures > 0) {
    console.error(`\n${passes} passed, ${failures} failed`);
    process.exit(1);
  }
  console.log(`\n${passes} passed, 0 failed`);
}
main();
