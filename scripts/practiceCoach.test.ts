/**
 * Unit tests for the practice-coach slice 1: scoring + banded feedback copy
 * (src/services/practiceCoach.ts) and local progress persistence
 * (src/services/practiceHistory.ts).
 *
 * Run with: npm run test:tier1
 * Compiles the pure modules + this test to CommonJS and runs under plain Node
 * (same convention as scripts/tier1.test.ts — no test framework, no app runtime).
 *
 * NOTE: no raw percentages are ever shown to users, so the copy assertions
 * check that no "<number>%" leaks into a headline or line.
 */
import {
  scorePlayback,
  buildFeedback,
  scoreAndCoach,
  noteName,
  barOf,
  centsBetween,
  NO_REFERENCE,
  HIT_TOLERANCE_CENTS,
  NEIGHBOR_TOLERANCE_CENTS,
  RHYTHM_TOLERANCE_RATIO,
  type NoteStatus,
  type PerNoteResult,
  type PlaybackScore,
  type ReferenceNote,
  type PlayedNote,
} from '../src/services/practiceCoach';
import {
  PRACTICE_HISTORY_KEY,
  PRACTICE_HISTORY_CAP,
  createMemoryPracticeStorage,
  savePracticeSession,
  getPracticeHistory,
  getBestAccuracy,
  parseHistory,
  appendSession,
  bestAccuracy,
  normalizeSession,
  type PracticeSession,
} from '../src/services/practiceHistory';

declare const process: { exit(code: number): never };
let failures = 0;
let passes = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  const ok = actual === expected;
  if (ok) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}

// ─── helpers ───────────────────────────────────────────────────
function ref(midi: number, startBeat: number, durationBeats = 1): ReferenceNote {
  return { midi, startBeat, durationBeats };
}
function play(midi: number, startBeat: number, durationBeats = 1): PlayedNote {
  return { midi, startBeat, durationBeats };
}
function counts(score: PlaybackScore, status: NoteStatus): number {
  return score.verdicts.filter((v) => v.status === status).length;
}
function verdict(
  refIndex: number,
  status: NoteStatus,
  extra: Partial<PerNoteResult> = {},
): PerNoteResult {
  return { refIndex, playedIndex: status === 'missed' ? null : 0, status, ...extra };
}
function fakeScore(accuracyPct: number, verdicts: PerNoteResult[]): PlaybackScore {
  return { accuracyPct, noteCount: verdicts.length, verdicts };
}
/** Every word we would actually show for a run, joined for regex checks. */
function allCopy(score: PlaybackScore, title?: string): string {
  const fb = buildFeedback(score, title);
  return [fb.headline, ...fb.lines].join(' | ');
}

console.log('\n— noteName: scientific pitch names —');
assertEq(noteName(60), 'C4', 'middle C (60) is C4');
assertEq(noteName(61), 'C#4', '61 is C#4 (sharps only)');
assertEq(noteName(69), 'A4', '69 is A4');
assertEq(noteName(57), 'A3', '57 is A3');
assertEq(noteName(21), 'A0', '21 is A0');
assertEq(noteName(70), 'A#4', '70 is A#4 (the copy example)');
assertEq(noteName(108), 'C8', '108 is C8');
assertEq(noteName(60.4), 'C4', 'fractional MIDI rounds to the nearest name');
assertEq(noteName(NaN), '?', 'non-finite MIDI does not invent a note');
assertEq(noteName(Infinity), '?', 'infinite MIDI does not invent a note');

console.log('\n— barOf: 4/4 bar numbers —');
assertEq(barOf(0), 1, 'beat 0 is bar 1');
assertEq(barOf(3.99), 1, 'beat 3.99 is still bar 1');
assertEq(barOf(4), 2, 'beat 4 starts bar 2');
assertEq(barOf(24), 7, 'beat 24 is bar 7 (the copy example)');
assertEq(barOf(-2), 1, 'negative beats clamp to bar 1');
assertEq(barOf(NaN), 1, 'non-finite beats clamp to bar 1');

console.log('\n— centsBetween —');
assertEq(centsBetween(60, 60), 0, 'same pitch is 0 cents');
assertEq(centsBetween(60, 60.6), 60, '0.6 semitones high is +60 cents');
assertEq(centsBetween(60, 59.4), -60, '0.6 semitones low is -60 cents (negative = flat)');
assertEq(centsBetween(60, 61), 100, 'a whole semitone is 100 cents');

