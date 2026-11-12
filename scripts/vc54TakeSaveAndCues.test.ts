/**
 * vc54TakeSaveAndCues.test.ts — THE TWO vc54 DEFECTS, PINNED SO THEY CANNOT COME BACK.
 *
 * ── DEFECT 1 (blocker): A TAKE THAT IS NOT SAVED, SILENTLY ─────────────────
 *
 * The owner: "i tried x3 times — 1 worked and 2 failed", and no failure card.
 * `savePracticeVideoRow` wrote through `storage.saveRecognition`, which SKIPS a
 * row whose id is already in History and returns void; the save then verified
 * itself by reading the row back BY ID, found the row that was already there, and
 * reported a save. Nothing threw, so nothing could show. This suite runs the real
 * all-or-nothing algorithm (services/practiceVideoSave.ts) against a fake device
 * and pins each rule:
 *
 *   1. a take whose id is already in History PATCHES that row and proves the video
 *      block that comes back is THIS take's — the legacy behaviour (skip + read
 *      back the old row) is run beside it as the control, and it returns the OLD
 *      row with the OLD uri: the defect, reproduced;
 *   2. a video file that has not landed on disk yet is WAITED for, and a file that
 *      never appears is a loud failure (null), never a row pointing at nothing;
 *   3. a failed write is retried ONCE automatically, then gives up (null = the
 *      card the screen already renders);
 *   4. the read-back is the verdict: a row that comes back with another take's
 *      video block is NOT a save.
 *
 * ── DEFECT 2: THE NOTES LANE SAYS IT HEARD NOTHING ON EVERY TAKE ───────────
 *
 * `noteCuesForVideo` dropped every note whose onset was past the video's stored
 * length, so a take of real notes mapped onto a length-less video produced ZERO
 * cues and the lane printed "there was no readable melody in this take". Pinned
 * here: a take with notes and an unknown video length DRAWS ITS NOTES; a known
 * length still drops what falls outside; and the lane's empty sentence is chosen
 * by what actually happened (no melody vs. notes outside the window).
 *
 * ── WIRING, READ FROM THE REAL FILES ───────────────────────────────────────
 *
 * The store must go through the all-or-nothing algorithm, the writer must report
 * insert-vs-existing, the lane must take its sentence from the surface, and the
 * no-notes state must offer the camera-off take instead of being a dead end.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  PRACTICE_VIDEO_SAVE_ATTEMPTS,
  writePracticeVideoRow,
  type PracticeVideoRowPatch,
  type PracticeVideoSavePort,
  type RecognitionWriteOutcome,
} from '../src/services/practiceVideoSave';
import {
  VIDEO_NO_MELODY_LINE,
  VIDEO_NOTES_OUTSIDE_LINE,
  noteCuesForVideo,
  takeTimelineSec,
  videoCueEmptyLine,
} from '../src/services/videoTakeSync';
import type { SavedPiece } from '../src/types';
import type { PracticeVideoRef } from '../src/services/practiceVideoRef';

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
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  assert(same, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// ─── REPO FILE ACCESS (the suites read the REAL files, as text) ──────────────

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'app.json'))) return dir;
    dir = path.join(dir, '..');
  }
  throw new Error('repo root not found');
}

function readRepoFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return String(fs.readFileSync(path.join(repoRoot(), rel), 'utf8'));
}

// ─── A FAKE DEVICE: one History blob, one file system, one write log ────────

interface FakeDevice extends PracticeVideoSavePort {
  history: SavedPiece[];
  files: Set<string>;
  inserts: number;
  patches: number;
  reads: number;
  waits: number;
  /** Make the next N inserts fail (a rejected AsyncStorage write). */
  failInserts: number;
  /** Make the next N patches fail (the row went away under the write). */
  failPatches: number;
  /** A file that never appears, however long we wait. */
  neverAppears: boolean;
}

function fakeDevice(seed: SavedPiece[] = [], files: string[] = []): FakeDevice {
  const device: FakeDevice = {
    history: seed,
    files: new Set(files),
    inserts: 0,
    patches: 0,
    reads: 0,
    waits: 0,
    failInserts: 0,
    failPatches: 0,
    neverAppears: false,
    readRow: async (rowId: string) => {
      device.reads += 1;
      return device.history.find((row) => row.id === rowId) ?? null;
    },
    insertRow: async (piece: SavedPiece): Promise<RecognitionWriteOutcome> => {
      device.inserts += 1;
      if (device.failInserts > 0) {
        device.failInserts -= 1;
        throw new Error('AsyncStorage write failed');
      }
      // THE REAL RULE: storage.saveRecognition is idempotent by id and SKIPS.
      if (device.history.some((row) => row.id === piece.id)) return 'existing';
      device.history = [piece, ...device.history];
      return 'inserted';
    },
    patchRow: async (rowId: string, patch: PracticeVideoRowPatch) => {
      device.patches += 1;
      if (device.failPatches > 0) {
        device.failPatches -= 1;
        return false;
      }
      const index = device.history.findIndex((row) => row.id === rowId);
      if (index < 0) return false;
      const row = device.history[index];
      device.history[index] = {
        ...row,
        ...(patch.videoRef ? { practiceVideo: patch.videoRef } : {}),
        ...(patch.take ? { capture: patch.take } : {}),
      };
      return true;
    },
    fileExists: async (uri: string) => device.files.has(uri),
    waitForFile: async (uri: string, _timeoutMs: number) => {
      device.waits += 1;
      if (device.neverAppears) return false;
      device.files.add(uri);
      return true;
    },
  };
  return device;
}

