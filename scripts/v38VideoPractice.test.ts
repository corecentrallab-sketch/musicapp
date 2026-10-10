/**
 * v38VideoPractice.test.ts — THE PURE MODEL OF THE PRACTICE-VIDEO FEATURE
 * (owner GO 10-10, all five decisions; backlog a49fbe2d; design brief §3/§4/§5).
 *
 * No fs, no react-native, no device: the fixtures are literal takes and refs, and
 * everything asserted here is a decision the owner made —
 *
 *   • DECISION 1: the offset is MEASURED (audioStart − videoStart) and the mapping
 *     is ONE linear offset — drop-not-clamp, with the dropped notes counted;
 *   • DECISION 2: the one-mic fallback has its own offset route and its own line;
 *   • DECISION 3: three minutes, warned early, stated on the surface;
 *   • DECISION 4: the cues come from the take's OWN notes (own-take-only), the
 *     reading never writes, and no line claims the picture carries notes;
 *   • DECISION 5: the video file and the take are a PAIR — the ref may be missing
 *     while the take's exports keep working, and the chip says which it is.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import {
  PRACTICE_VIDEO_MAX_FILE_BYTES,
  PRACTICE_VIDEO_MAX_SECONDS,
  PRACTICE_VIDEO_WARN_SECONDS,
  practiceVideoChipLine,
  practiceVideoIsManuallyAligned,
  practiceVideoIsUsable,
  practiceVideoFileName,
  practiceVideoNeedsWarning,
  practiceVideoRefFromCapture,
  practiceVideoRemainingLine,
  practiceVideoTakeLine,
  videoMimeByExt,
  videoUtiByExt,
} from '../src/services/practiceVideoRef';
import {
  OVERLAY_MAX_LANES,
  OVERLAY_MIN_NOTE_WIDTH,
  chordStripLayout,
  cuesAtClock,
  laneIndexFor,
  overlayLayout,
  pitchRangeFor,
  timeFraction,
  visibleCues,
} from '../src/services/videoOverlayLayout';
import {
  VIDEO_OWN_TAKE_ONLY_LINE,
  VIDEO_RECORD_HONESTY,
  VIDEO_SEPARATE_TAKE_LINE,
  VIDEO_SEPARATE_TAKE_OFFSET_REASON,
  VIDEO_SYNC_HONESTY,
  VIDEO_TAKE_FAILED_LINE,
  VIDEO_OFFSET_BOUNDS_MS,
  captureSyncOffsetMs,
  clampVideoOffset,
  firstOnsetSec,
  formatOffset,
  noteCuesForVideo,
  nudgeOffset,
  offsetFromFirstNoteTap,
  separateTakeOffset,
  videoClock,
  videoCueCountLine,
  videoSizeLine,
} from '../src/services/videoTakeSync';
import {
  VIDEO_SEND_PAIR_LINE,
  maxRecordingLine,
  videoSendActions,
  videoSendOutcomeMessage,
  videoSendPlan,
  videoShareHonesty,
  videoSummaryHeadline,
  videoSummaryText,
} from '../src/services/videoSendTo';
import { SEND_TO_HONESTY } from '../src/services/takeSendTo';
import type { PracticeVideoRef } from '../src/services/practiceVideoRef';
import type { MidiNoteEvent, SavedCaptureTake } from '../src/services/midiExport';

declare const process: { exit(code: number): never };
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
  if (actual === expected) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}

// ─── fixtures ────────────────────────────────────────────────────────────────

/** A take of four notes, starting at 1.2s — the shape the decoder produces. */
function take(): SavedCaptureTake {
  const notes: MidiNoteEvent[] = [
    { midi: 60, startSec: 1.2, durationSec: 0.5, velocity: 80 },
    { midi: 62, startSec: 2.0, durationSec: 0.5, velocity: 80 },
    { midi: 64, startSec: 3.5, durationSec: 0.5, velocity: 80 },
    { midi: 67, startSec: 9.5, durationSec: 0.5, velocity: 80 },
  ];
  return { notes, tempoBpm: 100, key: { tonic: 0, mode: 'major' } } as unknown as SavedCaptureTake;
}

