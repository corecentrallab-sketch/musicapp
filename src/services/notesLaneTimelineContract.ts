/**
 * notesLaneTimelineContract.ts — WHY THE NOTES LANE WENT BLANK, PINNED (vc55).
 *
 * THE OWNER'S REPORT (vc53 handset pass, 2026-11-11): "Does not show anything in
 * the piano bar - says 'No notes to draw - there was no readable melody in this
 * take'. I have tried x3 takes." The lane draws nothing whenever the list it is
 * handed is empty OR whenever the timeline it is handed has no length:
 *
 *   • `noteCuesForVideo` (vc54) already falls back to the TAKE'S OWN SPAN when the
 *     video's stored length is unknown, so a real take's notes DO reach the lane
 *     as cues. That fix is in the shipped vc54 and it is not enough on its own.
 *   • `overlayLayout` places NOTHING on a zero-length axis - `if (duration <= 0)
 *     return;` - so a lane handed `cues` plus `videoDurationSec = 0` renders an
 *     empty box with a playhead at x=0 and, on vc54, not even a sentence: the
 *     notes arrived and died at the pixel.
 *
 * THE ONE FACT THIS FILE EXISTS FOR: the lane's x-axis must be the timeline the
 * cues were computed on, which `noteCuesForVideo` returns as `timelineSec`. The
 * screen used to feed both lanes the raw stored `ref?.durationSec` instead - the
 * very number the cue builder had to fall back from. Two different answers to
 * "how long is this timeline", and the pixels took the one that can be 0.
 *
 * PURE: no react, no react-native, no fs, no network - so tier1 compiles it and
 * scripts/vc55NotesLaneTimeline.test.ts can pin it. The files it reads are passed
 * in as STRINGS; nothing here opens a file.
 */
import { noteCuesForVideo } from './videoTakeSync';
import { overlayLayout, OVERLAY_MAX_LANES } from './videoOverlayLayout';
import type { SavedCaptureTake } from './midiExport';

export const VC55_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';
export const VC55_LANE_PATH = 'src/components/VideoOverlayLane.tsx';

