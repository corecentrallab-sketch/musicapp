/**
 * v38UiContract.ts — THE LIVE-SOURCE GUARDS FOR THE PRACTICE-VIDEO FEATURE
 * (owner GO 10-10, all five decisions; backlog a49fbe2d; design brief §5).
 *
 * WHY THESE EXIST. The team's only verification between owner device passes is the
 * tier1 gate: there is no emulator here and no instrumented run. The failure that
 * has reached the owner more than once is not a wrong rule but a rule that is "in
 * the source" and NOT on the path the user takes. Every property of this feature
 * that can only be seen in a real file — both captures started from one screen, a
 * MEASURED offset, the bounded recording, a video copied out of the camera's cache
 * before any row names it, the ONE decode seam, the ONE editor, the system share
 * sheet, the honest-copy plane, the overlay fed by the corrected take, the bounded
 * nudge that never re-times a note, the delete that keeps the take — is a guard
 * here that reads the REAL file, and every guard is PROVEN to bite by a mutation
 * (skills `musicapp-tier1-live-scan-suite`, `musicapp-guard-mutation-probes`).
 *
 * The walk and the in-memory mutations live in scripts/v38UiWiring.test.ts; the
 * headline guards are also applied on disk, with the failing lines captured in
 * /home/team/shared/v38-video-mutation-probes.txt.
 *
 * PURE: no react, no react-native, no expo, no fs. Comments are masked before
 * every check, so a documented-but-absent call can never satisfy a guard.
 */
import { maskComments } from './modalBackContract';

// ─── THE FILES THIS FEATURE OWNS ─────────────────────────────────────────────

export const PRACTICE_VIDEO_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';
export const PRACTICE_VIDEO_LANE_PATH = 'src/components/VideoOverlayLane.tsx';
export const PRACTICE_VIDEO_SEND_SHEET_PATH = 'src/components/PracticeVideoSendToSheet.tsx';
export const PRACTICE_VIDEO_STORE_PATH = 'src/services/practiceVideoStore.ts';
export const PRACTICE_VIDEO_SEND_DEVICE_PATH = 'src/services/videoSendDevice.ts';
export const PRACTICE_VIDEO_SYNC_PATH = 'src/services/videoTakeSync.ts';
export const PRACTICE_VIDEO_REF_PATH = 'src/services/practiceVideoRef.ts';
export const PRACTICE_VIDEO_LAYOUT_PATH = 'src/services/videoOverlayLayout.ts';
export const PRACTICE_VIDEO_SEND_MODEL_PATH = 'src/services/videoSendTo.ts';
export const PRACTICE_VIDEO_CONTRACT_PATH = 'src/services/v38UiContract.ts';
export const PRACTICE_VIDEO_HISTORY_PATH = 'src/screens/HistoryScreen.tsx';
export const PRACTICE_VIDEO_EDITOR_ENTRY_PATH = 'src/screens/EditorScreen.tsx';
export const PRACTICE_VIDEO_APP_PATH = 'App.tsx';
export const PRACTICE_VIDEO_TYPES_PATH = 'src/types/index.ts';
export const PRACTICE_VIDEO_APP_CONFIG_PATH = 'app.json';

/** The pure modules the gate must compile (and their tests must run). */
export const PRACTICE_VIDEO_TIER1_MODULES: readonly string[] = [
  'src/services/videoTakeSync.ts',
  'src/services/videoOverlayLayout.ts',
  'src/services/videoSendTo.ts',
  'src/services/practiceVideoRef.ts',
  'src/services/v38UiContract.ts',
  'scripts/v38VideoPractice.test.ts',
  'scripts/v38UiWiring.test.ts',
];