function videoRef(over: Partial<PracticeVideoRef> = {}): PracticeVideoRef {
  return {
    uri: 'file:///documents/notesnap-practice-videos/notesnap-practice-x.mp4',
    durationSec: 5,
    audioOffsetMs: 120,
    measuredOffsetMs: 120,
    filmedAt: '2026-10-10T09:15:00.000Z',
    sizeBytes: 18_400_000,
    ...over,
  };
}

console.log('\nv38 practice video — the sync model (decision 1)');
assertEq(captureSyncOffsetMs({ videoStartMs: 1000, audioStartMs: 1120 }), 120, 'the audio starting 120 ms later is +120 ms');
assertEq(captureSyncOffsetMs({ videoStartMs: 2000, audioStartMs: 1950 }), -50, 'an audio capture that came up first is negative');
assertEq(captureSyncOffsetMs({ videoStartMs: Number.NaN, audioStartMs: 500 }), 500, 'a missing stamp degrades to 0, not to NaN');
assertEq(
  captureSyncOffsetMs({ videoStartMs: 0, audioStartMs: 9000 }),
  9000,
  'the measurement is stored UNCLAMPED (clamping a measurement would hide a late capture)',
);
assertEq(clampVideoOffset(0), 0, 'a zero offset stays zero');
assertEq(clampVideoOffset(VIDEO_OFFSET_BOUNDS_MS + 5000), VIDEO_OFFSET_BOUNDS_MS, 'the hand nudge is bounded above');
assertEq(clampVideoOffset(-(VIDEO_OFFSET_BOUNDS_MS + 5000)), -VIDEO_OFFSET_BOUNDS_MS, 'and below');
assertEq(clampVideoOffset(Number.NaN), 0, 'a NaN offset is no offset');
assertEq(separateTakeOffset(), 0, 'DECISION 2: the one-mic fallback has its own offset route (not a silent literal)');
assert(
  VIDEO_SEPARATE_TAKE_OFFSET_REASON.indexOf('no shared start to measure') >= 0,
  'DECISION 2: and a documented reason for it',
);
assertEq(nudgeOffset(1400, 500), VIDEO_OFFSET_BOUNDS_MS, 'a nudge past the band stops at the band');
assertEq(nudgeOffset(120, 50), 170, 'the fine step moves the offset');
assertEq(nudgeOffset(120, -500), -380, 'the coarse step moves it the other way');
assertEq(nudgeOffset(Number.NaN, Number.NaN), 0, 'garbage in, no offset out');
assertEq(nudgeOffset(100, 100, 150), 150, 'the band is a parameter, and it is honoured');
assertEq(offsetFromFirstNoteTap({ tapSec: 2.0, firstOnsetSec: 1.5 }), 500, 'the tap assist puts the first note under the playhead');
assertEq(offsetFromFirstNoteTap({ tapSec: 0.5, firstOnsetSec: 20 }), -1500, 'and clamps to the same band');
assertEq(offsetFromFirstNoteTap({ tapSec: 1, firstOnsetSec: null }), null, 'a take with no notes has nothing to align');
assertEq(offsetFromFirstNoteTap({ tapSec: Number.NaN, firstOnsetSec: 1 }), null, 'a nonsense tap is refused');
assertEq(firstOnsetSec(take()), 1.2, 'the first onset is the earliest note');
assertEq(firstOnsetSec(null), null, 'no take, no onset');
assertEq(formatOffset(0), 'no offset', 'zero reads as "no offset"');
assertEq(formatOffset(120), '+120 ms', 'later is written with a plus');
assertEq(formatOffset(-80), '−80 ms', 'earlier is written with a minus');