console.log('\n— scorePlayback: clean hit / accuracy —');
const perfect = scorePlayback(
  [ref(60, 0), ref(62, 1), ref(64, 2), ref(65, 3)],
  [play(60, 0), play(62, 1), play(64, 2), play(65, 3)],
);
assertEq(perfect.accuracyPct, 100, 'all notes on pitch and in time scores 100');
assertEq(perfect.noteCount, 4, 'noteCount counts every verdict');
assertEq(perfect.verdicts.length, 4, 'one verdict per written note');
assertEq(perfect.verdicts.map((v) => v.status).join(','), 'hit,hit,hit,hit', 'four hits, in order');
assertEq(perfect.verdicts[0].refIndex, 0, 'refIndex points at the written note');
assertEq(perfect.verdicts[0].playedIndex, 0, 'playedIndex points at the played note');
assertEq(perfect.verdicts[0].centsOff, 0, 'centsOff recorded on a hit');
assertEq(perfect.verdicts[0].refMidi, 60, 'verdict carries the written MIDI for copy');
assertEq(perfect.verdicts[0].refStartBeat, 0, 'verdict carries the written beat for copy');

console.log('\n— scorePlayback: pitch tolerance bands (±35 / ±120 cents) —');
assertEq(HIT_TOLERANCE_CENTS, 35, 'hit tolerance is ±35 cents');
assertEq(NEIGHBOR_TOLERANCE_CENTS, 120, 'neighbour tolerance is ±120 cents');
const justHit = scorePlayback([ref(61, 0)], [play(61.35, 0)]);
assertEq(justHit.verdicts[0].status, 'hit', 'exactly 35 cents off is still a hit');
assertEq(justHit.accuracyPct, 100, 'a 35-cent error is a clean note');
const justFlat = scorePlayback([ref(61, 0)], [play(60.64, 0)]);
assertEq(justFlat.verdicts[0].status, 'flat', 'past 35 cents low is flat');
assertEq(justFlat.verdicts[0].centsOff, -36, 'flat reports negative cents');
assertEq(justFlat.accuracyPct, 50, 'a flat note earns half credit');
const flat = scorePlayback([ref(61, 0)], [play(60.6, 0)]);
assertEq(flat.verdicts[0].status, 'flat', '0.4 semitones low is flat');
const sharp = scorePlayback([ref(61, 0)], [play(61.4, 0)]);
assertEq(sharp.verdicts[0].status, 'sharp', '0.4 semitones high is sharp');
assertEq(sharp.verdicts[0].centsOff, 40, 'sharp reports positive cents');
const edgeNeighbor = scorePlayback([ref(61, 0)], [play(62.2, 0)]);
assertEq(edgeNeighbor.verdicts[0].status, 'sharp', 'exactly 120 cents is still the same note');
const beyondNeighbor = scorePlayback([ref(61, 0)], [play(62.3, 0)]);
assertEq(beyondNeighbor.verdicts[0].status, 'missed', 'past 120 cents is not the same note');
assertEq(counts(beyondNeighbor, 'extra'), 1, 'the too-far note is reported as extra');
assertEq(
  beyondNeighbor.verdicts[0].centsOff,
  undefined,
  'a missed note carries no centsOff (nothing was heard for it)',
);

console.log('\n— scorePlayback: rhythm tolerance (scaled by note length) —');
assertEq(RHYTHM_TOLERANCE_RATIO, 0.35, 'rhythm tolerance is 0.35 x note length');
const inTime = scorePlayback([ref(60, 0, 1)], [play(60, 0.34)]);
assertEq(inTime.verdicts[0].status, 'hit', 'within 0.35 x 1 beat counts as in time');
const longNote = scorePlayback([ref(60, 0, 2)], [play(60, 0.6)]);
assertEq(longNote.verdicts[0].status, 'hit', 'tolerance scales with the written note length');
const lateOut = scorePlayback([ref(60, 0, 1)], [play(60, 0.36)]);
assertEq(lateOut.verdicts[0].status, 'near', 'right pitch, late past the tolerance is near');
assertEq(lateOut.verdicts[0].centsOff, 0, 'near keeps the pitch evidence');
assertEq(lateOut.accuracyPct, 50, 'a near note earns half credit');
assertEq(counts(lateOut, 'extra'), 0, 'a late-but-right note is not an extra');
const earlyOut = scorePlayback([ref(60, 8, 1)], [play(60, 6)]);
assertEq(earlyOut.verdicts[0].status, 'near', 'right pitch played early is also near');
const slightDrift = scorePlayback([ref(60, 0, 1)], [play(60, 0.1)]);
assertEq(slightDrift.verdicts[0].status, 'hit', 'small tempo/timing drift is not penalised');

