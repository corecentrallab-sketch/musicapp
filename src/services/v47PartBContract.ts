/**
 * v47PartBContract.ts — THE LIVE-SOURCE GUARDS FOR v47 PART B (the two practice-
 * video items: A/B take comparison, clip + label → teacher send).
 *
 * WHY THESE EXIST, AND WHY THEY ASSERT HOSTING. The team's only verification
 * between owner device passes is the tier1 gate: no emulator, no instrumented run.
 * The failure that has reached the owner more than once — and that v46 was built to
 * end — is a component that is imported and rendered NOWHERE, or wired but handed
 * nothing. So every guard here reads the REAL files and asks two questions:
 *
 *   • IS IT ON THE PATH? (hosted inside the playback branch of the practice-video
 *     screen, mounted inside the send sheet — not merely imported)
 *   • IS IT HANDED REAL DATA? (this row's video ref and corrected take, the second
 *     take read from History, the ONE window both pair members came from)
 *
 * Each guard is PROVEN to bite by a mutation (skills `musicapp-tier1-live-scan-
 * suite`, `musicapp-guard-mutation-probes`): break the thing deliberately, watch
 * the suite fail, restore the original bytes. The probes and their captured failing
 * lines live in /home/team/shared/v47-partb-mutation-probes.txt.
 *
 * PURE: no react, no react-native, no expo, no fs. Comments are masked before every
 * check, so a documented-but-absent call can never satisfy a guard.
 */
import { maskComments } from './modalBackContract';

// ─── THE FILES THIS PART OWNS ────────────────────────────────────────────────

export const COMPARE_SURFACE_PATH = 'src/components/PracticeVideoCompare.tsx';
export const COMPARE_MODEL_PATH = 'src/services/videoCompare.ts';
export const CLIP_TAG_EDITOR_PATH = 'src/components/TakeClipTagEditor.tsx';
export const CLIP_TAG_MODEL_PATH = 'src/services/takeClipTag.ts';
export const PARTB_CONTRACT_PATH = 'src/services/v47PartBContract.ts';
export const PARTB_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';
export const PARTB_SEND_SHEET_PATH = 'src/components/PracticeVideoSendToSheet.tsx';
export const PARTB_SEND_DEVICE_PATH = 'src/services/videoSendDevice.ts';
export const PARTB_SEND_MODEL_PATH = 'src/services/videoSendTo.ts';
export const PARTB_STORE_PATH = 'src/services/practiceVideoStore.ts';
export const PARTB_REF_PATH = 'src/services/practiceVideoRef.ts';

/** The pure modules the gate must compile (and their suites must run). */
export const PARTB_TIER1_MODULES: readonly string[] = [
  'src/services/videoCompare.ts',
  'src/services/takeClipTag.ts',
  'src/services/v47PartBContract.ts',
  'scripts/v47TakeCompare.test.ts',
  'scripts/v47TrimTag.test.ts',
];

export const PARTB_TIER1_SUITES: readonly string[] = [
  'scripts/v47TakeCompare.test.js',
  'scripts/v47TrimTag.test.js',
];