console.log('\nv38 practice video — the mapping (drop, never clamp)');
const before = JSON.stringify(take());
const set = noteCuesForVideo(take(), { audioOffsetMs: 120, videoDurationSec: 5 });
assertEq(set.totalCount, 4, 'the take has four notes');
assertEq(set.inVideoCount, 3, 'the three notes inside the video are cues');
assertEq(set.droppedCount, 1, 'the note that starts after the video ends is dropped');
assertEq(set.droppedReason !== null, true, 'dropped notes are explained, never silent');
assertEq(set.cues[0].startSec, 1.32, 'the first cue is the note plus the measured offset');
assertEq(set.cues[0].endSec, 1.82, 'and it carries the note’s own length');
assertEq(set.cues[0].index, 0, 'a cue addresses the note it came from');
assertEq(set.cues[1].startSec, 2.12, 'the second cue is offset too');
assertEq(JSON.stringify(take()), before, 'READS ONLY: the mapping never rewrites the take');
assertEq(videoCueCountLine(null), null, 'no cue set, no count line');
assertEq(videoCueCountLine({ cues: [], inVideoCount: 0, droppedCount: 0, totalCount: 0, droppedReason: null }), null, 'an empty take has no count line');
assertEq(
  videoCueCountLine(set),
  '3 of 4 notes fall inside the video',
  'the count line states exactly how many landed',
);
const noDrop = noteCuesForVideo(take(), { audioOffsetMs: 0, videoDurationSec: 60 });
assertEq(noDrop.droppedCount, 0, 'a long enough video drops nothing');
assertEq(videoCueCountLine(noDrop), null, 'and claims nothing when nothing was dropped');
assertEq(noDrop.droppedReason, null, 'with no reason to give');
const noTake = noteCuesForVideo(null, { audioOffsetMs: 0, videoDurationSec: 10 });
assertEq(noTake.totalCount, 0, 'a video with no take draws nothing');
assertEq(noteCuesForVideo(take(), { audioOffsetMs: 0, videoDurationSec: 0 }).inVideoCount, 0, 'a zero-length video cannot hold a cue');

console.log('\nv38 practice video — the clip’s own facts (length, size, take)');
assertEq(videoClock(41), '0:41', 'the clock is minutes:seconds');
assertEq(videoClock(-5), '0:00', 'a negative clock reads as zero');
assertEq(videoSizeLine(41, 18_400_000), '0:41 · 18 MB', 'the size rides with the clock when it is known');
assertEq(videoSizeLine(41, null), '0:41', 'and is dropped when it is not known');