console.log('\n— scorePlayback: missed / extra —');
const missing = scorePlayback([ref(60, 0, 1), ref(62, 1, 1)], [play(60, 0, 1)]);
assertEq(missing.verdicts[1].status, 'missed', 'a written note with nothing played is missed');
assertEq(missing.verdicts[1].playedIndex, null, 'a missed verdict has no played index');
assertEq(missing.accuracyPct, 50, 'one of two notes missed scores 50');
const extraNote = scorePlayback([ref(60, 0, 1)], [play(60, 0, 1), play(90, 8, 1)]);
assertEq(extraNote.accuracyPct, 100, 'an extra note does not lower the practice score');
assertEq(extraNote.noteCount, 2, 'extras still appear as verdicts');
assertEq(extraNote.verdicts[1].status, 'extra', 'an unplayed written note becomes extra');
assertEq(extraNote.verdicts[1].refIndex, NO_REFERENCE, 'an extra carries NO_REFERENCE');
assertEq(NO_REFERENCE, -1, 'NO_REFERENCE is -1');
assertEq(extraNote.verdicts[1].refStartBeat, undefined, 'an extra has no written beat');

console.log('\n— scorePlayback: greedy, closest-timing alignment —');
const swapped = scorePlayback(
  [ref(60, 0, 2), ref(62, 0.5, 2)],
  [play(60, 0.6, 2), play(62, 0.1, 2)],
);
assertEq(swapped.accuracyPct, 100, 'a swapped-but-close performance still scores as hits');
assertEq(counts(swapped, 'hit'), 2, 'pitch-incompatible pairings are skipped, not forced');
const singlePlay = scorePlayback([ref(60, 0, 1), ref(60, 0, 1)], [play(60, 0, 1)]);
assertEq(counts(singlePlay, 'hit'), 1, 'one played note matches only one written note');
assertEq(counts(singlePlay, 'missed'), 1, 'the other written note is honestly missed');
const interleaved = scorePlayback(
  [ref(64, 0, 1), ref(67, 1, 1), ref(72, 2, 1)],
  [play(64, 0, 1), play(67, 0.8, 1), play(72, 2.3, 1)],
);
assertEq(interleaved.accuracyPct, 100, 'small timing jitter across a phrase stays 100');
const oneLate = scorePlayback(
  [ref(64, 0, 1), ref(67, 1, 1), ref(72, 2, 1)],
  [play(64, 0, 1), play(67, 1, 1), play(72, 3, 1)],
);
assertEq(counts(oneLate, 'near'), 1, 'an isolated rhythm slip is near, not missed');
assertEq(oneLate.accuracyPct, 83, 'two hits + one near rounds to 83');

console.log('\n— scorePlayback: accuracy formula —');
const mixed = scorePlayback(
  [ref(60, 0, 1), ref(62, 1, 1), ref(64, 2, 1), ref(65, 3, 1)],
  [play(60, 0, 1), play(62, 1, 1), play(64.4, 2, 1), play(90, 9, 1)],
);
assertEq(counts(mixed, 'hit'), 2, 'two clean hits');
assertEq(counts(mixed, 'sharp'), 1, 'one sharp note');
assertEq(counts(mixed, 'missed'), 1, 'one missed note');
assertEq(counts(mixed, 'extra'), 1, 'the way-off note is extra, not a miss');
assertEq(mixed.accuracyPct, 63, '(2 hits + 0.5) / 4 notes = 63%');
const thirds = scorePlayback([ref(60, 0, 1), ref(62, 1, 1), ref(64, 2, 1)], [play(60.5, 0, 1)]);
assertEq(thirds.accuracyPct, 17, '(0 hits + 0.5) / 3 notes rounds to 17%');
const emptyRef = scorePlayback([], []);
assertEq(emptyRef.accuracyPct, 0, 'an empty reference scores 0 rather than 100');
assertEq(emptyRef.noteCount, 0, 'an empty reference has no verdicts');
const onlyExtras = scorePlayback([], [play(60, 0, 1)]);
assertEq(onlyExtras.accuracyPct, 0, 'extras alone never score');
assertEq(counts(onlyExtras, 'extra'), 1, 'extras alone are still reported');
const garbage = scorePlayback(
  null as unknown as ReferenceNote[],
  undefined as unknown as PlayedNote[],
);
assertEq(garbage.accuracyPct, 0, 'null inputs do not throw and score 0');
assertEq(garbage.noteCount, 0, 'null inputs produce no verdicts');

