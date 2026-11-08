/**
 * v43 item B3 — THE BUILD STAMP IS HONEST AND HAS ONE SHAPE.
 *
 * The stamp exists to answer "am I testing the build I was told to test?", so the
 * only thing that can ruin it is drift: a stray "v", a versionCode dropped, a sha
 * that is not a sha, or an empty line where a number should be.
 */
const assert = require('assert');
import {
  BUILD_STAMP_TAG,
  BUILD_STAMP_UNKNOWN_SHA,
  BUILD_STAMP_UNKNOWN_VERSION,
  buildStampLine,
  buildStampSha,
  buildStampVersion,
  buildStampVersionCode,
} from '../src/services/buildStamp';
import { BUILD_SHA, BUILD_SHA_IS_PLACEHOLDER } from '../src/services/buildSha';

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
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

console.log('\nv43 B1 — the stamp line');
const line = buildStampLine({ version: '0.1.37', versionCode: 43, sha: '37c67ad1234567890' });
assertEq(line, 'NoteSnap 0.1.37 (vc43) · 37c67ad', 'the stamp reads name + version + versionCode + 7-char sha');
assertEq(line.indexOf('0.1.37') >= 0, true, 'the line carries the version');
assertEq(line.indexOf('(vc43)') >= 0, true, 'the line carries the versionCode');
assertEq(/· [0-9a-f]{7}$/.test(line), true, 'the line ends in a 7-character hex sha');
assertEq(/NoteSnap v/.test(line), false, 'NO "v" prefix drift — the version is printed bare');
assertEq(buildStampVersion('v0.1.37'), '0.1.37', 'a caller that passes "v0.1.37" gets the prefix stripped');
assertEq(buildStampVersionCode('43'), '43', 'a string versionCode is accepted');
assertEq(buildStampSha('37C67AD999'), '37c67ad', 'the sha is lowercased and cut to 7');

console.log('\nv43 B1 — a value the build cannot know is never invented');
assertEq(buildStampVersion(null), BUILD_STAMP_UNKNOWN_VERSION, 'an unreadable version says 0.0.0, never a guess');
assertEq(buildStampVersionCode(undefined), '0', 'an unreadable versionCode says 0');
assertEq(buildStampSha('not-a-commit'), BUILD_STAMP_UNKNOWN_SHA, 'a sha that is not a commit says "unknown"');
assertEq(BUILD_STAMP_UNKNOWN_SHA.length, 7, 'the "unknown" sha still occupies the 7-character slot');
assertEq(buildStampLine(null), 'NoteSnap 0.0.0 (vc0) · unknown', 'a missing input still renders one honest line');
assertEq(buildStampLine(undefined).length > 0, true, 'the stamp is never an empty string');

console.log('\nv43 B1 — the stamp identifies the build it is in');
assertEq(BUILD_STAMP_TAG, 'build-stamp', 'the accessibility tag the source scan keys on');
assertEq(BUILD_SHA.length, 7, 'the build-time sha constant is 7 characters');
/**
 * vc52 — THIS ASSERTION WAS BACKWARDS.
 *
 * It used to read `assertEq(BUILD_SHA_IS_PLACEHOLDER, true, 'this build still
 * carries the placeholder…')` — i.e. it went GREEN precisely when the release
 * shipped unstamped, and RED the moment the release slice did the one thing it
 * asks for. vc51 shipped with `0000000` because of it: the owner was told to
 * verify a build whose own stamp could not name the commit.
 *
 * The rule now: the constant must be a real 7-char hex commit, or the seven-zero
 * placeholder — and which one it is gets said out loud, every run. The release
 * slice stamps the real commit before the EAS build; the pure function below
 * still proves an unstamped build is visible at a glance.
 */
assertEq(/^[0-9a-f]{7}$/.test(BUILD_SHA), true, 'the build-time sha is 7 lowercase hex characters (a commit, or the 0000000 placeholder)');
console.log(
  BUILD_SHA_IS_PLACEHOLDER
    ? '  ! this tree is UNSTAMPED (0000000) — the release slice must stamp the real commit before an EAS build'
    : `  · this tree is stamped for release: ${BUILD_SHA}`,
);
assertEq(buildStampLine({ version: '0.1.37', versionCode: 43, sha: '0000000' }).indexOf('· 0000000') >= 0, true, 'an unstamped build is visible at a glance');

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