/** Strip comments before scanning: prose must never satisfy (or fail) a guard. */
export function maskComments(source: string): string {
  return (typeof source === 'string' ? source : '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

/**
 * EVERY `<VideoOverlayLane … />` IN THE SCREEN, as its own source text. The lane
 * is rendered on two surfaces (the watch page and the full-screen notes window),
 * and both must be right - a fix applied to one of them is the class of defect
 * this repo has already shipped once.
 */
export function laneElements(source: string): string[] {
  const text = maskComments(source);
  const found: string[] = [];
  const pattern = /<VideoOverlayLane[\s\S]*?\/>/g;
  let match = pattern.exec(text);
  while (match) {
    found.push(match[0]);
    match = pattern.exec(text);
  }
  return found;
}

/**
 * GUARD 1 - THE LANE DRAWS ON THE TIMELINE THE CUES WERE MADE ON.
 *
 * Every lane in the screen is handed `videoDurationSec={cueSet.timelineSec}`, and
 * there is at least one lane to check (a screen that stopped rendering the lane
 * altogether must fail this too, not pass it vacuously).
 */
export function everyLaneDrawsOnTheCueTimeline(source: string): boolean {
  const lanes = laneElements(source);
  if (lanes.length === 0) return false;
  return lanes.every((lane) => /videoDurationSec=\{cueSet\.timelineSec\}/.test(lane));
}

/**
 * GUARD 2 - NO LANE IS FED THE STORED VIDEO LENGTH.
 *
 * `ref?.durationSec` is the row's stored length, and it is 0 on every row whose
 * length was never stored. It may not be the lane's axis again.
 */
export function noLaneIsFedTheStoredVideoLength(source: string): boolean {
  const lanes = laneElements(source);
  if (lanes.length === 0) return false;
  return lanes.every((lane) => !/ref\??\.durationSec/.test(lane));
}

/**
 * GUARD 3 - THE EMPTY SENTENCE IS CHOSEN BY THE MODEL, NOT BY THE LANE.
 *
 * A take that HAS notes but none inside the window is a different fact from a
 * take with no melody, and only the surface knows which one happened. Every lane
 * is handed the sentence (`emptyLine={cueEmptyLine}`), so a blank lane can never
 * again claim it heard nothing.
 */
export function everyLaneChoosesItsSentenceFromTheModel(source: string): boolean {
  const lanes = laneElements(source);
  if (lanes.length === 0) return false;
  return lanes.every((lane) => /emptyLine=\{cueEmptyLine\}/.test(lane));
}

/**
 * GUARD 4 (pure mechanism) - AN UNKNOWN VIDEO LENGTH STILL YIELDS CUES, AND THE
 * TIMELINE THEY CARRY IS THE TAKE'S OWN SPAN.
 *
 * This is the half vc54 shipped: the notes are not thrown away when the video's
 * stored length is missing. It is asserted here so the axis below has something
 * to be right about.
 */
export function takeSpanIsTheTimelineWhenTheVideoHasNoLength(): boolean {
  const take = {
    notes: [
      { midi: 60, startSec: 1.2, durationSec: 0.5, velocity: 80 },
      { midi: 64, startSec: 2.0, durationSec: 0.5, velocity: 80 },
      { midi: 67, startSec: 3.5, durationSec: 1.0, velocity: 80 },
    ],
    tempoBpm: 100,
    durationSec: 5,
    key: null,
    capturedAt: '2026-11-11T00:00:00.000Z',
  } as unknown as SavedCaptureTake;
  const set = noteCuesForVideo(take, { audioOffsetMs: 0, videoDurationSec: 0 });
  return set.cues.length === 3 && set.timelineSec > 0 && set.timelineSec >= 4.5;
}

/**
 * GUARD 5 (pure mechanism) - A ZERO-LENGTH AXIS DRAWS NOTHING, EVEN WITH CUES.
 *
 * This is the defect in one line: the same cues, drawn on the axis the cue
 * builder fell back FROM (0) and on the axis it RETURNED (`timelineSec`). The
 * first renders no note at all; the second renders every one of them. If
 * `overlayLayout` ever stops needing a length, this guard goes false and the
 * axis fix is re-examined rather than silently kept.
 */
export function aZeroAxisDrawsNothingEvenWithCues(): boolean {
  const take = {
    notes: [
      { midi: 60, startSec: 1.2, durationSec: 0.5, velocity: 80 },
      { midi: 64, startSec: 2.0, durationSec: 0.5, velocity: 80 },
      { midi: 67, startSec: 3.5, durationSec: 1.0, velocity: 80 },
    ],
    tempoBpm: 100,
    durationSec: 5,
    key: null,
    capturedAt: '2026-11-11T00:00:00.000Z',
  } as unknown as SavedCaptureTake;
  const set = noteCuesForVideo(take, { audioOffsetMs: 0, videoDurationSec: 0 });
  const box = { width: 320, height: 120, lanes: OVERLAY_MAX_LANES };
  const onZero = overlayLayout({
    cues: set.cues,
    videoDurationSec: 0,
    clockMs: 0,
    box,
  }).filter((item) => item.kind === 'note').length;
  const onTheCueTimeline = overlayLayout({
    cues: set.cues,
    videoDurationSec: set.timelineSec,
    clockMs: 0,
    box,
  }).filter((item) => item.kind === 'note').length;
  return set.cues.length === 3 && onZero === 0 && onTheCueTimeline === 3;
}

/**
 * GUARD 6 - THE LANE STILL RENDERS EVERY CUE IT IS GIVEN.
 *
 * The renderer draws the draw-list's note items and nothing else filters them; a
 * lane that grew its own condition (a duration check, a "min notes" threshold)
 * would be a third opinion about what reaches the pixels.
 */
export function theLaneRendersEveryNoteItemItIsGiven(laneSource: string): boolean {
  const text = maskComments(laneSource);
  const drawsFromTheDrawList = /drawList\s*\.filter\(\(item\) => item\.kind === 'note'\)/.test(text);
  const emptyOnlyWhenNoCues = /cues\.length === 0 \?/.test(text);
  return drawsFromTheDrawList && emptyOnlyWhenNoCues;
}
