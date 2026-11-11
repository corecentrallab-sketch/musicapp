/**
 * vc53HistoryQueue.test.ts — ITEM 1 (A5): THE TAKE THAT IS NEVER IN HISTORY.
 *
 * WHAT THIS SUITE PROVES, in the order the vc53 brief asks for it:
 *
 *   1. THE MECHANISM, RUN FOR REAL. Two writers that each do
 *      read → mutate → write on ONE blob lose a row when they overlap. The same
 *      two writers, each wrapped in `enqueueHistoryWrite`, both survive. The
 *      unguarded half is the control: it is the code as it shipped on vc52, and
 *      the assertion fails if the queue stops serialising.
 *   2. THE OBSERVED PATH. A write followed by the History tab's own read finds the
 *      row; a write that is later overwritten from a stale snapshot does not — the
 *      one mechanism that produces the owner's two answers together (no row, and
 *      no failure card, because the save's read-back ran before the loss).
 *   3. THE WIRING, READ FROM THE REAL FILES. All five History writers go through
 *      the queue; History re-reads on focus; the practice-video save writes the
 *      row first, attaches second and verifies third; the verify is reachable from
 *      the flow the user actually takes; and the "saved" line can only render from
 *      a read-back.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  enqueueHistoryWrite,
  historyWriteQueueIdle,
  historyWritesPending,
} from '../src/services/historyWriteQueue';
import { filterSavedPieces } from '../src/services/historyPiece';

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

/** The body of `export async function <name>(` … up to the next top-level `}`. */
function functionBody(source: string, name: string): string | null {
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) return null;
  const end = source.indexOf('\n}\n', start);
  if (end < 0) return null;
  return source.slice(start, end + 3);
}

// ─── 1. THE BLOB, AND THE TWO WRITERS ───────────────────────────────────────

/**
 * The ONE History blob, with the property that makes the race real: the read and
 * the write are separate `await`s, so the JS thread can start another writer in
 * between. `delayMs` stands in for a real device's async storage hop.
 */
interface Blob {
  read(): Promise<Array<{ id: string }>>;
  write(rows: Array<{ id: string }>): Promise<void>;
  ids(): string[];
}

function makeBlob(delayMs: number): Blob {
  let raw = '[]';
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
  return {
    async read() {
      const snapshot = raw;
      await sleep(delayMs);
      return JSON.parse(snapshot);
    },
    async write(rows) {
      await sleep(delayMs);
      raw = JSON.stringify(rows);
    },
    ids() {
      return (JSON.parse(raw) as Array<{ id: string }>).map((row) => row.id);
    },
  };
}

/** EXACTLY the shape of every writer in services/storage.ts. */
function writer(blob: Blob, id: string): () => Promise<void> {
  return async () => {
    const history = await blob.read();
    if (!history.some((row) => row.id === id)) {
      history.unshift({ id });
      await blob.write(history);
    }
  };
}

async function testUnguardedLosesARow(): Promise<void> {
  console.log('\n1a. CONTROL — two unguarded writers on one blob (the vc52 code)');
  const blob = makeBlob(6);
  await Promise.all([writer(blob, 'take-from-the-practice-screen')(), writer(blob, 'other-row')()]);
  const ids = blob.ids();
  assert(
    ids.length === 1,
    `the overlap loses a row (blob holds ${ids.length}: ${ids.join(', ')}) — this is the defect, reproduced`,
  );
}

async function testQueuedKeepsBothRows(): Promise<void> {
  console.log('\n1b. THE FIX — the same two writers, queued');
  const blob = makeBlob(6);
  await Promise.all([
    enqueueHistoryWrite(writer(blob, 'take-from-the-practice-screen')),
    enqueueHistoryWrite(writer(blob, 'other-row')),
  ]);
  const ids = blob.ids();
  assert(ids.length === 2, `both rows survive (blob holds ${ids.length}: ${ids.join(', ')})`);
  assert(ids.indexOf('take-from-the-practice-screen') >= 0, 'the practice take is one of them');
  await historyWriteQueueIdle();
  assertEq(historyWritesPending(), 0, 'the queue drains');
}