console.log('\nv38 practice video — the row block (decisions 3/4/5)');
assertEq(PRACTICE_VIDEO_MAX_SECONDS, 180, 'DECISION 3: the cap is three minutes');
assert(
  PRACTICE_VIDEO_WARN_SECONDS > 0 && PRACTICE_VIDEO_WARN_SECONDS < PRACTICE_VIDEO_MAX_SECONDS,
  'DECISION 3: the warning comes before the cap',
);
assertEq(PRACTICE_VIDEO_MAX_FILE_BYTES, 250 * 1024 * 1024, 'DECISION 3: the camera gets a second, size bound');
assertEq(practiceVideoRemainingLine(0), '3:00 left', 'the record screen starts at three minutes left');
assertEq(practiceVideoRemainingLine(60), '2:00 left', 'and counts down');
assertEq(practiceVideoRemainingLine(400), '0:00 left', 'past the cap it never goes negative');
assertEq(practiceVideoNeedsWarning(59), false, 'no warning before the point');
assertEq(practiceVideoNeedsWarning(60), true, 'the warning is real');
assertEq(
  practiceVideoRefFromCapture({
    uri: 'file:///documents/notesnap-practice-videos/x.mp4',
    durationSec: 41.4,
    audioOffsetMs: 120,
    measuredOffsetMs: 120,
    filmedAt: '2026-10-10T09:15:00.000Z',
    sizeBytes: 18_400_000,
  }).audioOffsetMs,
  120,
  'the ref stores the offset the overlay uses',
);
assertEq(
  practiceVideoRefFromCapture({
    uri: 'file:///documents/notesnap-practice-videos/x.mp4',
    durationSec: 41,
    audioOffsetMs: Number.NaN,
    measuredOffsetMs: 90,
    filmedAt: '2026-10-10T09:15:00.000Z',
  }).audioOffsetMs,
  90,
  'an unreadable applied offset falls back to the measurement',
);
assertEq(
  practiceVideoRefFromCapture({
    uri: 'file:///documents/notesnap-practice-videos/x.mp4',
    durationSec: 41,
    audioOffsetMs: 0,
    measuredOffsetMs: 0,
    filmedAt: '2026-10-10T09:15:00.000Z',
    pairedSeparately: true,
  }).pairedSeparately,
  true,
  'DECISION 2: the separate-take flag is carried on the row',
);
assertEq(practiceVideoRefFromCapture({ uri: 'x.mp4', durationSec: 1, audioOffsetMs: 0, measuredOffsetMs: 0, filmedAt: 't' }).pairedSeparately, undefined, 'and is absent when the pair is one take');
assertEq(practiceVideoIsUsable(videoRef()), true, 'a ref with a file is usable');
assertEq(practiceVideoIsUsable(videoRef({ uri: '   ' })), false, 'a ref with a blank uri is NOT usable (no half-works)');
assertEq(practiceVideoIsUsable(null), false, 'no ref, no video');
assertEq(practiceVideoIsManuallyAligned(videoRef()), false, 'a fresh ref is aligned by measurement');
assertEq(practiceVideoIsManuallyAligned(videoRef({ audioOffsetMs: 400 })), true, 'a moved offset is the user’s own alignment');
assertEq(practiceVideoIsManuallyAligned(videoRef({ uri: '' })), false, 'a dead ref is never "aligned"');
assert((practiceVideoChipLine(videoRef()) ?? '').indexOf('Practice video · 0:05') === 0, 'the chip states the length');
assert(
  (practiceVideoChipLine(videoRef({ pairedSeparately: true })) ?? '').indexOf('separate take') > 0,
  'DECISION 2: and says when the notes came from a separate take',
);
assertEq(practiceVideoChipLine(null), null, 'no video, no chip');
assertEq(practiceVideoTakeLine(null), null, 'no take, no caption');
assertEq(practiceVideoTakeLine({ notes: [] } as unknown as SavedCaptureTake), null, 'a take with no notes claims nothing');
assertEq(practiceVideoTakeLine(take()), '4 notes read from your take', 'the caption counts what was read');
assertEq(practiceVideoTakeLine({ notes: [{ midi: 60, startSec: 0, durationSec: 1 }] } as unknown as SavedCaptureTake), '1 note read from your take', 'one note reads as one note');
assertEq(practiceVideoFileName('Practice video', '2026-10-10T09:15:00.000Z'), 'notesnap-practice-practice-video-2026-10-10T09-15-00-000Z.mp4', 'the file name is filesystem-safe and stamped');
assertEq(practiceVideoFileName(null, ''), 'notesnap-practice.mp4', 'a nameless film still gets a usable name');
assertEq(practiceVideoFileName('  ', '  '), 'notesnap-practice.mp4', 'blank input lands on the default name');
assertEq(videoMimeByExt('file:///x/record.mov'), 'video/quicktime', 'a .mov is shared as a QuickTime movie');
assertEq(videoMimeByExt('file:///x/record.mp4'), 'video/mp4', 'an .mp4 is shared as MP4');
assertEq(videoMimeByExt(null), 'video/mp4', 'an unknown extension defaults to MP4');
assertEq(videoUtiByExt('file:///x/record.mov'), 'public.quicktime-movie', 'and the Apple type follows the extension');

