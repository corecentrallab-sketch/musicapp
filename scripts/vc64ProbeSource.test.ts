/**
 * vc64ProbeSource.test.ts — D34: THE DECODER PROBE READS THE TAKE'S AUDIO.
 *
 * THE DEFECT (owner's vc63 screenshot, 249 MB take):
 *   read: the first 12.6MB of 249.0MB (the rest is not loaded — this is a capped read)
 *   probe: the decode did not finish — the app did not survive it or the reader never answered.
 *
 * The review page handed the probe `ref?.uri ?? audioUriRef.current` — the CAMERA
 * VIDEO whenever the take had one. A capped prefix of an MP4 has no index for the
 * tail, so the decode could never finish, on any phone, at any memory budget. The
 * probe has reported "cannot decode" for every real take since vc61, which is
 * indistinguishable from a genuine device limit (defect class 20).
 *
 * WHAT THIS SUITE PINS:
 *   • the selector prefers the AUDIO file and returns the video only when there is
 *     no audio copy — the preference itself, not the presence of a URI;
 *   • the card PRINTS which file it read (the sentence that was missing);
 *   • the screen hands the card both files and never one pre-decided URI;
 *   • every one of those is re-run over MUTATED REAL BYTES and required to FAIL
 *     there, including the exact vc63 line.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  pickTakeProbeSource,
  takeProbeFileName,
  takeProbeSourceLine,
} from '../src/services/takeProbeSource';
import { theProbeReadsTheTakeAudio } from '../src/services/vc64ProbeSourceContract';

declare const require: (name: string) => any;
declare const process: { cwd(): string; exit(code: number): void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
let passes = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passes += 1;
    console.log(`  ok  ${label}`);
  } else {
    failures.push(label);
    console.error(`  FAIL ${label}`);
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  assert(same, same ? label : `${label} (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)})`);
}

function readRepoFile(relative: string): string {
  return String(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

const SCREEN = readRepoFile('src/screens/PracticeVideoScreen.tsx');
const CARD = readRepoFile('src/components/TakeDecoderProbeCard.tsx');

const AUDIO = 'file:///data/user/0/com.notesnap.sheetmusic/files/take-1234.m4a';
const VIDEO = 'file:///data/user/0/com.notesnap.sheetmusic/files/take-1234.mp4';

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE PREFERENCE — AUDIO FIRST, THE VIDEO ONLY AS THE FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

function testThePreference(): void {
  console.log('\nTHE PROBE READS THE TAKE\u2019S AUDIO');

  const both = pickTakeProbeSource({ audioUri: AUDIO, videoUri: VIDEO });
  assertEq(both, { kind: 'audio', uri: AUDIO }, 'a take with both files is read from its AUDIO');

  // The video is the fallback and only the fallback.
  assertEq(
    pickTakeProbeSource({ audioUri: null, videoUri: VIDEO }),
    { kind: 'video', uri: VIDEO },
    'a take with no audio copy falls back to the video',
  );
  assertEq(
    pickTakeProbeSource({ audioUri: '', videoUri: VIDEO }),
    { kind: 'video', uri: VIDEO },
    'an empty audio URI is not an audio copy — the video is the fallback',
  );
  assertEq(
    pickTakeProbeSource({ audioUri: '   ', videoUri: VIDEO }),
    { kind: 'video', uri: VIDEO },
    'a blank audio URI is not an audio copy either',
  );
  assertEq(
    pickTakeProbeSource({ audioUri: undefined, videoUri: undefined }),
    null,
    'a take with no file at all selects nothing (the control stays disabled)',
  );
  assertEq(pickTakeProbeSource(null), null, 'no input is not a file');

  // THE ORDER CANNOT DRIFT: over every shape, the video never wins while audio exists.
  const shapes: Array<{ audioUri?: string | null; videoUri?: string | null }> = [
    { audioUri: AUDIO, videoUri: VIDEO },
    { audioUri: ` ${AUDIO} `, videoUri: VIDEO },
    { audioUri: AUDIO, videoUri: null },
    { audioUri: AUDIO },
  ];
  let videoEverWon = false;
  for (const shape of shapes) {
    const picked = pickTakeProbeSource(shape);
    if (!picked || picked.kind !== 'audio' || picked.uri !== AUDIO) videoEverWon = true;
  }
  assert(!videoEverWon, 'the camera video is never read while the take has an audio file');

  // THE CARD SAYS WHICH FILE IT READ.
  assertEq(takeProbeFileName(AUDIO), 'take-1234.m4a', 'the file is named, not the whole URI');
  const audioLine = takeProbeSourceLine(both);
  assert(
    audioLine.indexOf("the take's audio file") >= 0 && audioLine.indexOf('take-1234.m4a') >= 0,
    'the card names the AUDIO file it read',
  );
  const videoLine = takeProbeSourceLine(pickTakeProbeSource({ videoUri: VIDEO }));
  assert(
    videoLine.indexOf('camera video') >= 0 && videoLine.indexOf('no separate audio copy') >= 0,
    'the card says so when it had to fall back to the camera video',
  );
  assert(
    takeProbeSourceLine(null).indexOf('nothing') >= 0,
    'and says there is nothing to read when the take has no file',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE WIRING GUARD, ON THE REAL FILES
// ─────────────────────────────────────────────────────────────────────────────

function testTheGuard(): void {
  console.log('\nTHE SCREEN AND THE CARD ROUTE THE PROBE THROUGH THE AUDIO');

  assert(
    theProbeReadsTheTakeAudio({ screen: SCREEN, card: CARD }),
    'GUARD: the probe is handed both files, reads the audio first, and says which it read',
  );
  // Controls: the guard is reading the real files, not two empty strings.
  assert(SCREEN.indexOf('<TakeDecoderProbeCard') >= 0, 'control: the screen really mounts the probe');
  assert(CARD.indexOf('<WebView') >= 0, 'control: the card really mounts the decoder page');
  assert(
    SCREEN.indexOf('audioUriRef.current') >= 0,
    'control: the screen really holds the take\u2019s audio URI',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE GUARD BITES — MUTATED REAL BYTES
// ─────────────────────────────────────────────────────────────────────────────

function testTheGuardBites(): void {
  console.log('\nTHE GUARD BITES (mutated real source)');

  // (a) THE EXACT vc63 LINE: one pre-decided URI, the video first.
  const vc63 = SCREEN.replace(
    /audioUri=\{audioUriRef\.current\}\s*\n\s*videoUri=\{ref\?\.uri \?\? null\}/,
    'uri={ref?.uri ?? audioUriRef.current}',
  );
  assert(vc63 !== SCREEN, 'the vc63 mutation applied to the real screen');
  assert(
    theProbeReadsTheTakeAudio({ screen: vc63, card: CARD }) === false,
    'GUARD bites: handing the probe `ref?.uri ?? audioUriRef.current` is rejected',
  );

  // (b) THE PROPS SWAPPED: still two props, but the video bound to the audio slot.
  const swapped = SCREEN.replace(
    /audioUri=\{audioUriRef\.current\}(\s*)\n(\s*)videoUri=\{ref\?\.uri \?\? null\}/,
    'audioUri={ref?.uri ?? null}$1\n$2videoUri={audioUriRef.current}',
  );
  assert(swapped !== SCREEN, 'the swapped-props mutation applied to the real screen');
  assert(
    theProbeReadsTheTakeAudio({ screen: swapped, card: CARD }) === false,
    'GUARD bites: binding the VIDEO to the audio prop is rejected',
  );

  // (c) THE CARD'S SELECTOR CALL REVERSED — the preference flipped inside the card.
  const reversed = CARD.replace(
    'pickTakeProbeSource({ audioUri, videoUri })',
    'pickTakeProbeSource({ audioUri: videoUri, videoUri: audioUri })',
  );
  assert(reversed !== CARD, 'the reversed-selector mutation applied to the real card');
  assert(
    theProbeReadsTheTakeAudio({ screen: SCREEN, card: reversed }) === false,
    'GUARD bites: a card that prefers the video is rejected',
  );

  // (d) THE CARD STOPS SAYING WHICH FILE IT READ.
  const silent = CARD.replace(
    'const sourceLine = takeProbeSourceLine(source);',
    'const sourceLine = PROBE_HINT;',
  );
  assert(silent !== CARD, 'the silent-card mutation applied to the real card');
  assert(
    theProbeReadsTheTakeAudio({ screen: SCREEN, card: silent }) === false,
    'GUARD bites: a card that does not name the file it read is rejected',
  );

  // (e) THE CARD TAKES A PRE-DECIDED `uri` PROP AGAIN (the vc63 signature).
  const singleUri = CARD.replace(
    '  videoUri?: string | null;',
    '  uri: string | null | undefined;',
  );
  assert(singleUri !== CARD, 'the single-uri-props mutation applied to the real card');
  assert(
    theProbeReadsTheTakeAudio({ screen: SCREEN, card: singleUri }) === false,
    'GUARD bites: a card that takes one pre-decided URI is rejected',
  );
}

// ─── RUN ────────────────────────────────────────────────────────────────────

function main(): void {
  testThePreference();
  testTheGuard();
  testTheGuardBites();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