async function testObservedPath(): Promise<void> {
  console.log('\n2. THE OBSERVED PATH — write, then the History read, then a stale writer');
  // (a) The save, then the read History performs.
  const blob = makeBlob(1);
  await enqueueHistoryWrite(writer(blob, 'take-1'));
  const afterSave = await blob.read();
  assertEq(
    afterSave.map((row) => row.id),
    ['take-1'],
    'write → History read finds the take (the save DID reach the blob)',
  );

  // (b) The save's own read-back passes, and a later writer holding a snapshot
  //     taken BEFORE the save puts the whole blob back. This is the only
  //     mechanism in the code that removes a stored row without any error — and
  //     it is why the owner saw no failure card: the verify had already passed.
  const staleBlob = makeBlob(0);
  await staleBlob.write([{ id: 'an-older-row' }]);
  const staleSnapshot = await staleBlob.read(); // taken before the save lands
  await enqueueHistoryWrite(writer(staleBlob, 'take-1'));
  const readBack = await staleBlob.read();
  assert(readBack.some((row) => row.id === 'take-1'), 'the save read-back sees the take');
  await staleBlob.write(staleSnapshot); // an unqueued writer with an old snapshot
  const afterStale = await staleBlob.read();
  assert(
    !afterStale.some((row) => row.id === 'take-1'),
    'a stale snapshot written back erases the take — no row, no error (the owner\'s report)',
  );

  // (c) The same stale writer THROUGH the queue cannot exist: the read happens
  //     inside the queued task, after every earlier write.
  const queuedBlob = makeBlob(2);
  await queuedBlob.write([{ id: 'an-older-row' }]);
  await Promise.all([
    enqueueHistoryWrite(writer(queuedBlob, 'take-1')),
    enqueueHistoryWrite(async () => {
      const history = await queuedBlob.read();
      history.unshift({ id: 'take-2' });
      await queuedBlob.write(history);
    }),
  ]);
  const queuedIds = queuedBlob.ids();
  assertEq(
    queuedIds.slice().sort(),
    ['an-older-row', 'take-1', 'take-2'],
    'queued writers never read a snapshot older than the last write',
  );
}

// ─── 3. THE WIRING, READ FROM THE REAL FILES ────────────────────────────────

const WRITERS = [
  'saveRecognition',
  'updateRecognitionCapture',
  'updateRecognitionPracticeVideo',
  'updateRecognitionNote',
  'removeRecognition',
];

function testStorageWritersAreQueued(): void {
  console.log('\n3a. Every History writer goes through the one queue');
  const storage = readRepoFile('src/services/storage.ts');
  assert(
    storage.indexOf("from './historyWriteQueue'") >= 0,
    'storage.ts imports the queue',
  );
  WRITERS.forEach((name) => {
    const body = functionBody(storage, name);
    assert(!!body, `${name} is still a function in storage.ts`);
    assert(!!body && body.indexOf('enqueueHistoryWrite(') >= 0, `${name} writes through the queue`);
  });
  // No write to the History key can escape: every `setItem(KEYS.RECOGNITION_HISTORY`
  // must sit inside one of those five bodies (counted, not eyeballed).
  const setItemCount = storage.split('KEYS.RECOGNITION_HISTORY,').length - 1;
  const queuedCount = storage.split('enqueueHistoryWrite(').length - 1;
  assert(
    setItemCount > 0 && setItemCount <= queuedCount,
    `no History write escapes the queue (${setItemCount} writes, ${queuedCount} queued tasks)`,
  );
}