function refFor(uri: string, filmedAt: string): PracticeVideoRef {
  return {
    uri,
    durationSec: 41,
    audioOffsetMs: 0,
    measuredOffsetMs: 0,
    filmedAt,
    sizeBytes: 1024,
  };
}

function rowFor(rowId: string, uri: string | null, filmedAt: string): SavedPiece {
  return {
    id: rowId,
    title: 'Practice video',
    composer: 'You',
    savedAt: filmedAt,
    personalMelody: { audioUri: null, capturedAt: filmedAt },
    practiceVideo: uri ? refFor(uri, filmedAt) : undefined,
  } as SavedPiece;
}

function inputFor(rowId: string, uri: string | null, filmedAt: string) {
  const ref = uri ? refFor(uri, filmedAt) : null;
  return {
    piece: { ...rowFor(rowId, uri, filmedAt), ...(ref ? { practiceVideo: ref } : {}) } as SavedPiece,
    take: null,
    audioUri: null,
    videoRef: ref,
  };
}

// ─── 1. THE MECHANISM: A SKIPPED INSERT IS NOT A SAVE ───────────────────────

/**
 * THE CODE AS IT SHIPPED ON vc53, kept here as the CONTROL: insert (which skips
 * when the id exists), then "verify" by reading the row back by id. It is the
 * defect in five lines, and it is what the fixed algorithm is measured against.
 */
async function legacySave(
  rowId: string,
  uri: string,
  filmedAt: string,
  port: PracticeVideoSavePort,
): Promise<SavedPiece | null> {
  const input = inputFor(rowId, uri, filmedAt);
  await port.insertRow(input.piece);
  return port.readRow(rowId);
}

async function testSkippedInsertIsNotASave(): Promise<void> {
  console.log('\n1. A TAKE THAT LANDS ON AN EXISTING ID (the 2-in-3 failure)');
  const rowId = 'melody-20261111T101010101Z-practicevide';
  const oldUri = 'file:///docs/notesnap-practice-videos/old.mp4';
  const newUri = 'file:///docs/notesnap-practice-videos/new.mp4';

  // The control: the vc53 code reports the OLD row as the saved take.
  const legacyDevice = fakeDevice([rowFor(rowId, oldUri, '2026-11-11T10:00:00.000Z')], [oldUri, newUri]);
  const legacy = await legacySave(rowId, newUri, '2026-11-11T10:10:10.000Z', legacyDevice);
  assert(legacy !== null, 'control: the vc53 save still reports SUCCESS for the new take');
  assertEq(
    legacy?.practiceVideo?.uri,
    oldUri,
    'control: …and the row it reports is the OLD take, so the new take was never written',
  );

  // The fix: the take is patched onto that row, and the read-back is THIS take's.
  const device = fakeDevice([rowFor(rowId, oldUri, '2026-11-11T10:00:00.000Z')], [oldUri, newUri]);
  const saved = await writePracticeVideoRow(
    inputFor(rowId, newUri, '2026-11-11T10:10:10.000Z'),
    device,
  );
  assert(saved !== null, 'the fixed save reports success for the new take');
  assertEq(saved?.practiceVideo?.uri, newUri, 'and the row it reports carries THIS take’s video');
  assertEq(device.patches, 1, 'the existing row was patched (a skipped insert is not a save)');
  assertEq(
    device.history.find((row) => row.id === rowId)?.practiceVideo?.uri,
    newUri,
    'History itself now holds the new take, not the old one',
  );
}

// ─── 2. THE FILE MUST BE THERE BEFORE THE ROW ───────────────────────────────

