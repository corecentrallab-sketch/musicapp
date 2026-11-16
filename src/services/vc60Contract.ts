/**
 * vc60Contract.ts — THE FOUR GUARDS OF THE vc60 SLICE, AS PURE PREDICATES.
 *
 * Each one reads REAL SOURCE (a screen, a component, a service) as a string and
 * answers a question about its behaviour. They live here rather than inline in the
 * test so the test can run each one over a MUTATED copy of the same bytes and be
 * required to fail there — the rule that stops a gate from being green and blind.
 *
 * WHAT THEY PIN, and the defect each one exists for:
 *
 *   1. `takeStaffShowsTheWholeTake` — the take's staves get the whole-work treatment
 *      AND the honest length line (owner: "only ~4 bars").
 *   2. `theSurfacePicksItsSentence` — the practice-video page takes its sentence from
 *      the facts (takeReadVerdict.ts), so a failed decode can never print the
 *      melody verdict again.
 *   3. `theLaneKeepsItsEmptySentence` — the lane's own empty sentence is still the
 *      fallback it draws with (`?? OVERLAY_EMPTY_LINE`), which NOTHING asserted
 *      before vc60: removing it rendered `<Text>{null}</Text>` and every suite stayed
 *      green.
 *   4. `theProbeIsOptIn` — the on-device decoder probe cannot run on its own, cannot
 *      be reached from the shipped notes read, and the 60-second coverage number is
 *      still 60.
 *
 * PURE: no react, no react-native, no fs. Asserted by
 * scripts/vc60TakeStaffAndLane.test.ts and scripts/vc60DecoderProbe.test.ts.
 */
import { NOTES_COVERAGE_SECONDS } from './notesCoverage';

/**
 * The source with its comments removed. EVERY guard below reads CODE, never prose:
 * a doc comment that names a token must not satisfy a guard, and an example of a
 * length line in a comment must not trip the "no typed length" rule. (Defect class
 * 14 — a probe that edits or matches the first occurrence can hit a comment.)
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/** Every `<AbcScoreView …>` tag in a source file. */
function viewerTags(source: string): string[] {
  const tags = source.match(/<AbcScoreView[\s\S]*?\/>/g);
  return Array.isArray(tags) ? tags : [];
}

/**
 * GUARD 1 — THE TAKE'S STAFF IS THE WHOLE TAKE, AND SAYS HOW LONG IT IS.
 *
 * BOTH staves (the raw trace and the auto-cleaned line) must ask for `wholeWork` and
 * be handed the viewport box, and the card must print the length line computed from
 * the take's OWN abc. A typed length string would be a length the music did not
 * give us, so the card may not carry one.
 */
export function takeStaffShowsTheWholeTake(cardSource: string): boolean {
  const source = stripComments(typeof cardSource === 'string' ? cardSource : '');
  const staves = viewerTags(source);
  if (staves.length < 2) return false;
  // The take has exactly two staves; both are whole-work and both get the viewport.
  if (staves.length !== 2) return false;
  const wholeWork = staves.every((tag) => /\swholeWork\b/.test(tag));
  const viewport = staves.every((tag) => /\sviewportHeight=\{staffViewport\}/.test(tag));
  if (!wholeWork || !viewport) return false;
  // The viewport is a real number: the prop, or the window as the last resort.
  if (!/useWindowDimensions\(\)/.test(source)) return false;
  if (!/const staffViewport =/.test(source)) return false;
  // THE HONEST LENGTH LINE, from the take's own ABC (services/scoreLength.ts).
  if (source.indexOf('<ScoreLengthLine') < 0) return false;
  if (!/<ScoreLengthLine[^>]*abc=\{rows\.rawAbc \?\? ''\}/.test(source)) return false;
  // …and no typed bar count anywhere on the card.
  if (/\bBars \d/.test(source)) return false;
  return true;
}

/**
 * GUARD 2 — THE SENTENCE COMES FROM THE FACTS, NOT FROM A TERNARY ON THIS SCREEN.
 *
 * vc60's lie was `derived.unavailable ? … : VIDEO_NO_MELODY_LINE`: a failed decode
 * fell through to the melody verdict. The screen now asks takeReadVerdict.ts, which
 * is the only place the three failures are ordered.
 */
export function theSurfacePicksItsSentence(screenSource: string): boolean {
  const source = stripComments(typeof screenSource === 'string' ? screenSource : '');
  if (source.indexOf('takeReadLine(takeReadOutcome(derived)') < 0) return false;
  if (source.indexOf("from '../services/takeReadVerdict'") < 0) return false;
  // The old choice must be gone: no branch on `derived.unavailable` that lands on a
  // melody verdict.
  if (/derived\.unavailable\s*\?[^;\n]*NO_MELODY/.test(source)) return false;
  return true;
}