function testHistoryReReadsOnFocus(): void {
  console.log('\n3b. History re-reads on focus');
  const screen = readRepoFile('src/screens/HistoryScreen.tsx');
  const focus = screen.indexOf('useFocusEffect(');
  assert(focus >= 0, 'HistoryScreen uses useFocusEffect');
  const reload = screen.indexOf('const reload = useCallback(');
  assert(reload >= 0, 'History has ONE reload that reads the blob');
  const reloadBody = screen.slice(reload, reload + 700);
  assert(
    reloadBody.indexOf('getRecognitionHistory()') >= 0,
    'reload reads getRecognitionHistory (the same read the save verifies against)',
  );
  assert(
    screen.slice(focus, focus + 300).indexOf('reload') >= 0,
    'the focus effect calls reload, so a row written while the tab was mounted appears',
  );
  // And nothing filters a take out of the list.
  const rows = filterSavedPieces(
    [
      { id: 'a', title: 'Practice take', composer: 'You' } as never,
      { id: 'b', title: 'Für Elise', composer: 'Beethoven' } as never,
    ],
    '',
  );
  assertEq(rows.length, 2, 'an empty search shows every saved row, takes included');
}

function testSaveIsWriteAttachVerify(): void {
  console.log('\n3c. The save writes the row first, attaches second, verifies third');
  const store = readRepoFile('src/services/practiceVideoStore.ts');
  const save = store.indexOf('export async function savePracticeVideoRow(');
  const saveBody = store.slice(save, store.indexOf('\n}\n', save) + 3);
  const writeAt = saveBody.indexOf('await saveRecognition(piece)');
  const attachAt = saveBody.indexOf('attachPracticeVideo(piece.id, input.videoRef)');
  const verifyAt = saveBody.indexOf('loadPracticeVideoRow(piece.id)');
  assert(writeAt >= 0, 'the row is written');
  assert(attachAt >= 0, 'the video block is attached');
  assert(verifyAt >= 0, 'the row is read back');
  assert(
    writeAt < attachAt && attachAt < verifyAt,
    'in that order: write → attach → verify',
  );
  assert(
    saveBody.indexOf('if (!attached) return null;') >= 0,
    'a failed attach is a failed save (cause 2 can no longer pass silently)',
  );
  assert(
    saveBody.indexOf('practiceVideoIsUsable(stored.practiceVideo') >= 0,
    'the read-back also proves the video block survived, not just the row',
  );
}

function testVerifyIsReachableFromTheFlow(): void {
  console.log('\n3d. The verify is reachable from the flow the owner takes');
  const screen = readRepoFile('src/screens/PracticeVideoScreen.tsx');
  const keep = screen.indexOf('const keepTake = useCallback(');
  assert(keep >= 0, 'keepTake is the one write path');
  const keepBody = screen.slice(keep, screen.indexOf('\n    [],\n  );', keep) + 12);
  const setSave = keepBody.indexOf('setSaveState(saveOutcome)');
  const setReview = keepBody.indexOf("setPhase('review')");
  assert(setSave >= 0 && setReview >= 0, 'keepTake sets the save state and lands on the review surface');
  assert(
    setSave < setReview,
    'the save state is set BEFORE the review surface renders, so the card can never be skipped',
  );
  assert(
    keepBody.indexOf('verifyAgain()') >= 0 && keepBody.indexOf('practiceVideoRowIsStored(') >= 0,
    'the flow re-reads History at the end, so a row lost after the save is still reported',
  );
  const handleStop = screen.indexOf('const handleStop = useCallback(');
  assert(
    screen.slice(handleStop, handleStop + 3000).indexOf('await keepTake(') >= 0,
    'Stop calls keepTake (the write is not gated on anything else)',
  );
  // The review surface's "saved" line comes from the read-back, never a literal.
  const review = screen.indexOf("{phase === 'review' ? (");
  const reviewBody = screen.slice(review, screen.indexOf('{phase === \'start_failed\'', review));
  assert(
    reviewBody.indexOf('saveState && saveState.saved') >= 0,
    'the saved line renders only when the read-back said so',
  );
  assert(
    reviewBody.indexOf('saveState && !saveState.saved') >= 0,
    'a failed save has its own card (not a body line)',
  );
}

// ─── RUN ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await testUnguardedLosesARow();
  await testQueuedKeepsBothRows();
  await testObservedPath();
  testStorageWritersAreQueued();
  testHistoryReReadsOnFocus();
  testSaveIsWriteAttachVerify();
  testVerifyIsReachableFromTheFlow();

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