console.log('\n— banded feedback copy: bands + no raw percentages —');
const ready = fakeScore(100, [verdict(0, 'hit')]);
assertEq(
  buildFeedback(ready).headline,
  "Beautiful — that's performance-ready.",
  '>=90 headline is the performance-ready band',
);
assert(buildFeedback(ready).lines.length >= 1, '>=90 gives a positive line');
assert(!/\d+\s*%/.test(allCopy(ready)), 'no raw percentage in the top band');
assert(/Für Elise/.test(allCopy(ready, 'Für Elise')), 'piece title is woven into the top band copy');
assert(!/undefined/.test(allCopy(ready)), 'no undefined leaks into the copy');
assertEq(
  buildFeedback(fakeScore(90, [verdict(0, 'hit')])).headline,
  "Beautiful — that's performance-ready.",
  'exactly 90 is the performance-ready band',
);
const close = fakeScore(89, [verdict(0, 'flat', { refMidi: 70, refStartBeat: 0 })]);
assertEq(
  buildFeedback(close).headline,
  'Really close. A few spots to polish.',
  '89 lands in the "really close" band',
);
assertEq(
  buildFeedback(fakeScore(70, [verdict(0, 'flat', { refMidi: 70 })])).headline,
  'Really close. A few spots to polish.',
  'exactly 70 is the "really close" band',
);
const shape = fakeScore(69, [verdict(0, 'missed', { refMidi: 70, refStartBeat: 0 })]);
assertEq(
  buildFeedback(shape).headline,
  "You're getting the shape of it — let's work on the tricky bits.",
  '69 lands in the "getting the shape" band',
);
assertEq(
  buildFeedback(fakeScore(50, [verdict(0, 'missed', { refMidi: 70 })])).headline,
  "You're getting the shape of it — let's work on the tricky bits.",
  'exactly 50 is the "getting the shape" band',
);
const starting = fakeScore(49, [verdict(0, 'missed', { refMidi: 70, refStartBeat: 0 })]);
assertEq(
  buildFeedback(starting).headline,
  'Good work getting through it. Start slow and build up.',
  '49 lands in the start-slow band',
);
assert(
  buildFeedback(starting).lines.length >= 2,
  'the start-slow band opens with a gentle next step before the specifics',
);
assert(!/\d+\s*%/.test(allCopy(starting)), 'no raw percentage in the lower bands either');
assert(!/\d+\s*%/.test(allCopy(close)), 'no raw percentage in the "really close" band');
assertEq(
  buildFeedback(fakeScore(0, [])).headline,
  'Nothing to score yet.',
  'an empty run gets an honest "nothing to score" headline',
);
assertEq(buildFeedback(fakeScore(0, [])).lines.length, 1, 'the empty run gets one line, not a lecture');

