/**
 * vc55DeviceFixContract.ts — THE OWNER'S RED ROWS FROM THE vc54 HANDSET PASS,
 * PINNED (vc55, 2026-11-11).
 *
 * The owner tested vc54 on the handset. A5 (the take saves) and the notes lane
 * PASSED. These are the rows that came back red or with a "needs fix" note:
 *
 *   N5  an empty take must say NO MELODY WAS HEARD, not "notes outside the window"
 *   N6  an empty take must not be a dead end — it offers the camera-off take
 *   F2  fullscreen must say it is PREPARING (the owner waited 15–20 s on black)
 *   D22 the empty-take sentence named the WRONG RECORDING (the camera's sound)
 *   About NoteSnap box was "unnecessarily large"
 *
 * Each predicate below is a guard the gate runs against the REAL source text, and
 * each one is proven to bite in `scripts/vc55DeviceFixes.test.ts` by mutating that
 * text in memory and re-running the same predicate. The pure halves (the sentence
 * rule, the preparing state machine, the card's height) are imported from their
 * own services so the guard and the shipped behaviour cannot drift.
 */
import {
  VIDEO_NO_MELODY_LINE,
  VIDEO_NOTES_OUTSIDE_LINE,
  emptyLaneNeedsAnAction,
  noteCuesForVideo,
  videoCueEmptyLine,
  type VideoCueSet,
} from './videoTakeSync';
import type { SavedCaptureTake } from './midiExport';

export const VC55_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';
export const VC55_FULLSCREEN_PATH = 'src/components/FullScreenVideo.tsx';
export const VC55_SETTINGS_PATH = 'src/screens/SettingsScreen.tsx';
export const VC55_SYNC_MODEL_PATH = 'src/services/videoTakeSync.ts';
export const VC55_PREP_MODEL_PATH = 'src/services/videoFullScreenPrep.ts';
export const VC55_ABOUT_LAYOUT_PATH = 'src/services/aboutCardLayout.ts';

function take(notes: Array<{ midi: number; startSec: number; durationSec: number }>): SavedCaptureTake {
  return { notes } as unknown as SavedCaptureTake;
}

/**
 * ── N5 ── A TAKE WITH NO NOTES AT ALL SAYS SO, IN ITS OWN WORDS.
 *
 * The defect was a silent fall-through: a note-less take produced `null` from the
 * sentence function, so the LANE's own fixed line ("no readable melody") — or, on
 * a take whose notes were all dropped, the outside-the-window line — was what the
 * owner read. The two empty cases must never share a sentence.
 */
export function aNoteLessTakeSaysNoMelodyWasHeard(): boolean {
  const silence = noteCuesForVideo(take([]), { audioOffsetMs: 0, videoDurationSec: 42 });
  const line: string | null = videoCueEmptyLine(silence);
  if (line !== VIDEO_NO_MELODY_LINE) return false;
  // The two sentences are different facts and must stay different text.
  const noMelody: string = VIDEO_NO_MELODY_LINE;
  const outside: string = VIDEO_NOTES_OUTSIDE_LINE;
  if (noMelody === outside) return false;
  // …and the empty lane still owes the user an action (N6's rule, same cue set).
  return emptyLaneNeedsAnAction(silence) === true;
}

/**
 * ── N5, the other half ── A TAKE THAT HOLDS NOTES BUT NONE ON THIS VIDEO KEEPS
 * ITS OWN SENTENCE. This is the legitimate case and must survive the fix.
 */
export function aTakeWithDroppedNotesStillSaysTheyAreOutside(): boolean {
  // A 30 s video, a take whose only note starts at 90 s: the note exists and is
  // dropped, which is a different fact from "no melody was heard".
  const outside = noteCuesForVideo(take([{ midi: 60, startSec: 90, durationSec: 1 }]), {
    audioOffsetMs: 0,
    videoDurationSec: 30,
  });
  if (outside.totalCount !== 1 || outside.cues.length !== 0) return false;
  if (videoCueEmptyLine(outside) !== VIDEO_NOTES_OUTSIDE_LINE) return false;
  return videoCueEmptyLine(outside) !== VIDEO_NO_MELODY_LINE;
}