console.log('\nv38 practice video — the overlay layout (decision 4: drawn from the take)');
const cues = noteCuesForVideo(take(), { audioOffsetMs: 0, videoDurationSec: 10 }).cues;
const range = pitchRangeFor(cues);
assertEq(range.minPitch, 60, 'the pitch range comes from the cues');
assertEq(range.maxPitch, 67, 'and spans what was played');
assertEq(pitchRangeFor([]).span, 1, 'an empty lane still has a usable span');
assertEq(laneIndexFor(67, range, 8), 0, 'the highest pitch sits on the top row');
assertEq(laneIndexFor(60, range, 8), 7, 'the lowest on the bottom row');
assertEq(laneIndexFor(999, range, 8), 0, 'a pitch above the range cannot leave the box');
assertEq(laneIndexFor(-999, range, 8), 7, 'nor below it');
assertEq(timeFraction(5, 10), 0.5, 'the clock maps linearly across the video');
assertEq(timeFraction(-5, 10), 0, 'before the start is the start');
assertEq(timeFraction(50, 10), 1, 'past the end is the end');
assertEq(timeFraction(1, 0), 0, 'a zero-length video has no timeline');
const box = { width: 320, height: 120, lanes: OVERLAY_MAX_LANES };
const draw = overlayLayout({ cues, videoDurationSec: 10, clockMs: 2500, box });
const noteItems = draw.filter((item) => item.kind === 'note');
assertEq(noteItems.length, 4, 'every cue inside the video is drawn');
assert(
  noteItems.every((item) => item.x >= 0 && item.x < 320 && item.y >= 0 && item.y + item.h <= 120.01),
  'no note is drawn outside the box',
);
assert(
  noteItems.every((item) => item.w >= Math.min(OVERLAY_MIN_NOTE_WIDTH, 320 - item.x)),
  'every note is at least the minimum width',
);
const playheads = draw.filter((item) => item.kind === 'playhead');
assertEq(playheads.length, 1, 'there is exactly ONE playhead');
assertEq(playheads[0].x, 80, 'the playhead sits where the clock is');
const past = overlayLayout({
  cues: [{ index: 0, midi: 60, startSec: 10, endSec: 10.5 }],
  videoDurationSec: 10,
  clockMs: 0,
  box,
});
assertEq(
  past.filter((item) => item.kind === 'note').length,
  0,
  'a note whose mark would start at the right edge is absent, not pinned to it',
);
assertEq(overlayLayout({ cues, videoDurationSec: 0, clockMs: 0, box }).filter((i) => i.kind === 'note').length, 0, 'no timeline, no notes');
assertEq(cuesAtClock(cues, 2200).length, 1, 'the clock names the note sounding now');
assertEq(cuesAtClock(cues, 100).length, 0, 'and nothing when nothing sounds');
assertEq(cuesAtClock(null, 2200).length, 0, 'no cues, nothing sounding');
assertEq(visibleCues(draw, 2200).length, 1, 'the visible set is the note under the playhead');
assertEq(visibleCues([], 2500).length, 0, 'an empty draw list shows nothing');
const chips = chordStripLayout([' C ', 'G', '', 'Am'], { maxChips: 8 });
assertEq(chips.length, 3, 'blank chords are dropped from the strip');
assertEq(chips[0].label, 'C', 'and the names are trimmed');
assertEq(chips[0].fraction, 0, 'the strip starts at the left');
assertEq(chordStripLayout(['C', 'G', 'D', 'Em'], { maxChips: 2 }).length, 2, 'the strip is bounded');
assertEq(chordStripLayout([]).length, 0, 'no chords, no strip');
assertEq(chordStripLayout(null).length, 0, 'and null is handled');