console.log('\n— feedback issue lines: specific and musical —');
const flatBar7 = fakeScore(80, [
  verdict(0, 'flat', { refMidi: 70, refStartBeat: 24, playedIndex: 0, centsOff: -40 }),
]);
assertEq(
  buildFeedback(flatBar7).lines[0],
  'The A#4 in bar 7 was flat — slow it down and aim higher.',
  'flat copy names the note and the bar (matches the owner brief)',
);
const sharpBar1 = fakeScore(80, [
  verdict(0, 'sharp', { refMidi: 73, refStartBeat: 0, playedIndex: 0, centsOff: 45 }),
]);
assertEq(
  buildFeedback(sharpBar1).lines[0],
  'The C#5 in bar 1 was sharp — ease off and aim lower.',
  'sharp copy names the note, the bar and the direction',
);
const missedBar3 = fakeScore(60, [verdict(0, 'missed', { refMidi: 65, refStartBeat: 8 })]);
assertEq(
  buildFeedback(missedBar3).lines[0],
  'One note got away in bar 3 — try the left hand alone there.',
  'missed copy is specific and kind',
);
const nearBar2 = fakeScore(75, [
  verdict(0, 'near', { refMidi: 60, refStartBeat: 4, playedIndex: 1, centsOff: 0 }),
]);
assertEq(
  buildFeedback(nearBar2).lines[0],
  'The C4 in bar 2 came in at the wrong moment — count it in before you play it.',
  'a rhythm slip is described as timing, not as a wrong note',
);
const extraOnly = fakeScore(75, [
  verdict(0, 'hit', { refMidi: 60, refStartBeat: 0 }),
  verdict(NO_REFERENCE, 'extra', { playedIndex: 1 }),
]);
assert(
  buildFeedback(extraOnly).lines.some((l) => /crept in/.test(l)),
  'extra notes get their own line (no fabricated bar)',
);
const manyIssues = fakeScore(40, [
  verdict(0, 'missed', { refMidi: 60, refStartBeat: 0 }),
  verdict(1, 'flat', { refMidi: 62, refStartBeat: 4, playedIndex: 1 }),
  verdict(2, 'sharp', { refMidi: 64, refStartBeat: 8, playedIndex: 2 }),
  verdict(3, 'near', { refMidi: 65, refStartBeat: 12, playedIndex: 3 }),
  verdict(4, 'missed', { refMidi: 67, refStartBeat: 16 }),
]);
assertEq(
  buildFeedback(fakeScore(80, manyIssues.verdicts)).lines.length,
  3,
  'at most three issue lines are shown',
);
assertEq(manyIssues.verdicts.length, 5, 'the score itself still reports every verdict');
assert(
  buildFeedback(fakeScore(40, manyIssues.verdicts)).lines.length <= 4,
  'the start-slow band adds one gentle opener on top of the three specifics',
);
const repeatedBar = fakeScore(60, [
  verdict(0, 'flat', { refMidi: 60, refStartBeat: 4, playedIndex: 0 }),
  verdict(1, 'flat', { refMidi: 62, refStartBeat: 4.5, playedIndex: 1 }),
  verdict(2, 'missed', { refMidi: 64, refStartBeat: 5 }),
  verdict(3, 'sharp', { refMidi: 65, refStartBeat: 20, playedIndex: 3 }),
]);
const repeatedLines = buildFeedback(repeatedBar).lines;
assertEq(repeatedLines.length, 2, 'issues in one bar collapse to a single line, plus the next bar');
assertEq(
  (repeatedLines[0].match(/bar 2/g) ?? []).length,
  1,
  'the most common bar is mentioned once, not three times',
);
assert(/bar 2/.test(repeatedLines[0]), 'the bar with the most issues is called out first');
assert(/bar 6/.test(repeatedLines[1]), 'the next distinct bar follows');
const singleBar = fakeScore(60, [
  verdict(0, 'flat', { refMidi: 60, refStartBeat: 4, playedIndex: 0 }),
  verdict(1, 'flat', { refMidi: 62, refStartBeat: 4.5, playedIndex: 1 }),
  verdict(2, 'missed', { refMidi: 64, refStartBeat: 5 }),
]);
assertEq(
  buildFeedback(singleBar).lines.length,
  1,
  'one troubled bar produces exactly one line (never a repeated complaint)',
);
assert(
  buildFeedback(fakeScore(20, [verdict(0, 'hit', { refMidi: 60 })])).lines.length >= 1,
  'the start-slow band still says something useful with nothing specific to fix',
);
assert(/slow/.test(allCopy(starting)), 'the start-slow band tells the user how to practise');

console.log('\n— scoreAndCoach convenience wrapper —');
const coached = scoreAndCoach([ref(60, 0, 1)], [play(60, 0, 1)], 'Test Piece');
assertEq(coached.score.accuracyPct, 100, 'scoreAndCoach returns the score');
assertEq(
  coached.feedback.headline,
  "Beautiful — that's performance-ready.",
  'scoreAndCoach returns the matching feedback band',
);
assert(
  /Test Piece/.test(coached.feedback.lines.join(' ')),
  'scoreAndCoach passes the piece title through',
);
const coachedReal = scoreAndCoach([ref(60, 0, 1), ref(62, 1, 1)], [play(60, 0, 1)]);
assertEq(coachedReal.score.accuracyPct, 50, 'scoreAndCoach scores a partial run');
assertEq(
  coachedReal.feedback.headline,
  "You're getting the shape of it — let's work on the tricky bits.",
  'scoreAndCoach bands a partial run correctly',
);