/**
 * ── N5, third case ── AN UNKNOWN VIDEO LENGTH IS NEVER A REASON. A take of three
 * notes on a video whose stored length is 0 keeps all three cues, so the surface
 * has nothing to apologise for and no sentence to show.
 */
export function anUnknownVideoLengthIsNeverTheReason(): boolean {
  const known = take([
    { midi: 60, startSec: 0.5, durationSec: 0.5 },
    { midi: 62, startSec: 1.5, durationSec: 0.5 },
    { midi: 64, startSec: 2.5, durationSec: 0.5 },
  ]);
  const set: VideoCueSet = noteCuesForVideo(known, { audioOffsetMs: 0, videoDurationSec: 0 });
  return set.cues.length === 3 && videoCueEmptyLine(set) === null && set.timelineSec > 0;
}

/**
 * ── D22 ── NO SURFACE BLAMES THE CAMERA FOR NOTES IT DID NOT PRODUCE.
 *
 * The notes come from the app's own `.m4a` recorder (`audioCacheUri`), never from
 * the camera's soundtrack. The shipped sentence said "the sound the camera
 * recorded" — a wrong cause, stated confidently. Comments are masked first, so a
 * note EXPLAINING the old wording is not an offence: only real copy is checked.
 */
export function noCopyBlamesTheCameraForTheNotes(modelSource: string): boolean {
  const src = maskComments(modelSource);
  if (src.length < 2000) return false;
  if (/the sound the camera recorded/i.test(src)) return false;
  if (/notes? (come|comes) from the camera/i.test(src)) return false;
  if (/camera'?s microphone[^.]{0,60}(notes|melody)/i.test(src)) return false;
  // …and the sentence that replaced it names the take's own recording.
  return /audio it recorded for this take/i.test(src);
}

/**
 * ── N6 ── AN EMPTY LANE OFFERS A REAL ACTION, ON BOTH SURFACES.
 *
 * The watch page used to end in a sentence with nowhere to go. The action must be
 * the camera-off take (`recordNotesOnTheirOwn`, which calls the SAME
 * `recordSeparateTake` the review page uses) and it must be a real control, not a
 * label: a `<TouchableOpacity>` carrying the CTA.
 */
export function anEmptyLaneOffersTheCameraOffTake(screenSource: string): boolean {
  const src = screenSource;
  if (src.length < 20000) return false;
  // The callback exists and really records a camera-off take.
  const def = src.indexOf('const recordNotesOnTheirOwn = useCallback(');
  if (def < 0) return false;
  const body = src.slice(def, def + 900);
  if (body.indexOf('await recordSeparateTake();') < 0) return false;
  // The watch page's empty-lane block: gated on the cue set, a real control, the
  // CTA, and the honest line about where those notes are saved.
  const gate = src.indexOf('emptyLaneNeedsAnAction(cueSet)');
  if (gate < 0) return false;
  const block = src.slice(gate, gate + 1200);
  if (block.indexOf('<TouchableOpacity') < 0) return false;
  if (block.indexOf('onPress={() => void recordNotesOnTheirOwn()}') < 0) return false;
  if (block.indexOf('{VIDEO_TAKE_ON_ITS_OWN_CTA}') < 0) return false;
  if (block.indexOf('{VIDEO_NOTES_ON_ITS_OWN_NEW_TAKE_LINE}') < 0) return false;
  // The review page covers a take that exists but holds NO NOTES — the other
  // dead end the owner hit ("x3 takes, same message, no way forward").
  if (src.indexOf('(!take || take.notes.length === 0) && !takeBusy') < 0) return false;
  return src.indexOf('onPress={() => void recordNotesOnTheirOwn()}') >= 0;
}

/**
 * ── F2 ── THE FULL-SCREEN WINDOW SAYS IT IS PREPARING, AND ITS PLAY CONTROL IS
 * NOT TAPPABLE-BUT-DEAD WHILE IT WAITS.
 */
export function fullScreenSaysItIsPreparing(componentSource: string): boolean {
  const src = componentSource;
  if (src.length < 3000) return false;
  if (src.indexOf('fullScreenIsPreparing(prep)') < 0) return false;
  if (src.indexOf('<ActivityIndicator') < 0) return false;
  if (src.indexOf('{FULL_SCREEN_PREPARING_LINE}') < 0) return false;
  // The identifier, not a spelling of the JSX around it: the shipped button
  // reads `fullScreenIsPreparing(prep) ? FULL_SCREEN_PREPARING_CTA : …`, so a
  // guard demanding `{FULL_SCREEN_PREPARING_CTA}` rejected the real file.
  if (src.indexOf('FULL_SCREEN_PREPARING_CTA') < 0) return false;
  // The wait ENDS on the player's own word — the file loaded, or the first frame
  // is on screen. Not on a timer, which would be a guess.
  if (src.indexOf("reportPrep('ready')") < 0) return false;
  if (src.indexOf('onReadyForDisplay={handleReadyForDisplay}') < 0) return false;
  if (src.indexOf('onLoad={handleLoad}') < 0) return false;
  // …and the Play control refuses while it is preparing.
  return src.indexOf('disabled={!uri || busy || !fullScreenCanPlay(prep)}') >= 0;
}

/**
 * ── ABOUT ── THE CARD IS BUILT FROM THE SMALL GEOMETRY, AND NOTHING ELSE MOVED.
 *
 * The screen's About card must pass `compact` to its row, and its three style
 * blocks must read the numbers in services/aboutCardLayout — so the card the
 * owner sees and the height the gate computes are the same geometry.
 */
export function aboutCardIsSmaller(settingsSource: string): boolean {
  const src = settingsSource;
  if (src.length < 20000) return false;
  // The About row itself is the compact one.
  if (!/title="About NoteSnap"[\s\S]{0,240}compact\b/.test(src)) return false;
  // …and the compact row style is only ever reached through the `compact` prop,
  // so no other row can wear it. The About card uses it on BOTH of its rows, so
  // counting occurrences (it demanded exactly one) rejected the real file.
  const compactUses = src.split('styles.aboutRowCompact').length - 1;
  if (compactUses < 1) return false;
  for (const line of src.split('\n')) {
    if (line.indexOf('styles.aboutRowCompact') < 0) continue;
    if (line.indexOf('compact &&') < 0) return false;
  }
  const row = styleBlock(src, 'aboutRowCompact');
  if (row === null) return false;
  if (row.indexOf('minHeight: ABOUT_ROW_MIN_HEIGHT') < 0) return false;
  if (row.indexOf('paddingVertical: ABOUT_ROW_PADDING_V') < 0) return false;
  const tail = styleBlock(src, 'aboutTail');
  if (tail === null) return false;
  if (tail.indexOf('paddingVertical: ABOUT_CARD_PADDING_V') < 0) return false;
  if (tail.indexOf('marginTop: ABOUT_CARD_MARGIN_TOP') < 0) return false;
  const stamp = styleBlock(src, 'buildStamp');
  if (stamp === null) return false;
  if (stamp.indexOf('fontSize: ABOUT_STAMP_FONT_SIZE') < 0) return false;
  return stamp.indexOf('lineHeight: ABOUT_STAMP_LINE_HEIGHT') >= 0;
}

/** The text of one `name: { … }` block in a StyleSheet, or null. */
function styleBlock(src: string, name: string): string | null {
  const at = src.indexOf(`${name}: {`);
  if (at < 0) return null;
  const end = src.indexOf('}', at);
  if (end < 0) return null;
  return src.slice(at, end + 1);
}

/** Comments masked out, so prose about a defect is never read as the defect. */
function maskComments(source: string): string {
  return String(source ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}