async function testWaitsForTheFile(): Promise<void> {
  console.log('\n2. THE VIDEO FILE THAT HAS NOT LANDED YET');
  const rowId = 'melody-20261111T111111111Z-practicevide';
  const uri = 'file:///docs/notesnap-practice-videos/flushing.mp4';
  const device = fakeDevice([], []); // the file is NOT on disk when the row is written
  const saved = await writePracticeVideoRow(
    inputFor(rowId, uri, '2026-11-11T11:11:11.000Z'),
    device,
  );
  assertEq(device.waits, 1, 'the write WAITED for the file instead of writing past it');
  assert(saved !== null, 'and then wrote the row');
  assertEq(saved?.practiceVideo?.uri, uri, 'with this take’s video on it');

  // A file that never appears is a loud failure, never a row pointing at nothing.
  const gone = fakeDevice([], []);
  gone.neverAppears = true;
  const missing = await writePracticeVideoRow(
    inputFor('melody-20261111T121212121Z-practicevide', 'file:///docs/missing.mp4', '2026-11-11T12:12:12.000Z'),
    gone,
  );
  assertEq(missing, null, 'a file that never appears is a FAILED save (null → the card)');
  assertEq(gone.history.length, 0, 'and no row was written pointing at a file that is not there');
}

// ─── 3. ONE AUTOMATIC RETRY, THEN THE CARD ──────────────────────────────────

async function testRetriesOnceThenGivesUp(): Promise<void> {
  console.log('\n3. A FAILED WRITE IS RETRIED ONCE, THEN SAID OUT LOUD');
  const rowId = 'melody-20261111T131313131Z-practicevide';
  const uri = 'file:///docs/notesnap-practice-videos/retry.mp4';

  const oneFailure = fakeDevice([], [uri]);
  oneFailure.failInserts = 1;
  const recovered = await writePracticeVideoRow(
    inputFor(rowId, uri, '2026-11-11T13:13:13.000Z'),
    oneFailure,
  );
  assert(recovered !== null, 'a write that fails once is retried automatically and succeeds');
  assertEq(oneFailure.inserts, 2, `the retry is automatic (${PRACTICE_VIDEO_SAVE_ATTEMPTS} attempts)`);

  const alwaysFails = fakeDevice([], [uri]);
  alwaysFails.failInserts = 99;
  const failed = await writePracticeVideoRow(
    inputFor('melody-20261111T141414141Z-practicevide', uri, '2026-11-11T14:14:14.000Z'),
    alwaysFails,
  );
  assertEq(failed, null, 'a write that keeps failing returns null — the state the card renders');
  assertEq(alwaysFails.inserts, PRACTICE_VIDEO_SAVE_ATTEMPTS, 'and it does not loop for ever');
}

// ─── 4. THE READ-BACK IS THE VERDICT ────────────────────────────────────────

async function testReadBackIsTheVerdict(): Promise<void> {
  console.log('\n4. A ROW THAT COMES BACK AS ANOTHER TAKE IS NOT A SAVE');
  const rowId = 'melody-20261111T151515151Z-practicevide';
  const uri = 'file:///docs/notesnap-practice-videos/mine.mp4';
  const otherUri = 'file:///docs/notesnap-practice-videos/someone-else.mp4';

  // A device whose read-back always returns the OLD block, whatever was written.
  const device = fakeDevice([rowFor(rowId, otherUri, '2026-11-11T15:00:00.000Z')], [uri, otherUri]);
  device.patchRow = async () => true; // claims success, changes nothing
  const saved = await writePracticeVideoRow(
    inputFor(rowId, uri, '2026-11-11T15:15:15.000Z'),
    device,
  );
  assertEq(saved, null, 'a row carrying another take’s video is NOT reported as saved');

  const rowGone = fakeDevice([], [uri]);
  rowGone.readRow = async () => null;
  const lost = await writePracticeVideoRow(
    inputFor('melody-20261111T161616161Z-practicevide', uri, '2026-11-11T16:16:16.000Z'),
    rowGone,
  );
  assertEq(lost, null, 'a row that cannot be read back is NOT reported as saved');
}

// ─── 5. DEFECT 2: THE NOTES LANE ────────────────────────────────────────────

const TAKE = {
  notes: [
    { midi: 64, startSec: 0.5, durationSec: 0.4, velocity: 90 },
    { midi: 67, startSec: 1.2, durationSec: 0.4, velocity: 90 },
    { midi: 72, startSec: 2.0, durationSec: 0.6, velocity: 90 },
  ],
  capturedAt: '2026-11-11T10:00:00.000Z',
} as any;