console.log('\n— practice history: save / read / best —');
async function historyTests(): Promise<void> {
  const store = createMemoryPracticeStorage();
  assertEq(
    PRACTICE_HISTORY_KEY,
    'notesnap:practice:history:v1',
    'history key is versioned as specified',
  );
  assertEq(PRACTICE_HISTORY_CAP, 200, 'history is capped at 200 sessions');

  const saved = await savePracticeSession(
    {
      pieceId: 'fur-elise',
      accuracyPct: 62.4,
      durationSec: 91.6,
      playedAt: '2026-09-01T10:00:00.000Z',
    },
    store,
  );
  assert(saved !== null, 'a valid session is saved');
  assertEq(saved?.accuracyPct, 62, 'accuracy is rounded to a whole number on save');
  assertEq(saved?.durationSec, 92, 'duration is rounded to whole seconds');
  assertEq(saved?.playedAt, '2026-09-01T10:00:00.000Z', 'an explicit playedAt is preserved');
  assert((await store.getItem(PRACTICE_HISTORY_KEY)) !== null, 'history lands under the versioned key');

  await savePracticeSession(
    { pieceId: 'fur-elise', accuracyPct: 88, durationSec: 100, playedAt: '2026-09-02T10:00:00.000Z' },
    store,
  );
  await savePracticeSession(
    { pieceId: 'moonlight-1', accuracyPct: 45, durationSec: 60, playedAt: '2026-09-03T10:00:00.000Z' },
    store,
  );

  const all = await getPracticeHistory(null, store);
  assertEq(all.length, 3, 'all three sessions are stored');
  assertEq(all[0].playedAt, '2026-09-03T10:00:00.000Z', 'history is newest first');
  assertEq(all[2].playedAt, '2026-09-01T10:00:00.000Z', 'oldest session is last');

  const forPiece = await getPracticeHistory('fur-elise', store);
  assertEq(forPiece.length, 2, 'history can be filtered to one piece');
  assertEq(forPiece[0].playedAt, '2026-09-02T10:00:00.000Z', 'filtered history is newest first too');
  assertEq((await getPracticeHistory('unknown-piece', store)).length, 0, 'unknown piece has no history');

  assertEq(await getBestAccuracy('fur-elise', store), 88, 'best accuracy returns the highest run');
  assertEq(await getBestAccuracy('moonlight-1', store), 45, 'best accuracy works for a single run');
  assertEq(await getBestAccuracy('unknown-piece', store), null, 'best accuracy is null with no history');

  const rejected = await savePracticeSession(
    { pieceId: '   ', accuracyPct: 50, durationSec: 10 },
    store,
  );
  assertEq(rejected, null, 'a session with no pieceId is not stored');
  assertEq((await getPracticeHistory(null, store)).length, 3, 'the rejected save left history untouched');

  const clamped = await savePracticeSession(
    { pieceId: 'fur-elise', accuracyPct: 101, durationSec: -4 },
    store,
  );
  assert(typeof clamped?.playedAt === 'string' && clamped.playedAt.length > 0, 'a missing playedAt defaults to now');
  assertEq(clamped?.accuracyPct, 100, 'out-of-range accuracy is clamped to 100');
  assertEq(clamped?.durationSec, 0, 'a negative duration is clamped to 0');

  // Cap: the oldest sessions drop off first.
  const cappedStore = createMemoryPracticeStorage();
  const stamp = '2026-01-01T00:00:00.000Z';
  for (let i = 0; i < PRACTICE_HISTORY_CAP + 5; i++) {
    await savePracticeSession(
      { pieceId: 'etude', accuracyPct: i % 101, durationSec: 30, playedAt: stamp },
      cappedStore,
    );
  }
  const capped = await getPracticeHistory(null, cappedStore);
  assertEq(capped.length, PRACTICE_HISTORY_CAP, 'history never grows past the 200-session cap');
  assertEq(capped[0].accuracyPct, 2, 'the newest session survives capping (i = 204 -> 204 % 101)');
  assertEq(capped[capped.length - 1].accuracyPct, 5, 'the oldest surviving session is i = 5');
  assertEq(
    capped.filter((s) => s.accuracyPct === 0).length,
    2,
    'only the oldest sessions were dropped (i = 101 and i = 202 score 0)',
  );

  // Newest-first follows save order, not the playedAt strings.
  const outOfOrder = createMemoryPracticeStorage();
  await savePracticeSession(
    { pieceId: 'p', accuracyPct: 10, durationSec: 5, playedAt: '2026-09-09T00:00:00.000Z' },
    outOfOrder,
  );
  await savePracticeSession(
    { pieceId: 'p', accuracyPct: 20, durationSec: 5, playedAt: '2026-09-01T00:00:00.000Z' },
    outOfOrder,
  );
  assertEq(
    (await getPracticeHistory('p', outOfOrder))[0].accuracyPct,
    20,
    'ordering follows save order, not the timestamp string',
  );

  // Malformed / future storage shapes never throw.
  assertEq(parseHistory('not json at all').length, 0, 'malformed storage degrades to empty');
  assertEq(parseHistory(null).length, 0, 'null storage degrades to empty');
  assertEq(parseHistory('{}').length, 0, 'an object without sessions degrades to empty');
  assertEq(
    parseHistory('{"sessions":[{"pieceId":"p","accuracyPct":50,"durationSec":10,"playedAt":"x"}]}')
      .length,
    1,
    'a {sessions:[...]} envelope is tolerated',
  );
  assertEq(
    parseHistory('[{"pieceId":"p"},{"accuracyPct":50,"durationSec":10,"playedAt":"x"}]').length,
    0,
    'incomplete records are dropped',
  );
  const badStore = createMemoryPracticeStorage({ [PRACTICE_HISTORY_KEY]: '{{{' });
  assertEq((await getPracticeHistory(null, badStore)).length, 0, 'a corrupt blob reads as no history');
  await savePracticeSession({ pieceId: 'p', accuracyPct: 70, durationSec: 20 }, badStore);
  assertEq(
    (await getPracticeHistory(null, badStore)).length,
    1,
    'a session can still be saved over a corrupt blob',
  );

  // Pure helpers used directly.
  const base: PracticeSession[] = [
    { pieceId: 'p', accuracyPct: 40, durationSec: 10, playedAt: 'a' },
    { pieceId: 'p', accuracyPct: 90, durationSec: 10, playedAt: 'b' },
  ];
  assertEq(bestAccuracy(base, 'p'), 90, 'bestAccuracy picks the highest run');
  assertEq(bestAccuracy(base, 'q'), null, 'bestAccuracy is null for an unpractised piece');
  assertEq(bestAccuracy([], 'p'), null, 'bestAccuracy on an empty history is null');
  assertEq(appendSession([], base[0]).length, 1, 'appendSession adds to an empty history');
  assertEq(appendSession(base, base[0])[2].accuracyPct, 40, 'appendSession keeps order');
  const overflow = appendSession(
    Array.from({ length: PRACTICE_HISTORY_CAP }, () => base[0]),
    { pieceId: 'p', accuracyPct: 99, durationSec: 1, playedAt: 'c' },
  );
  assertEq(overflow.length, PRACTICE_HISTORY_CAP, 'appendSession enforces the cap');
  assertEq(overflow[overflow.length - 1].accuracyPct, 99, 'the new session survives capping');
  const normalized = normalizeSession({ pieceId: ' p ', accuracyPct: 50.4, durationSec: 5.6 });
  assertEq(normalized?.accuracyPct, 50, 'normalizeSession rounds accuracy');
  assertEq(normalized?.durationSec, 6, 'normalizeSession rounds duration');
  assertEq(normalized?.pieceId, 'p', 'normalizeSession trims the pieceId');
  assertEq(
    normalizeSession(null as unknown as { pieceId?: unknown }),
    null,
    'normalizeSession rejects null',
  );
  assertEq(normalizeSession({ pieceId: '' }), null, 'normalizeSession rejects an empty pieceId');

  // The in-memory fallback exists so pure callers never crash (it is NOT persistent).
  await savePracticeSession({ pieceId: 'fallback', accuracyPct: 30, durationSec: 5 });
  assertEq(
    (await getPracticeHistory('fallback')).length,
    1,
    'calling without a storage adapter uses the documented in-memory fallback',
  );

  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

historyTests().catch((err) => {
  failures++;
  console.error('  ✗ FAILED: history tests threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
});