function countOf(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = source.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = source.indexOf(needle, at + needle.length);
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 1 — ITEM 1: the comparison surface is HOSTED on the playback path
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The comparison exists for the user only if the practice-video screen MOUNTS it
 * inside its playback branch and hands it real data: this row's own video ref and
 * corrected take on the left, and the second take READ FROM HISTORY on the right.
 *
 * `hosted` is checked by position — the `<PracticeVideoCompare` element must appear
 * after the `if (phase === 'playback')` line — because a component mounted in the
 * record branch would never render on the surface the user actually reaches.
 */
export function compareSurfaceIsHosted(screenSource: string, compareSource: string): boolean {
  const screen = maskComments(screenSource);
  const surface = maskComments(compareSource);
  if (screen.length < 20000 || surface.length < 4000) return false;
  // The surface itself: two players of the user's own files, drawn with the same lane.
  if (surface.indexOf("from 'expo-av'") < 0) return false;
  if (surface.indexOf('<Video') < 0) return false;
  if (surface.indexOf('<VideoOverlayLane') < 0) return false;
  if (surface.indexOf('cues={side.cues}') < 0) return false;
  if (surface.indexOf('source={{ uri: side.uri }}') < 0) return false;
  if (surface.indexOf('comparePair(') < 0) return false;
  // HOSTING: imported, opened in the playback branch, given real local take data.
  if (screen.indexOf("from '../components/PracticeVideoCompare'") < 0) return false;
  const playback = screen.indexOf("if (phase === 'playback')");
  const mounted = screen.indexOf('<PracticeVideoCompare');
  if (playback < 0 || mounted < 0 || mounted < playback) return false;
  if (screen.indexOf('visible={compareOpen}') < 0) return false;
  if (
    screen.indexOf(
      'left={{ label: COMPARE_LEFT_LABEL, ref: row?.ref ?? null, take, note: row?.takeNote ?? null }}',
    ) < 0
  ) {
    return false;
  }
  if (screen.indexOf('right={otherSide}') < 0) return false;
  if (screen.indexOf('onRecordSecond={handleRecordSecond}') < 0) return false;
  // …and the second take is really read from History, never invented.
  if (screen.indexOf('listPracticeVideoRows(row?.rowId ?? null)') < 0) return false;
  if (screen.indexOf('setOtherSide(') < 0) return false;
  if (screen.indexOf('onPress={() => void openCompare()}') < 0) return false;
  return screen.indexOf('COMPARE_CTA') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 2 — ITEM 1: nothing in the comparison path reaches the network
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AIRPLANE MODE IS A PROPERTY OF THE CODE, NOT A PROMISE. Both videos are files in
 * the app's documents folder, so the comparison surface and its model must contain
 * no fetch, no XHR, no socket, no http(s) address and no `/api/` route. The record
 * screen's own seam rules (v38) already forbid a second decode path; this applies
 * the same ban to the two new surfaces.
 */
export function comparePathIsOffline(sources: ReadonlyArray<string>): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  for (const source of sources) {
    const src = maskComments(source);
    if (src.length < 2000) return false;
    if (src.indexOf('fetch(') >= 0) return false;
    if (/XMLHttpRequest|WebSocket|axios/.test(src)) return false;
    if (/https?:\/\//.test(src)) return false;
    if (src.indexOf('/api/') >= 0) return false;
    if (src.indexOf('expo-sharing') >= 0) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 3 — ITEM 1: the honest-copy rule (no judgement anywhere on the surface)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE COPY MUST NOT JUDGE. The comparison shows two takes; it never says one is an
 * advance on the other, never prints a mark, a number out of ten, a rating or a
 * verdict. This is enforced as a STRING SCAN, so adding that language to the
 * surface (or to the model that feeds it) fails the gate — the probe in
 * scripts/v47TakeCompare.test.ts adds "the better take" and watches this return
 * false.
 */
export const COMPARE_BANNED_WORDS: readonly string[] = [
  'better',
  'best',
  'worse',
  'worst',
  'score',
  'scored',
  'grade',
  'graded',
  'mark out of',
  'rating',
  'ranked',
  'ranking',
  'improved',
  'improvement',
  'winner',
  'out of ten',
  'percent better',
];

export function compareCopyNeverJudges(sources: ReadonlyArray<string>): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  for (const source of sources) {
    const src = maskComments(source);
    if (src.length < 2000) return false;
    for (const word of COMPARE_BANNED_WORDS) {
      const pattern = new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      if (pattern.test(src)) return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 4 — ITEM 1: the edge cases are ON the surface, not only in the model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The owner named three edge cases. Each one has a line in the model AND is
 * rendered by the surface: one take only (with the way to film a second — never a
 * dead end), a take whose file is gone, and takes of different lengths.
 */
export function compareEdgeCasesAreOnTheSurface(
  compareSource: string,
  modelSource: string,
): boolean {
  const surface = maskComments(compareSource);
  const model = maskComments(modelSource);
  if (surface.length < 4000 || model.length < 4000) return false;
  for (const name of [
    'COMPARE_ONE_TAKE_LINE',
    'COMPARE_RECORD_SECOND_CTA',
    'COMPARE_MISSING_LINE',
    'COMPARE_DIFFERENT_LENGTHS_LINE',
    'COMPARE_OFFLINE_LINE',
  ]) {
    if (model.indexOf(`export const ${name}`) < 0) return false;
  }
  if (surface.indexOf('{COMPARE_ONE_TAKE_LINE}') < 0) return false;
  if (surface.indexOf('{COMPARE_RECORD_SECOND_CTA}') < 0) return false;
  if (surface.indexOf('{COMPARE_MISSING_LINE}') < 0) return false;
  if (surface.indexOf('{pair.lengthLine}') < 0) return false;
  if (surface.indexOf('{pair.offlineLine}') < 0) return false;
  return surface.indexOf('onRecordSecond') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 5 — ITEM 2: the clip + label step is MOUNTED in the send sheet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The clip and the label are only real if they are on the send path. The sheet must
 * mount `TakeClipTagEditor` (not merely import it) and hand it the stored window,
 * the take's label and both change handlers.
 */
export function clipTagEditorIsMountedInSendSheet(sheetSource: string): boolean {
  const sheet = maskComments(sheetSource);
  if (sheet.length < 3000) return false;
  if (sheet.indexOf("from './TakeClipTagEditor'") < 0) return false;
  const mounted = sheet.indexOf('<TakeClipTagEditor');
  if (mounted < 0) return false;
  if (sheet.indexOf('span={trimSpan}') < 0) return false;
  if (sheet.indexOf('durationSec={durationSec}') < 0) return false;
  if (sheet.indexOf('note={record?.note ?? null}') < 0) return false;
  if (sheet.indexOf('onSpanChange={onSpanChange') < 0) return false;
  return sheet.indexOf('onNoteChange={onNoteChange') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 6 — ITEM 2: ONE span, BOTH members of the pair
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BUG THIS GUARD EXISTS FOR. A clipped PDF beside an unclipped video (or a
 * .mid built from the whole take) is worse than no clip at all. So the sheet must
 * derive BOTH members from ONE `trimmedSendPair` call — the video send receives
 * `pair.span`, the PDF is built from `pair.take`, the MIDI export is handed
 * `pair.take`, and the summary receives `pair.span`. Any of those drifting back to
 * the raw record fails here.
 */
export function trimSpanIsAppliedToBothPairMembers(sheetSource: string): boolean {
  const sheet = maskComments(sheetSource);
  if (sheet.length < 3000) return false;
  if (countOf(sheet, 'trimmedSendPair(') !== 1) return false;
  if (sheet.indexOf('const pair = useMemo(') < 0) return false;
  if (sheet.indexOf('sendPracticeVideo(sendRecord, { title: pair.title, trimSpan: pair.span })') < 0) return false;
  if (sheet.indexOf('exportTakePdfFromTake(pair.take, { title: pair.takeTitle') < 0) return false;
  if (sheet.indexOf('onSendMidi(pair.take)') < 0) return false;
  if (sheet.indexOf('sendPracticeSummary(sendRecord, { title: pair.title, trimSpan: pair.span })') < 0) return false;
  if (sheet.indexOf('videoSendActions(sendRecord)') < 0) return false;
  // …and the record handed to the destinations is the PAIR's, never the raw one.
  if (sheet.indexOf('() => ({ video: pair.video, take: pair.take, note: pair.note })') < 0) return false;
  return sheet.indexOf('pair.spanHasNoNotes') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 7 — ITEM 2: the span is persisted, and it reaches the VIDEO too
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The clip is stored on the row's practice-video block (`trim`), written through the
 * same attach path the sync nudge uses, and it is applied to the video the user
 * watches (the player starts at the window's first frame and stops at its end).
 * A window that lived only in React state would be lost on the next open.
 */
export function clipIsPersistedAndAppliedToTheVideo(screenSource: string): boolean {
  const screen = maskComments(screenSource);
  if (screen.length < 20000) return false;
  if (screen.indexOf('trim: bounded') < 0) return false;
  if (screen.indexOf('attachPracticeVideo(row.rowId, updated)') < 0) return false;
  if (screen.indexOf('normaliseTrimSpan(') < 0) return false;
  if (screen.indexOf('trimPlaybackShouldPause(position, trimSpan)') < 0) return false;
  if (screen.indexOf('trimSpan={trimSpan}') < 0) return false;
  return screen.indexOf('{`Clip: ${trimSpanLabel(trimSpan)}`}') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 8 — ITEM 2: the label is persisted AND carried on every member
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The label rides the take's own local text field (`takeNote`, written through the
 * melody store's note write) and is handed to the pair — which prints it on the
 * summary, the PDF/MIDI title and the video's dialog title. A label that lived only
 * in the sheet's state would vanish when the user came back to the take.
 */
export function tagIsPersistedAndCarried(screenSource: string, sheetSource: string): boolean {
  const screen = maskComments(screenSource);
  const sheet = maskComments(sheetSource);
  if (screen.length < 20000 || sheet.length < 3000) return false;
  if (screen.indexOf('updatePersonalMelodyNote(row.rowId, cleaned)') < 0) return false;
  if (screen.indexOf('normaliseTakeNote(next)') < 0) return false;
  if (screen.indexOf('{ ...current, takeNote: cleaned }') < 0) return false;
  if (screen.indexOf('note: row?.takeNote ?? null') < 0) return false;
  if (screen.indexOf('onNoteChange={(next) => void handleNoteChange(next)}') < 0) return false;
  // The sheet feeds the label into the pair (and so into every member).
  return sheet.indexOf('note: record?.note ?? null') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 9 — the whole of part B adds no network call
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One sweep over every file this part touches. The two features are local-only by
 * design (own takes, own files, own text), so any of these tokens appearing in any
 * of them is a regression of the owner's standing rule — not a style preference.
 */
export function partBAddsNoNetworkCall(sources: ReadonlyArray<string>): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  for (const source of sources) {
    const src = maskComments(source);
    if (src.length < 1000) return false;
    if (src.indexOf('fetch(') >= 0) return false;
    if (/XMLHttpRequest|WebSocket|axios|node-fetch/.test(src)) return false;
    if (/https?:\/\//.test(src)) return false;
    if (src.indexOf('/api/') >= 0) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 10 — the pure core stays pure, and the gate lists every module
// ─────────────────────────────────────────────────────────────────────────────

/** The two new models must compile with `node_modules` absent: no native imports. */
export function partBModelsStayPure(sources: ReadonlyArray<string>): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  for (const source of sources) {
    const src = maskComments(source);
    if (src.length < 3000) return false;
    if (/\bimport\b[^;]*?\bfrom\s+['"]react(-native)?['"]/.test(src)) return false;
    if (/\bimport\b[^;]*?\bfrom\s+['"]expo[-a-z]*['"]/.test(src)) return false;
    if (/\bimport\s+['"]expo[-a-z]*['"]/.test(src)) return false;
    if (/\bimport\b[^;]*?\bfrom\s+['"]fs['"]/.test(src)) return false;
  }
  return true;
}

/**
 * A module or suite missing from EITHER explicit list is simply not gated — the
 * failure mode the tier1 skill documents. Both lists are read from the real files.
 */
export function partBIsGated(tsconfigSource: string, packageSource: string): boolean {
  if (typeof tsconfigSource !== 'string' || typeof packageSource !== 'string') return false;
  if (tsconfigSource.length < 2000 || packageSource.length < 500) return false;
  for (const module of PARTB_TIER1_MODULES) {
    if (tsconfigSource.indexOf(`"${module}"`) < 0) return false;
  }
  for (const suite of PARTB_TIER1_SUITES) {
    if (packageSource.indexOf(`/tmp/tier1-test/${suite}`) < 0) return false;
  }
  return true;
}