function testNotesDrawWithAnUnknownVideoLength(): void {
  console.log('\n5. A REAL TAKE MUST DRAW, EVEN WITH NO STORED VIDEO LENGTH');
  // The control: the vc53 mapping, duration = videoDurationSec, drop past the end.
  const legacyDuration = Math.max(0, Number(0) || 0);
  const legacyCues = TAKE.notes.filter(
    (note: any) => note.startSec + 0 >= 0 && note.startSec + 0 < legacyDuration,
  ).length;
  assertEq(legacyCues, 0, 'control: the vc53 mapping drew NOTHING for a length-less video');

  const set = noteCuesForVideo(TAKE, { audioOffsetMs: 0, videoDurationSec: 0 });
  assertEq(set.cues.length, 3, 'the fixed mapping draws all three notes');
  assertEq(set.totalCount, 3, 'and still knows how many notes the take has');
  assert(set.timelineSec > 0, 'on a timeline taken from the take itself');
  assertEq(videoCueEmptyLine(set), null, 'so the lane has nothing to apologise for');

  // A KNOWN length keeps the old rule: notes past the end are dropped, not clamped.
  const known = noteCuesForVideo(TAKE, { audioOffsetMs: 0, videoDurationSec: 1.5 });
  assertEq(known.cues.length, 2, 'a known video length still drops the notes past its end');
  assertEq(known.droppedCount, 1, 'and counts them honestly');
  assertEq(known.timelineSec, 1.5, 'the timeline is the video’s own length when it is known');

  // …and when every note falls outside a KNOWN window, the lane says THAT.
  const outside = noteCuesForVideo(TAKE, { audioOffsetMs: -4000, videoDurationSec: 3 });
  assertEq(outside.cues.length, 0, 'notes shifted out of the window are not drawn');
  assertEq(
    videoCueEmptyLine(outside),
    VIDEO_NOTES_OUTSIDE_LINE,
    'and the lane says the notes are outside the window — never "there was no readable melody"',
  );

  // ── vc55, N5 ── A take with NO NOTES AT ALL is a third case, and it now has
  // its own sentence. Until vc55 this returned null and the lane's fixed default
  // was printed instead — which the owner read as "notes outside the window" on a
  // take of silence. The note-less take must say no melody was heard.
  const empty = noteCuesForVideo({ notes: [], capturedAt: '2026-11-11T10:00:00.000Z' } as any, {
    audioOffsetMs: 0,
    videoDurationSec: 20,
  });
  assertEq(empty.cues.length, 0, 'a take with no notes has no cues');
  assertEq(
    videoCueEmptyLine(empty),
    VIDEO_NO_MELODY_LINE,
    'and it says NO MELODY WAS HEARD — not that notes fell outside the window (vc55, N5)',
  );
  assert(
    videoCueEmptyLine(empty) !== VIDEO_NOTES_OUTSIDE_LINE,
    'the note-less sentence is not the outside-the-window sentence',
  );

  assertEq(takeTimelineSec(TAKE, 0), 2.6, 'the take’s own span is its last note’s end');
  assertEq(takeTimelineSec(null, 0), 0, 'and it is zero when there is no take');
}

// ─── 6. THE WIRING, READ FROM THE REAL FILES ────────────────────────────────

function testWiring(): void {
  console.log('\n6. THE WIRING (read from the real files)');
  const store = readRepoFile('src/services/practiceVideoStore.ts');
  assert(
    store.indexOf('writePracticeVideoRow(') >= 0,
    'the store saves through the all-or-nothing algorithm',
  );
  assert(
    store.indexOf('practiceVideoSavePort') >= 0,
    'and supplies the device port it runs on',
  );

  const storage = readRepoFile('src/services/storage.ts');
  assert(
    storage.indexOf('RecognitionWriteOutcome') >= 0,
    'the History writer REPORTS whether it inserted or found the id (it used to return void)',
  );
  assert(
    storage.indexOf("return 'existing'") >= 0,
    'a skipped insert is now a value the caller can see',
  );

  const screen = readRepoFile('src/screens/PracticeVideoScreen.tsx');
  assert(
    screen.indexOf('emptyLine={cueEmptyLine}') >= 0,
    'the surface supplies the lane’s empty sentence (both lanes)',
  );
  assert(
    screen.indexOf('videoCueEmptyLine(cueSet)') >= 0,
    'and it comes from what actually happened to the take',
  );
  const noTake = screen.indexOf('{!take && !takeBusy ? (');
  assert(noTake >= 0, 'a take with no notes is not a dead end');
  assert(
    noTake >= 0 && screen.slice(noTake, noTake + 900).indexOf('recordSeparateTake()') >= 0,
    'it offers the camera-off take, which is written onto the same row',
  );

  const lane = readRepoFile('src/components/VideoOverlayLane.tsx');
  assert(lane.indexOf('emptyLine') >= 0, 'the lane takes its empty sentence from the surface');
  assert(
    lane.indexOf('<Text style={styles.empty}>{emptyLine}</Text>') >= 0,
    'and draws it instead of a sentence of its own',
  );
}

// ─── RUN ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await testSkippedInsertIsNotASave();
  await testWaitsForTheFile();
  await testRetriesOnceThenGivesUp();
  await testReadBackIsTheVerdict();
  testNotesDrawWithAnUnknownVideoLength();
  testWiring();

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