/**
 * GUARD 3 — THE LANE'S OWN EMPTY SENTENCE IS STILL THE FALLBACK.
 *
 * `laneEmptyLine(cueSet, takeBusy) ?? OVERLAY_EMPTY_LINE` is the line the lane draws
 * when it has nothing to draw. No test in the repo referenced OVERLAY_EMPTY_LINE, so
 * the fallback could be deleted — the lane would render an empty Text and every suite
 * stayed green. It is asserted here, together with the fact that the fallback is
 * REACHABLE (laneEmptyLine returns null when there are cues).
 */
export function theLaneKeepsItsEmptySentence(screenSource: string): boolean {
  const source = stripComments(typeof screenSource === 'string' ? screenSource : '');
  if (!/laneEmptyLine\(cueSet, takeBusy\) \?\? OVERLAY_EMPTY_LINE/.test(source)) return false;
  if (source.indexOf('OVERLAY_EMPTY_LINE') < 0) return false;
  if (!/import \{[^}]*OVERLAY_EMPTY_LINE[^}]*\} from '\.\.\/services\/videoOverlayLayout'/.test(source)) {
    return false;
  }
  // The sentence is handed to the lane, so an empty lane has words in it.
  if (!/emptyLine=\{cueEmptyLine\}/.test(source)) return false;
  return true;
}

/**
 * GUARD 4 — THE DECODER PROBE IS OPT-IN, AND THE SHIPPED READ IS UNTOUCHED.
 *
 * The probe exists to MEASURE the on-device decoder; the swap onto it is the next
 * build. So: the shipped read path may not mention the decoder at all, the probe may
 * not mount its WebView before the press, and the coverage number the probe is meant
 * to retire is still 60 until the numbers say otherwise.
 */
export function theProbeIsOptIn(input: {
  probeCard: string;
  screen: string;
  shippedRead: string;
  captureSeam: string;
  /** The coverage number in force (defaults to the shipped constant). */
  coverage?: number;
}): boolean {
  const card = stripComments(typeof input?.probeCard === 'string' ? input.probeCard : '');
  const screen = stripComments(typeof input?.screen === 'string' ? input.screen : '');
  const shippedRead = stripComments(
    typeof input?.shippedRead === 'string' ? input.shippedRead : '',
  );
  const seam = stripComments(typeof input?.captureSeam === 'string' ? input.captureSeam : '');

  // (a) THE SHIPPED NOTES READ DOES NOT TOUCH THE DECODER.
  for (const token of ['tunerDecoder', 'TUNER_DECODER_HTML', 'TakeDecoderProbe', 'decodeAudioData']) {
    if (shippedRead.indexOf(token) >= 0) return false;
    if (seam.indexOf(token) >= 0) return false;
  }

  // (b) THE PROBE IS ON THE REVIEW PAGE, BEHIND ITS OWN CONTROL.
  if (screen.indexOf("from '../components/TakeDecoderProbeCard'") < 0) return false;
  if (screen.indexOf('<TakeDecoderProbeCard') < 0) return false;

  // (c) NOTHING DECODES BEFORE THE PRESS: exactly one WebView, and it is inside the
  //     `armed` branch (the flag the control sets).
  const gate = card.indexOf('{armed ? (');
  if (gate < 0) return false;
  // A JSX tag, not a type argument: `useRef<WebView<{}>>` must not count.
  const tags = card.match(/<WebView[\s>]/g);
  const firstWeb = card.search(/<WebView[\s>]/);
  if (firstWeb < 0 || firstWeb < gate) return false;
  // The control is what arms it.
  if (!/setArmed\(true\)/.test(card)) return false;
  if (!/onPress=\{\(\) => void run\(\)\}/.test(card)) return false;
  // The probe is a measurement: it must not write a take or a History row.
  for (const writer of ['saveRecognition', 'savePracticeVideo', 'historyWriteQueue', 'fetch(']) {
    if (card.indexOf(writer) >= 0) return false;
  }

  // (d) THE COVERAGE NUMBER THE PROBE IS MEANT TO RETIRE IS STILL 60.
  const coverage = typeof input?.coverage === 'number' ? input.coverage : NOTES_COVERAGE_SECONDS;
  if (coverage !== 60) return false;
  return true;
}