/** The suites the `test:tier1` chain must run. */
export const PRACTICE_VIDEO_TIER1_SUITES: readonly string[] = [
  'scripts/v38VideoPractice.test.js',
  'scripts/v38UiWiring.test.js',
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

/** The name of the JSX element opened at `at` (or null when it is not one). */
function jsxNameAt(source: string, at: number): string | null {
  const match = /^<([A-Za-z][A-Za-z0-9_]*)/.exec(source.slice(at));
  return match ? match[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 1 — the pure core stays pure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True when this source imports nothing native. The sync math, the layout math,
 * the send model and the row block must compile with `node_modules` absent: that
 * is what makes them provable BEFORE an EAS build, on this box.
 */
export function videoCoreStaysPure(source: string): boolean {
  if (typeof source !== 'string' || source.length < 1200) return false;
  const src = maskComments(source);
  /**
   * THE BAN IS ON IMPORT STATEMENTS, NOT ON THE BARE WORDS. This module's own
   * guards carry the module names as NEEDLES — `"from 'expo-camera'"` inside
   * `videoRecordsBothCapturesOnOneScreen` is a string the screen is searched for,
   * not an import — so a whole-text search flags the contract for documenting the
   * very import it forbids. Same class as `modalBackContract`'s lookahead, which
   * exists so the modal detector does not report itself.
   *
   * `\bimport\b[^;]*?\bfrom\s+'…'` still catches every real form of a native
   * import — single-line, multi-line (`import {\n … \n} from 'react-native'`),
   * `import type`, and the side-effect form `import 'expo-camera'` — while `[^;]`
   * stops a match from crossing a statement boundary, so a needle in one statement
   * can never be joined to an `import` in another.
   */
  if (/\bimport\b[^;]*?\bfrom\s+['"]react(-native)?['"]/.test(src)) return false;
  if (/\bimport\b[^;]*?\bfrom\s+['"]expo[-a-z]*['"]/.test(src)) return false;
  if (/\bimport\s+['"]react(-native)?['"]|\bimport\s+['"]expo[-a-z]*['"]/.test(src)) return false;
  if (/require\(\s*['"](react|react-native|expo[-a-z]*)['"]\s*\)/.test(src)) return false;
  if (/\bimport\b[^;]*?\bfrom\s+['"]fs['"]|\bimport\s+['"]fs['"]/.test(src)) return false;
  if (/\bimport\b[^;]*?\bfrom\s+['"]node:fs['"]/.test(src)) return false;
  if (/require\(\s*['"]fs['"]\s*\)/.test(src)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 2 — DECISION 1: both captures start on ONE screen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The filmed take is the video AND the audio take at the same time, from the same
 * handler, on the same screen (decision 1). Five facts together, because any one
 * alone can be inert: the camera is in video mode with sound, the app's OWN
 * recorder runs beside it, the camera is asked to record, and the recorder's
 * failure readers are inspected — a start that failed silently is the PR #115 bug
 * class, and on this screen it is also decision 2's trigger.
 */
export function videoRecordsBothCapturesOnOneScreen(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 6000) return false;
  if (src.indexOf("from 'expo-camera'") < 0) return false;
  /**
   * THE JSX OPENING TAG, never the TYPE argument: `useRef<CameraView>(null)` also
   * contains `<CameraView`, and taking `indexOf('<CameraView')` slices from that
   * type reference to the next `/>` anywhere in the file — a "tag" of tens of
   * thousands of characters with every prop check missing (the guard then fails on
   * a correctly wired screen). A real element always has whitespace between its
   * name and its props; the type argument has its `>` immediately after.
   */
  const opened = /<CameraView\s/.exec(src);
  if (opened === null) return false;
  const camera = opened.index;
  const close = src.indexOf('/>', camera);
  if (close < 0) return false;
  const tag = src.slice(camera, close + 2);
  /** An opening tag is a handful of props — a runaway slice is not one. */
  if (tag.length > 1200) return false;
  if (tag.indexOf('mode="video"') < 0) return false;
  if (tag.indexOf('mute={false}') < 0) return false;
  if (tag.indexOf('onCameraReady=') < 0) return false;
  if (src.indexOf('useAudioRecorder(') < 0) return false;
  if (src.indexOf('recordAsync(') < 0) return false;
  if (src.indexOf('takeStartFailure()') < 0) return false;
  return src.indexOf('takeStopFailure()') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 3 — DECISION 1: the offset is MEASURED, never assumed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The pair's offset is the difference between two REAL start stamps fed to the
 * pure rule (decision 1, design brief §3.2). A hard-coded `audioOffsetMs: 0` is a
 * FAILURE here on purpose: an assumed zero is exactly the lie the design refuses,
 * and one-mic fallback has its own, documented, honest route
 * (`separateTakeOffset()`) rather than a silent literal.
 */
export function videoOffsetIsMeasuredNotAssumed(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 6000) return false;
  if (src.indexOf('captureSyncOffsetMs({') < 0) return false;
  if (src.indexOf('videoStartMs: videoStartMsRef.current') < 0) return false;
  if (src.indexOf('audioStartMs: audioStartMsRef.current') < 0) return false;
  if (src.indexOf('audioOffsetMs: 0') >= 0) return false;
  // DECISION 2's fallback is explicit about NOT being a measurement.
  return src.indexOf('separateTakeOffset()') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 4 — DECISION 3: the recording is bounded
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Three minutes, enforced in the CALL, not in a comment: `maxDuration` and the
 * camera's own `maxFileSize` both ride the `recordAsync` options, and the cap
 * constant is the one the surface prints (decision 3).
 */
export function videoRecordingIsBounded(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 6000) return false;
  const call = src.indexOf('recordAsync({');
  if (call < 0) return false;
  const end = src.indexOf('})', call);
  if (end < 0) return false;
  const options = src.slice(call, end);
  if (options.indexOf('maxDuration: PRACTICE_VIDEO_MAX_SECONDS') < 0) return false;
  if (options.indexOf('maxFileSize: PRACTICE_VIDEO_MAX_FILE_BYTES') < 0) return false;
  if (src.indexOf('practiceVideoRemainingLine(') < 0) return false;
  if (src.indexOf('PRACTICE_VIDEO_MAX_LINE') < 0) return false;
  return src.indexOf('PRACTICE_VIDEO_MAX_SECONDS') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 5 — the video is persisted before any row names it
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The cache-eviction trap the melody store already documents: `recordAsync` hands
 * back a CACHE file, so the video must be COPIED into the app's documents
 * directory before a History row points at it. The screen must persist FIRST (the
 * store call precedes the row write) and the store must write into the documents
 * dir only — a `cacheDirectory` reference in the store would re-introduce exactly
 * the dead-file bug.
 */
export function videoIsPersistedBeforeAnyRowReferencesIt(
  screenSource: string,
  storeSource: string,
): boolean {
  const screen = maskComments(screenSource);
  const store = maskComments(storeSource);
  if (screen.length < 6000 || store.length < 2000) return false;
  const persist = screen.indexOf('persistPracticeVideo(');
  const row = screen.indexOf('savePracticeVideoRow(');
  if (persist < 0 || row < 0 || persist > row) return false;
  if (store.indexOf('FileSystem.documentDirectory') < 0) return false;
  if (store.indexOf('PRACTICE_VIDEO_DIR_NAME') < 0) return false;
  if (store.indexOf('copyAsync(') < 0) return false;
  return store.indexOf('cacheDirectory') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 6 — the take travels the ONE decode seam
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `deriveCaptureTakeFromRecording` is the app's only decode seam (recording URI →
 * the backend decoder → the pitch tracker → the take). This screen must use it
 * exactly ONCE and must not bring its own decoder, pitch tracker or network route
 * — a second reading of the same audio is how two surfaces start disagreeing
 * about what the user played.
 */
export function videoUsesTheOneDecodeSeam(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 6000) return false;
  if (countOf(src, 'deriveCaptureTakeFromRecording(') !== 1) return false;
  if (src.indexOf("from '../services/captureMidiExport'") < 0) return false;
  if (src.indexOf('pitchDetection') >= 0) return false;
  if (src.indexOf('detectPitchFrames') >= 0) return false;
  if (src.indexOf('fetch(') >= 0) return false;
  return src.indexOf('/api/') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 7 — DECISION 1: ONE editor, the existing one (third host)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The correction step is the app's EXISTING editor, reused as a third host — not
 * a second copy that would drift from the one the capture window and History open.
 * Every JSX element this screen opens whose name ends in "Editor" must be
 * `TakeCorrectionEditor`, it must be handed the take and the row id, and it must
 * be opened after a take exists (an editor with nothing in it is a dead surface).
 */
export function videoOpensTheOneEditor(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 6000) return false;
  const editors: string[] = [];
  let at = src.indexOf('<');
  while (at >= 0) {
    const name = jsxNameAt(src, at);
    if (name && /Editor$/.test(name)) editors.push(name);
    at = src.indexOf('<', at + 1);
  }
  if (editors.length === 0) return false;
  if (!editors.every((name) => name === 'TakeCorrectionEditor')) return false;
  const open = src.indexOf('<TakeCorrectionEditor');
  if (open < 0) return false;
  const close = src.indexOf('/>', open);
  if (close < 0) return false;
  const tag = src.slice(open, close + 2);
  if (tag.indexOf('take={take}') < 0) return false;
  if (tag.indexOf('rowId={row?.rowId ?? null}') < 0) return false;
  if (src.indexOf('visible={editorOpen && !!take}') < 0) return false;
  return src.indexOf('onSaved={handleEditorSaved}') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 8 — DECISION 5: the export leaves through the SYSTEM share sheet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The route out is the platform's: a FILE through expo-sharing, TEXT through React
 * Native's `Share` — both are the system sheet, and there is nothing else in the
 * device seam that can move data (no fetch, no URL, no mail library), which is what
 * makes "nothing is emailed from our side" a property of the code. The MIDI export
 * is NOT re-implemented there either: the editor's own handler is handed in.
 */
export function videoSharesThroughTheSystemSheetOnly(deviceSource: string): boolean {
  const src = maskComments(deviceSource);
  if (src.length < 2000) return false;
  if (src.indexOf("from 'expo-sharing'") < 0) return false;
  if (src.indexOf('Sharing.shareAsync(') < 0) return false;
  if (src.indexOf('Share.share(') < 0) return false;
  if (src.indexOf('videoSendPlan(') < 0) return false;
  if (src.indexOf('videoSummaryText(') < 0) return false;
  if (src.indexOf('exportCaptureMidiFromTake') >= 0) return false;
  if (src.indexOf('fetch(') >= 0) return false;
  if (/https?:\/\//.test(src)) return false;
  return !/nodemailer|smtp|sendgrid|mailgun/i.test(src);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 9 — the export surface renders the pair honestly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The sheet is built from the pure model (`videoSendActions`), says the pair line
 * (the video file carries no notes — Stage 1's truth) and the v37 honesty line,
 * calls the two device routes, and hands the MIDI destination the editor's own
 * `onSendMidi` instead of importing the encoder (a second MIDI path). Every
 * outcome is rendered — a swallowed result is a dead button.
 */
export function videoSendSurfaceRendersThePair(sheetSource: string): boolean {
  const src = maskComments(sheetSource);
  if (src.length < 1500) return false;
  if (src.indexOf('videoSendActions(') < 0) return false;
  /**
   * THE PAIR LINE HAS TO BE RENDERED, not merely imported. `VIDEO_SEND_PAIR_LINE`
   * alone is satisfied by the module's import list, so a `<Text>` that lost its
   * `{VIDEO_SEND_PAIR_LINE}` still passed this guard (the mutation probe caught
   * precisely that). The check is the JSX expression, inside a `<Text>` that is
   * still open at that point — the sheet PRINTS the honest boundary.
   */
  const pairAt = src.indexOf('{VIDEO_SEND_PAIR_LINE}');
  if (pairAt < 0) return false;
  const textAt = src.lastIndexOf('<Text', pairAt);
  if (textAt < 0 || src.slice(textAt, pairAt).indexOf('</Text>') >= 0) return false;
  /** …and the v37 honesty line is PRINTED by the same test (not just imported). */
  const honestAt = src.indexOf('{SEND_TO_HONESTY}');
  if (honestAt < 0) return false;
  const honestTextAt = src.lastIndexOf('<Text', honestAt);
  if (honestTextAt < 0 || src.slice(honestTextAt, honestAt).indexOf('</Text>') >= 0) return false;
  if (src.indexOf('sendPracticeVideo(') < 0) return false;
  if (src.indexOf('exportTakePdfFromTake(') < 0) return false;
  if (src.indexOf('sendPracticeSummary(') < 0) return false;
  if (src.indexOf('onSendMidi') < 0) return false;
  if (src.indexOf('exportCaptureMidiFromTake') >= 0) return false;
  if (src.indexOf('buildTakeNotationPdf') >= 0) return false;
  if (src.indexOf('fetch(') >= 0) return false;
  if (/https?:\/\//.test(src)) return false;
  return src.indexOf('{line ?') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 10 — DECISION 4: the overlay is fed the CORRECTED take, never a video
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The still-wrong version of this feature transcribes the picture. The overlay
 * therefore has to be fed by `noteCuesForVideo(take, …)` — the take the editor
 * saved — rendered by a drawing component that reads no video frame, no video
 * audio track and no detection trace, and that cannot record or decode anything
 * itself (it is a viewer, and a viewer that can open a camera is not a viewer).
 */
export function videoOverlayReadsTheCorrectedTake(
  screenSource: string,
  laneSource: string,
): boolean {
  const screen = maskComments(screenSource);
  const lane = maskComments(laneSource);
  if (screen.length < 6000 || lane.length < 1500) return false;
  if (screen.indexOf('noteCuesForVideo(') < 0) return false;
  if (screen.indexOf('cues={cueSet.cues}') < 0) return false;
  if (screen.indexOf('<VideoOverlayLane') < 0) return false;
  if (screen.indexOf('pitchDetection') >= 0) return false;
  // The drawing component: the two pure layout functions, and no source of notes.
  if (lane.indexOf('overlayLayout(') < 0) return false;
  if (lane.indexOf('chordStripLayout(') < 0) return false;
  if (lane.indexOf('visibleCues(') < 0) return false;
  if (lane.indexOf('expo-camera') >= 0) return false;
  if (lane.indexOf('fetch(') >= 0) return false;
  if (/https?:\/\//.test(lane)) return false;
  return lane.indexOf('pitchDetection') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 11 — the nudge is bounded and NEVER rewrites the take's times
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The sync nudge corrects the residual start latency by eye and ear, inside a
 * ±1500 ms band (the pure `clampVideoOffset` / `nudgeOffset`), and it changes ONLY
 * the stored drawing offset. It must never write a note's times: the take is the
 * same array the MIDI export and the PDF read, so an assignment to `startSec` or
 * `durationSec` in the video path would silently re-time every one of them (the
 * `takePreview` "the clock never rewrites the take" rule, re-proved for video).
 */
export function videoNudgeIsBoundedAndNeverRewritesTakeTimes(
  syncSource: string,
  screenSource: string,
): boolean {
  const sync = maskComments(syncSource);
  const screen = maskComments(screenSource);
  if (sync.length < 2000 || screen.length < 6000) return false;
  if (sync.indexOf('VIDEO_OFFSET_BOUNDS_MS') < 0) return false;
  if (sync.indexOf('export function clampVideoOffset') < 0) return false;
  if (sync.indexOf('export function nudgeOffset') < 0) return false;
  const nudge = sync.indexOf('export function nudgeOffset');
  const body = sync.slice(nudge, nudge + 600);
  if (!/Math\.min\(limit, Math\.max\(-limit, next\)\)/.test(body)) return false;
  if (screen.indexOf('nudgeOffset(') < 0) return false;
  if (/\.startSec\s*=[^=]/.test(screen)) return false;
  if (/\.durationSec\s*=[^=]/.test(screen)) return false;
  return screen.indexOf('attachPracticeVideo(') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 12 — DECISION 5: deleting the video keeps the take
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The pair is independent by design (decision 5): a deleted video must leave the
 * take, its notation, its editor and its exports working. So the History row's
 * delete action goes through `deletePracticeVideo` (which removes the FILE and
 * clears the reference — `updateRecognitionPracticeVideo(rowId, null)`) and the
 * take-level reader `removeRecognition` must NOT appear in that path: removing
 * the video and removing the take are different actions and must stay that way.
 */
export function videoDeletionKeepsTheTake(
  historySource: string,
  storeSource: string,
): boolean {
  const history = maskComments(historySource);
  const store = maskComments(storeSource);
  if (history.length < 20000 || store.length < 2000) return false;
  if (history.indexOf('deletePracticeVideo(') < 0) return false;
  if (history.indexOf('DELETE_PRACTICE_VIDEO_KEEPS_TAKE_LINE') < 0) return false;
  if (history.indexOf('setWatchVideoId(item.id)') < 0) return false;
  if (history.indexOf('WATCH_PRACTICE_VIDEO_CTA') < 0) return false;
  if (history.indexOf('<PracticeVideoScreen') < 0) return false;
  const handler = history.indexOf('const confirmVideoDelete = useCallback(');
  if (handler < 0) return false;
  const body = history.slice(handler, handler + 1200);
  if (body.indexOf('deletePracticeVideo(item.id, item.practiceVideo ?? null)') < 0) return false;
  if (body.indexOf('removeRecognition(') >= 0) return false;
  // …and the STORE's delete removes the file and clears the reference, nothing else.
  const del = store.indexOf('export async function deletePracticeVideo(');
  if (del < 0) return false;
  const storeBody = store.slice(del, del + 900);
  if (storeBody.indexOf('deleteAsync(') < 0) return false;
  if (storeBody.indexOf('updateRecognitionPracticeVideo(rowId, null)') < 0) return false;
  return storeBody.indexOf('removeRecognition(') < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 13 — the honest-copy plane
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The claims this feature may NEVER make, because it does not do them: no
 * transcription of anything, no notes "live" during recording, nothing in
 * "real time", no studio, no AI. Stage 1's notes come from the user's own audio
 * take, read after the fact — and the copy has to say only that.
 *
 * The list is applied to the feature's USER-FACING sources (see
 * `videoUserFacingSources`), with comments masked, so a comment may discuss the
 * ban while no string, label or identifier may carry a banned claim.
 */
export const VIDEO_BANNED_CLAIMS: readonly string[] = [
  'transcription',
  'transcribed',
  'transcribe',
  'live notes',
  'real-time',
  'real time',
  'studio',
  'AI',
];

export function videoCopyAvoidsBannedClaims(sources: readonly string[]): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  for (const source of sources) {
    const src = maskComments(source);
    if (src.length < 200) return false;
    for (const claim of VIDEO_BANNED_CLAIMS) {
      const pattern = new RegExp(`\\b${claim.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
      if (pattern.test(src)) return false;
    }
  }
  return true;
}

/**
 * WHICH SOURCES CARRY USER-FACING COPY — as records, so the contract module
 * (whose ban-list is a set of regex literals in its own body) is kept out of its
 * own sweep and the caller can name which file a violation came from.
 */
export function videoUserFacingSources(
  files: ReadonlyArray<{ path: string; source: string }>,
): string[] {
  if (!Array.isArray(files)) return [];
  return files
    .filter((file) => !!file && file.path !== PRACTICE_VIDEO_CONTRACT_PATH)
    .map((file) => file.source);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 14 — the feature is FREE and carries no paywall token
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rev 38/39: the practice tools — including transposition, stems and exports — are
 * free through launch, and RECOGNITION is never paywalled at all. Nothing in this
 * feature may consult a Pro/subscription/paywall state; the gate it does obey is
 * the honest one (`videoSendActions` returns nothing when there is nothing to
 * send, and the editor is offered only when a take exists).
 */
export function videoFeatureIsFreeAndUnpaywalled(sources: readonly string[]): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  for (const source of sources) {
    const src = maskComments(source);
    if (src.length < 200) return false;
    if (/paywall|isPro|proTier|proFeature|subscription|freeTrial/i.test(src)) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 15 — the gate lists every new module and suite
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A pure module or suite missing from EITHER explicit list is simply not gated —
 * the failure mode the tier1 skill documents. Both lists are read from the real
 * files: `tsconfig.tier1.json`'s `include`, and the `test:tier1` chain in
 * `package.json`.
 */
export function tier1ListsTheVideoFeature(
  tsconfigSource: string,
  packageSource: string,
): boolean {
  if (typeof tsconfigSource !== 'string' || typeof packageSource !== 'string') return false;
  if (tsconfigSource.length < 2000 || packageSource.length < 500) return false;
  for (const module of PRACTICE_VIDEO_TIER1_MODULES) {
    if (tsconfigSource.indexOf(`"${module}"`) < 0) return false;
  }
  for (const suite of PRACTICE_VIDEO_TIER1_SUITES) {
    if (packageSource.indexOf(`/tmp/tier1-test/${suite}`) < 0) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD 16 — the three tap paths reach the feature
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The feature is only real if the user can get to it (design brief §2.1):
 * Practice Tools grows the third card, the root stack registers the screen, the
 * route hands it the row it was asked for, and the History row carries the type
 * the row block rides on. The iOS usage strings are widened in the SAME release —
 * the app now films with sound, and a user (and App Review) must be told so.
 */
export function videoEntryPointsExist(sources: {
  editor: string;
  app: string;
  types: string;
  appConfig: string;
}): boolean {
  const editor = maskComments(sources?.editor ?? '');
  const app = maskComments(sources?.app ?? '');
  const types = maskComments(sources?.types ?? '');
  const config = typeof sources?.appConfig === 'string' ? sources.appConfig : '';
  if (editor.length < 2000 || app.length < 2000 || types.length < 2000) return false;
  // Practice Tools: the third card, navigating by the route's own name.
  if (editor.indexOf("navigation.navigate('PracticeVideo')") < 0) return false;
  if (editor.indexOf('PRACTICE_VIDEO_CARD_TITLE') < 0) return false;
  if (editor.indexOf('PRACTICE_VIDEO_CARD_SUBTITLE') < 0) return false;
  // The root stack: registered, imported and handed the row.
  if (app.indexOf("from './src/screens/PracticeVideoScreen'") < 0) return false;
  if (app.indexOf('name="PracticeVideo"') < 0) return false;
  if (app.indexOf('<PracticeVideoScreen rowId={params?.rowId ?? null}') < 0) return false;
  // The row block is additive and optional on the saved row.
  if (types.indexOf('practiceVideo?: PracticeVideoRef | null') < 0) return false;
  // The app config tells the truth about filming with sound — all three copies.
  return countOf(config, 'film your own practice') >= 3;
}
