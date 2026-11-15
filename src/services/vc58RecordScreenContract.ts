/**
 * vc58RecordScreenContract.ts — THE RECORD SCREEN'S COPY, AND WHERE THE STOP SITS
 * (vc58, items 2 and 3).
 *
 * SOURCE: the owner's vc57 handset pass, 11-13, verbatim. Two asks, both copy-and-
 * layout, no new feature:
 *
 *   2. THE COPY. Keep "NoteSnap is listening to your take." and DELETE the rest of
 *      that paragraph; keep the privacy line in the owner's own words; delete the
 *      "Up to 3 minutes per …" sentence and the count-in explanation; ADD the Tip
 *      block, verbatim.
 *   3. THE STOP BUTTON. Once filming has begun, the red Stop moves under the
 *      greyed-out Flip Camera button so it is reachable one-handed. The Start and
 *      Finish positions the owner approved in vc52 do not move.
 *
 * WHY A CONTRACT AND NOT JUST THE EDIT. A deleted sentence can come back and nothing
 * notices: the copy lives in three modules and is rendered by name, so a re-render
 * of a constant that should be gone is invisible in review. And a moved button is
 * invisible to every gate this repo has — tier1 cannot see a screen. Both are pinned
 * here, and both are proven to bite by mutating the real bytes in the suite.
 *
 * PURE: no react, no react-native, no fs. The screen arrives as a STRING.
 */
import { maskCommentsKeepingLines } from './notesCoverage';

/** The one screen these guards read. */
export const VC58_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// THE COPY, VERBATIM FROM THE OWNER (11-13)
// ─────────────────────────────────────────────────────────────────────────────

/** The line the owner KEPT, exactly as it stands. */
export const VC58_KEPT_LISTENING_LINE = 'NoteSnap is listening to your take.';

/** The storage line the owner KEPT and re-worded — "for your privacy" is theirs. */
export const VC58_KEPT_PRIVACY_LINE =
  'The video stays on your phone for your privacy until you share it yourself.';

/** The Tip block's label. */
export const VC58_TIPS_LABEL = 'Tips';

/** The Tip block's body, sentence by sentence, in the owner's words (typos kept). */
export const VC58_TIPS_SENTENCES: readonly string[] = [
  'Turn off all your notifications for recording your NoteSnap video take.',
  'Then do a soundcheck and playback.',
  'Check any introductory script before hand if you are recording or sharing.',
  'Then try performing the piece in one whole take.',
];

/**
 * The sentences the owner DELETED. Each fragment is enough to recognise its
 * sentence, and each one is checked against the LIVE copy AND the rendered screen:
 * a sentence can only come back by being put back in a constant or typed in.
 */
export const VC58_DELETED_FRAGMENTS: readonly string[] = [
  'not the source of the notes',
  'Up to 3 minutes per practice video',
  'A countdown before anything is recorded',
];

/** The live copy, handed in so the guard reads the real modules and not a copy. */
export interface RecordScreenCopy {
  /** `VIDEO_RECORD_HONESTY`. */
  listening: string;
  /** `VIDEO_STAYS_ON_PHONE_LINE`. */
  privacy: string;
  /** `PRACTICE_VIDEO_TIPS_LABEL`. */
  tipsLabel: string;
  /** `PRACTICE_VIDEO_TIPS_BODY`. */
  tipsBody: string;
  /** The screen's source, as text. */
  screen: string;
}

/**
 * GUARD 1 — THE RECORD SCREEN SAYS ONLY WHAT THE OWNER ASKED IT TO SAY.
 *
 * Three things at once, because each one alone has shipped a wrong screen before:
 *   • the kept copy is the owner's words, character for character;
 *   • every kept line is RENDERED FROM ITS CONSTANT (`{VIDEO_RECORD_HONESTY}` and
 *     friends) — typed-in copy is how a screen drifts from the module that a later
 *     fix edits;
 *   • every deleted sentence is gone from BOTH the live copy and the screen.
 */
export function theRecordScreenSaysOnlyTheOwnersCopy(copy: RecordScreenCopy): boolean {
  if (copy.listening !== VC58_KEPT_LISTENING_LINE) return false;
  if (copy.privacy !== VC58_KEPT_PRIVACY_LINE) return false;
  if (copy.tipsLabel !== VC58_TIPS_LABEL) return false;
  if (!VC58_TIPS_SENTENCES.every((sentence) => copy.tipsBody.indexOf(sentence) >= 0)) {
    return false;
  }

  const screen = maskCommentsKeepingLines(copy.screen);
  const rendered = [
    '{VIDEO_RECORD_HONESTY}',
    '{VIDEO_STAYS_ON_PHONE_LINE}',
    '{PRACTICE_VIDEO_TIPS_LABEL}',
    '{PRACTICE_VIDEO_TIPS_BODY}',
  ];
  if (!rendered.every((render) => screen.indexOf(render) >= 0)) return false;

  const everything = [copy.listening, copy.privacy, copy.tipsBody, screen].join('\n');
  return VC58_DELETED_FRAGMENTS.every((fragment) => everything.indexOf(fragment) < 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE STOP BUTTON
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GUARD 2 — THE IN-RECORDING STOP SITS UNDER THE FLIP CAMERA BUTTON.
 *
 * THE OWNER (11-13): once filming has begun, the red Stop must be under the greyed
 * Flip Camera button — one-handed reach while filming — and must not overlap the
 * Flip button, the footer or the count-in.
 *
 * The layout is a STACK, so "under" is source order: the Stop's render comes AFTER
 * the flip row and BEFORE the level meter that heads the recording block. It is also
 * gated on `phase === 'recording'`, so the pre-record layout is untouched — an
 * ungated Stop would appear under a camera that is not filming yet, which is exactly
 * the layout the owner approved in vc52 being changed.
 */
export function theStopButtonSitsUnderTheFlip(screenSource: string): boolean {
  const text = maskCommentsKeepingLines(typeof screenSource === 'string' ? screenSource : '');
  const flip = text.indexOf('style={styles.flipRow}');
  const stop = text.indexOf('style={styles.stopBtn}');
  const levels = text.indexOf('style={styles.levelRow}');
  if (flip < 0 || stop < 0 || levels < 0) return false;
  // Under the flip, above the recording block.
  if (!(stop > flip && stop < levels)) return false;
  // …and it is the IN-RECORDING stop, not a button that is always on screen.
  const justBefore = text.slice(Math.max(0, stop - 800), stop);
  return justBefore.indexOf("phase === 'recording'") >= 0;
}
