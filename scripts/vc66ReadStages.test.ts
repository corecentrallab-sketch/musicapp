/**
 * vc66 GUARDS (F4/F5/F6) — THE READ'S OWN NUMBERS AND THE READ'S OWN WORDS.
 *
 * The owner's v65 pass, three failures on the practice-video read:
 *
 *   F4  the result card printed `pitch=0ms@server` against a server that had just
 *       measured `pitch=4283ms`. The stage was recorded from `Date.now()` around
 *       the assignment of the server's frames — the phone's own ~0 ms of work,
 *       labelled `@server`. It told the owner the fast path was not working.
 *   F5  the card printed "this read covered 180s of audio" on a three-minute take.
 *       180 s is the TAKE's length, not what the read produced notes for — the read
 *       stops at the payload cap, so the number was the one fact the read had not
 *       measured.
 *   F6  the step line ("Decoding the audio", "Finding the notes") was drawn in
 *       `styles.meta` — the small grey caption size — so the one line that tells the
 *       user the read is alive was the least legible thing on the screen.
 *
 * THE RULES PINNED HERE:
 *   • on the server path the `pitch` stage carries the SERVER's span; when the
 *     server sent no span the stage is NOT recorded and prints `?@server` — a zero
 *     is never invented, because a zero is a measurement the phone did not make;
 *   • coverage is measured from the notes the read actually produced, and a take
 *     the notes stop short of is said in plain words, on the card AND beside the
 *     notation;
 *   • the step line is drawn in its own style, not the caption size.
 */
import {
  createStageRecorder,
  finishReadTiming,
  pitchStageMs,
  readTimingsAudioLine,
  readTimingsLine,
  takeCoverageLine,
  takeReadCoverage,
  type TakeReadTiming,
} from '../src/services/takeReadTimings';

// The tier1 tsconfig compiles with `types: []`, so there are no Node typings —
// same convention as the repo's other source-scan suites.
declare const require: (name: string) => any;
declare const process: { cwd(): string; exit(code: number): void };
declare const console: { log(...args: unknown[]): void };