console.log('\nv38 practice video — the export model (decision 5: the pair)');
assertEq(videoSendActions(null).length, 0, 'an empty recording offers NOTHING (no dead button)');
assertEq(videoSendActions({ video: null, take: null }).length, 0, 'and so does a pair of nulls');
const videoOnly = videoSendActions({ video: videoRef(), take: null });
assertEq(videoOnly.length, 1, 'a filmed take whose melody could not be read still offers the VIDEO');
assertEq(videoOnly[0].kind, 'video', 'and it is the video destination');
const takeOnly = videoSendActions({ video: null, take: take() });
assertEq(takeOnly.map((action) => action.kind).join(','), 'pdf,midi,summary', 'a take with no video keeps its exports');
const both = videoSendActions({ video: videoRef(), take: take() });
assertEq(both.map((action) => action.kind).join(','), 'video,pdf,midi,summary', 'the pair offers all four destinations');
assertEq(videoSendPlan({ hasVideo: true, hasTake: false, shareSheetAvailable: true }).mode, 'file', 'with a share sheet, the file goes out');
assertEq(videoSendPlan({ hasVideo: false, hasTake: true, shareSheetAvailable: false }).mode, 'text', 'without one, a take still goes as plain text');
assertEq(videoSendPlan({ hasVideo: false, hasTake: false, shareSheetAvailable: true }).mode, 'none', 'nothing to send is nothing to send');
assertEq(
  videoSendPlan({ hasVideo: true, hasTake: false, shareSheetAvailable: false }).mode,
  'none',
  'a video-only record with no file-capable sheet is refused with a reason, never half-sent',
);
assert(videoSummaryHeadline({ video: videoRef({ durationSec: 41 }), take: take() }).indexOf('video 0:41') > 0, 'the summary headline states the video’s own length');
const summary = videoSummaryText({ video: videoRef(), take: take() }, { title: 'My practice take' });
assert(summary.indexOf(VIDEO_SEND_PAIR_LINE) >= 0, 'the summary carries the pair line');
assert(summary.indexOf(SEND_TO_HONESTY) >= 0, 'and the v37 honesty line, verbatim');
assert(summary.indexOf('Notes: C4, D4, E4, G4') >= 0, 'and the note names it really read');
assertEq(videoShareHonesty(), SEND_TO_HONESTY, 'the honesty line is the v37 one, not a copy');
assertEq(maxRecordingLine(), 'Up to 3 minutes per practice video — you can stop at any time.', 'the cap is stated in the export’s own words');
assertEq(videoSendOutcomeMessage('shared', 'video').length > 0, true, 'a shared video has an outcome sentence');
assertEq(videoSendOutcomeMessage('failed', 'pdf').length > 0, true, 'a failed PDF says so');
assertEq(videoSendOutcomeMessage('unavailable', 'midi').length > 0, true, 'an unavailable MIDI says so');
assertEq(videoSendOutcomeMessage('dismissed', 'summary').length > 0, true, 'a dismissed summary says so');
assertEq(videoSummaryText({ video: null, take: null }).indexOf('No notes were read') > 0, true, 'an empty summary still refuses to invent notes');

console.log('\nv38 practice video — the honest plane (decision 4)');
assert(VIDEO_SYNC_HONESTY.indexOf('video picture itself carries no notes') >= 0, 'the honesty line denies the picture carries notes');
assert(VIDEO_RECORD_HONESTY.indexOf('not the source of the notes') >= 0, 'the record screen says where the notes come from');
assert(VIDEO_OWN_TAKE_ONLY_LINE.indexOf('never reads the notes off the picture') >= 0, 'own-take-only is stated, not implied');
assert(VIDEO_SEPARATE_TAKE_LINE.indexOf('separate take') >= 0, 'decision 2 says when a separate take was used');
assert(VIDEO_TAKE_FAILED_LINE.indexOf('still send it') >= 0, 'a video whose melody could not be read is still sendable');

console.log('\nv38 practice video — the model is not vacuous (empty and hostile input)');
assertEq(captureSyncOffsetMs({ videoStartMs: Number.NaN, audioStartMs: Number.NaN }), 0, 'a NaN pair measures nothing');
assertEq(clampVideoOffset('abc' as unknown as number), 0, 'a non-number offset is no offset');
assertEq(nudgeOffset(0, 'x' as unknown as number), 0, 'a non-number nudge does not move the offset');
assertEq(firstOnsetSec({ notes: [{ midi: 60 }] } as unknown as SavedCaptureTake), null, 'a note with no readable start is not an onset');
assertEq(noteCuesForVideo({ notes: null } as unknown as SavedCaptureTake, { videoDurationSec: 5 }).totalCount, 0, 'a take with an unreadable note list has no cues');
assertEq(noteCuesForVideo(take(), { audioOffsetMs: 0, videoDurationSec: Number.NaN }).inVideoCount, 0, 'a NaN duration holds nothing');
assertEq(overlayLayout({ cues: null, videoDurationSec: 10, clockMs: 0, box: { width: 10, height: 10 } }).length, 1, 'an empty lane still draws its playhead');
assertEq(pitchRangeFor(null).span, 1, 'a null cue list has a usable range');
assertEq(chordStripLayout(undefined).length, 0, 'undefined chords are handled');
assertEq(videoSendActions(undefined).length, 0, 'undefined offers nothing');
assertEq(videoSendPlan({ hasVideo: false, hasTake: false, shareSheetAvailable: false }).mode, 'none', 'nothing at all is mode none');

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