const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const root = process.cwd();
function read(rel: string): string {
  return String(fs.readFileSync(path.join(root, rel), 'utf8'));
}
/** Code only: a guard that matches its own explanatory comment guards nothing. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('vc66/F4 (1/3) — THE PITCH STAGE CARRIES THE SERVER\'S OWN SPAN');
// ─────────────────────────────────────────────────────────────────────────────

// The owner's screenshot, as numbers: the server measured 4283 ms, the phone spent
// 3 ms handing the frames over.
const serverPitch = pitchStageMs({ pitchSource: 'server', serverPitchMs: 4283, deviceMs: 3 });
ok(
  'on the server path the stage is the server\'s span, not the phone\'s',
  serverPitch === 4283,
  `got ${serverPitch} (4283 expected, 3 or 0 is the defect)`,
);
// MUTATION: fall back to the device span when the server sent none — this fails, and
// a server answer without spans prints the phone's ~0 ms under an @server label.
const noServerSpan = pitchStageMs({ pitchSource: 'server', serverPitchMs: null, deviceMs: 3 });
ok(
  'a server answer without a span records NOTHING (prints ?@server, never 0)',
  noServerSpan === null,
  `got ${noServerSpan}`,
);
ok(
  'the device path still records its own measured pass',
  pitchStageMs({ pitchSource: 'device', serverPitchMs: null, deviceMs: 1900 }) === 1900,
);
ok(
  'a junk span is not a measurement',
  pitchStageMs({ pitchSource: 'device', serverPitchMs: null, deviceMs: -4 }) === null &&
    pitchStageMs({ pitchSource: 'server', serverPitchMs: Number.NaN, deviceMs: 3 }) === null,
);

// The line itself, assembled the way the screen assembles it.
const serverRead: TakeReadTiming = {
  at: '2026-11-24T00:00:00.000Z',
  audioSec: 180,
  coveredSec: 61.7,
  stages: { upload: 2600, clientDecode: 180, pitch: 4283, build: 220 },
  totalMs: 7400,
  pitchSource: 'server',
  server: { decodeMs: 610, pitchMs: 4283, totalMs: 5000 },
  network: null,
};
const serverLine = readTimingsLine(serverRead);
ok(
  'the line prints the server\'s pitch span',
  serverLine.indexOf('pitch=4283ms@server') >= 0,
  serverLine,
);
ok('the line never prints 0ms@server', serverLine.indexOf('0ms@server') < 0, serverLine);

// A server answer with no spans: the stage is absent, and absent prints `?`.
const unmeasuredRead: TakeReadTiming = {
  at: '2026-11-24T00:00:00.000Z',
  audioSec: 180,
  coveredSec: 61.7,
  stages: { upload: 2600, build: 220 },
  totalMs: 3000,
  pitchSource: 'server',
  server: null,
  network: null,
};
ok(
  'an unmeasured pitch stage prints ?@server, not a zero',
  readTimingsLine(unmeasuredRead).indexOf('pitch=?@server') >= 0,
  readTimingsLine(unmeasuredRead),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('vc66/F5 (2/3) — THE CARD SAYS WHAT THE READ COVERED, NOT HOW LONG THE TAKE IS');
// ─────────────────────────────────────────────────────────────────────────────

// A three-minute take whose notes stop at 61.7 s (the payload cap).
const coverage = takeReadCoverage({
  notes: [
    { startSec: 0.5, durationSec: 0.4 },
    { startSec: 60.9, durationSec: 0.8 },
  ],
  audioSec: 180,
});
ok(
  'coverage is the end of the last note the read produced',
  coverage.coveredSec !== null && Math.abs(coverage.coveredSec - 61.7) < 0.001,
  `got ${coverage.coveredSec}`,
);
ok('the take\'s own length is carried beside it', coverage.audioSec === 180);
ok(
  'a take with no notes has no coverage (never 0, never the take length)',
  takeReadCoverage({ notes: [], audioSec: 180 }).coveredSec === null,
);

// MUTATION: print the take's length as the coverage (the vc61 line) — this fails.
// (This assertion used to forbid the substring "180" outright, which contradicted the
// next one — the line has to NAME the take to say the notes stopped short of it. It
// now pins the two facts that matter: the covered span is 62 s, and the take's own
// length is not printed as the coverage.)
const audioLine = readTimingsAudioLine(serverRead);
ok(
  'the card says the read covered ~62s, not the 180s take',
  audioLine !== null && /covered the first 62s/.test(audioLine) && !/covered 180s/.test(audioLine),
  String(audioLine),
);
ok(
  'the card names the take when the read stopped short of it',
  audioLine !== null && /of a 180s take/i.test(audioLine),
  String(audioLine),
);
ok(
  'a read that covered the whole take says so without a shortfall',
  readTimingsAudioLine({
    at: '',
    audioSec: 30,
    coveredSec: 29.8,
    stages: {},
    totalMs: null,
  }) === 'this read covered 30s of audio',
  String(
    readTimingsAudioLine({ at: '', audioSec: 30, coveredSec: 29.8, stages: {}, totalMs: null }),
  ),
);
ok(
  'no coverage and no length prints nothing rather than a guess',
  readTimingsAudioLine({ at: '', audioSec: null, coveredSec: null, stages: {}, totalMs: null }) ===
    null,
);

// The plain-words line beside the notation (the owner: "then it plainly needs to say
// so for the user").
const shortLine = takeCoverageLine({ audioSec: 180, coveredSec: 61.7 });
ok(
  'the notation screen says the notes stop short, in plain words',
  shortLine !== null &&
    /first 62 seconds/i.test(shortLine) &&
    /180/.test(shortLine) &&
    /60-second/i.test(shortLine),
  String(shortLine),
);
ok(
  'a take the notes cover is not given a shortfall line',
  takeCoverageLine({ audioSec: 30, coveredSec: 29.8 }) === null,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('vc66/F4+F5+F6 (3/3) — THE WIRING');
// ─────────────────────────────────────────────────────────────────────────────

const pipelineSrc = code(read('src/services/captureMidiExport.ts'));
const screenSrc = code(read('src/screens/PracticeVideoScreen.tsx'));

// MUTATION: restore `deps.onStage?.('pitch', Date.now() - pitchStartedAt)` — this
// fails, and the server path goes back to reporting the phone's ~0 ms.
ok(
  'the read pipeline asks the rule which span the pitch stage carries',
  pipelineSrc.indexOf('pitchStageMs(') >= 0,
  'captureMidiExport does not use pitchStageMs',
);
ok(
  'the unconditional device-span recording is gone',
  pipelineSrc.indexOf("deps.onStage?.('pitch', Date.now() - pitchStartedAt)") < 0,
  'the old pitch stage recording is still there',
);

// MUTATION: drop `coveredSec` from the timing the screen records — this fails, and
// the card falls back to printing the take's length.
ok(
  'the screen records the coverage it measured',
  (screenSrc.match(/coveredSec:/g) || []).length >= 2,
  'PracticeVideoScreen does not pass coveredSec into the timing',
);
ok(
  'the notation screen carries the shortfall line',
  screenSrc.indexOf('takeCoverageLine(') >= 0,
);
// MUTATION: put the step line back in `styles.meta` — this fails, and the only line
// that says the read is alive is drawn at caption size again.
ok(
  'the step line has its own, legible style',
  screenSrc.indexOf('styles.readStep') >= 0 &&
    screenSrc.indexOf('<Text style={styles.meta}>{readStepLine(readStep)}</Text>') < 0,
  'the read step line is still drawn at caption size',
);

// The recorder the screen uses must still drop a stage it was not given, so the
// `null` above really does print `?` rather than `0`.
const recorder = createStageRecorder();
const pitch = pitchStageMs({ pitchSource: 'server', serverPitchMs: null, deviceMs: 3 });
if (pitch !== null) recorder.record('pitch', pitch);
const assembled = finishReadTiming({ stages: recorder.stages, totalMs: 3000, audioSec: 180 });
ok(
  'an unmeasured server pitch never reaches the recorded stages as 0',
  assembled.stages.pitch === undefined,
  `got ${assembled.stages.pitch}`,
);

if (failures > 0) {
  console.log(`\nvc66ReadStages: ${failures} FAILED`);
  process.exit(1);
}
console.log('\nvc66ReadStages: all passed');
