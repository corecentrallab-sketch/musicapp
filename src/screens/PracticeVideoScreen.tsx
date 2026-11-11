/**
 * PracticeVideoScreen.tsx — THE PRACTICE-VIDEO SURFACE (owner GO 10-10, all five
 * decisions; backlog a49fbe2d; design brief §2.2/§2.4).
 *
 * TWO MODES, ONE SCREEN (the brief's shape):
 *
 *   • RECORD — the camera's PREVIEW with `mode="video"` and the app's EXISTING
 *     audio recorder running at the same time. Both captures come up together, the
 *     screen stamps when each really started (`videoStartMsRef` /
 *     `audioStartMsRef`) and stores the MEASURED offset (decision 1). ONE control:
 *     Stop. The length is bounded (decision 3, 3 minutes) and the honest line under
 *     the preview says where the notes come from (decision 4 — the sound, never the
 *     picture).
 *   • PLAYBACK — the user's own file, with the CORRECTED take's notes and chords
 *     drawn over it on the video's clock, the bounded hand-alignment nudge, and
 *     Send-to (decision 5: the video plus the take's PDF/MIDI, as a pair).
 *
 * THE FIVE DECISIONS, WHERE EACH ONE LIVES:
 *   1. STAGE 1 FIRST — film + audio take simultaneously → the existing
 *      `deriveCaptureTakeFromRecording` seam → the EXISTING `TakeCorrectionEditor`
 *      (third host, this screen) → overlay → the v37 Send-to path (reused).
 *   2. ONE-MIC FALLBACK, KEEP-SOUND — if the app's recorder cannot start while the
 *      camera rolls, the video keeps ITS OWN sound (never a silent video) and the
 *      notes come from a separate take of the same phrase, labelled honestly
 *      (`pairedSeparately` + VIDEO_SEPARATE_TAKE_LINE) and aligned with the same
 *      bounded nudge.
 *   3. 3-MINUTE CAP — `PRACTICE_VIDEO_MAX_SECONDS` on `recordAsync`, plus the
 *      camera's own size cap, a running timer and the remaining-time line.
 *   4. OWN-TAKE-ONLY — no live detection, no frame analysis, no network: the notes
 *      are the take the editor saved, and nothing here can read the video's picture.
 *   5. TWO-FILE PAIR — the video goes to the documents dir and the take stays where
 *      it already lives; the export sends the video plus the take's PDF/MIDI.
 *
 * GUARDED BY src/services/v38UiContract.ts (asserted on this real file by
 * scripts/v38UiWiring.test.ts, and proven to bite by on-disk mutation probes).
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Video, ResizeMode } from 'expo-av';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import {
  ensurePlaybackAudioMode,
  playWithAudioFocus,
  registerAudioPauseHandler,
  restorePlaybackAudioMode,
} from '../services/audioSession';
import { reportAudioFailure, usableDetail } from '../services/audioDiagnostics';
import { deriveCaptureTakeFromRecording } from '../services/captureMidiExport';
import { exportCaptureMidiFromTake } from '../services/captureMidiExport';
import {
  MIDI_EXPORT_LABEL,
  type SavedCaptureTake,
} from '../services/midiExport';
import { melodyRowId, suggestedChords } from '../services/melodyCapture';
import { persistMelodyAudio } from '../services/melodyStore';
import {
  PRACTICE_VIDEO_MAX_FILE_BYTES,
  PRACTICE_VIDEO_MAX_SECONDS,
  PRACTICE_VIDEO_MAX_LINE,
  PRACTICE_VIDEO_RECORD_AGAIN_CTA,
  PRACTICE_VIDEO_SCREEN_TITLE,
  PRACTICE_VIDEO_START_FAILED_LINE,
  PRACTICE_VIDEO_START_LINE,
  PRACTICE_VIDEO_START_CTA,
  PRACTICE_VIDEO_START_HINT,
  PRACTICE_VIDEO_CAMERA_NOT_READY_LINE,
  PRACTICE_VIDEO_ARMING_LINE,
  PRACTICE_VIDEO_RECORDING_LINE,
  PRACTICE_VIDEO_STOP_CTA,
  PRACTICE_VIDEO_DONE_CTA,
  PRACTICE_VIDEO_OPEN_SETTINGS_CTA,
  PRACTICE_VIDEO_PERMISSION_DENIED_LINE,
  PRACTICE_VIDEO_PERMISSION_LINE,
  PRACTICE_VIDEO_ROW_TITLE,
  DELETE_PRACTICE_VIDEO_FAILED_LINE,
  practiceVideoNeedsWarning,
  practiceVideoRefFromCapture,
  practiceVideoRemainingLine,
  practiceVideoTakeLine,
  practiceVideoIsManuallyAligned,
  practiceVideoIsUsable,
  practiceVideoPlaybackPlan,
  practiceVideoSaveState,
  PRACTICE_VIDEO_FILE_GONE_LINE,
  PRACTICE_VIDEO_KEEPING_LINE,
  PRACTICE_VIDEO_SAVE_FAILED_HEADLINE,
  PRACTICE_VIDEO_SAVE_RETRY_CTA,
  type PracticeVideoRef,
  type PracticeVideoSaveState,
} from '../services/practiceVideoRef';
import {
  PRACTICE_VIDEO_NOT_KEPT_LINE,
  attachPracticeVideo,
  deletePracticeVideo,
  listPracticeVideoRows,
  loadPracticeVideoRow,
  persistPracticeVideo,
  practiceVideoFileExists,
  practiceVideoRowIsStored,
  savePracticeVideoRow,
  savePracticeVideoTake,
} from '../services/practiceVideoStore';
// THE TAKE'S OWN LABEL (v47 part B, item 2): the same local text the History card
// keeps, saved through the melody store's own note write — one label per take.
import { updatePersonalMelodyNote } from '../services/melodyStore';
import { normaliseTakeNote } from '../services/takeNotes';
import {
  TAKE_TAG_CLEARED_LINE,
  TAKE_TAG_FAILED_LINE,
  TAKE_TAG_SAVED_LINE,
  normaliseTrimSpan,
  trimPlaybackAction,
  trimPlaybackWindowLine,
  trimSpanLabel,
  trimWindowStartMs,
  type TakeTrimSpan,
} from '../services/takeClipTag';
import { COMPARE_CTA, COMPARE_LEFT_LABEL, COMPARE_RIGHT_LABEL } from '../services/videoCompare';
/**
 * ── vc49 DEVICE BATCH (owner email 11-03) ────────────────────────────────────
 * The camera FLIP, the COUNT-IN and the RECORDING LENGTH the owner asked for
 * after using the app on a phone. The two record-screen choices live in a pure
 * module so their bounds (and the count-in's clock rule) are testable without an
 * emulator; the flip is the camera's own `facing` prop, driven by state.
 */
import {
  CAMERA_BACK_LINE,
  CAMERA_FRONT_LINE,
  COUNT_IN_CANCEL_CTA,
  COUNT_IN_HONESTY,
  COUNT_IN_HINT,
  COUNT_IN_LABEL,
  COUNT_IN_OPTIONS,
  FLIP_CAMERA_CTA,
  FLIP_CAMERA_HINT,
  FLIP_LOCKED_LINE,
  RECORDING_LENGTH_HINT,
  RECORDING_LENGTH_LABEL,
  RECORDING_LENGTH_OPTIONS,
  RECORDING_LENGTH_REACHED_LINE,
  clampRecordingLength,
  countInCountdownLine,
  countInDeadline,
  countInLabel,
  countInRemainingSec,
  normaliseCountIn,
  recordingClock,
  recordingElapsedSec,
  recordingLengthLabel,
  recordingLengthReached,
  recordingProgressLine,
  type CameraFacing,
} from '../services/practiceRecordingOptions';
import { TakeClipTagEditor } from '../components/TakeClipTagEditor';
import {
  VIDEO_MISSING_LINE,
  VIDEO_NOTES_DROPPED_LINE,
  VIDEO_OFFSET_MANUAL_LINE,
  VIDEO_OFFSET_MINUS_LABEL,
  VIDEO_OFFSET_NUDGE_MS,
  VIDEO_OFFSET_PLUS_LABEL,
  VIDEO_OFFSET_RESET_CTA,
  VIDEO_OFFSET_ROW_LABEL,
  VIDEO_OFFSET_SET_FROM_FIRST_NOTE_CTA,
  VIDEO_RECORD_HONESTY,
  VIDEO_SEPARATE_TAKE_LINE,
  VIDEO_STAYS_ON_PHONE_LINE,
  VIDEO_SYNC_HONESTY,
  VIDEO_TAKE_FAILED_LINE,
  VIDEO_TAKE_ON_ITS_OWN_CTA,
  VIDEO_TAKE_ON_ITS_OWN_LINE,
  captureSyncOffsetMs,
  firstOnsetSec,
  formatOffset,
  noteCuesForVideo,
  nudgeOffset,
  offsetFromFirstNoteTap,
  separateTakeOffset,
  videoCueCountLine,
  videoCueEmptyLine,
  videoSizeLine,
  type VideoCueSet,
} from '../services/videoTakeSync';
import { OVERLAY_LANE_HEIGHT } from '../components/VideoOverlayLane';
import { VideoOverlayLane } from '../components/VideoOverlayLane';
// vc53, items 3/4/7: the full-screen player, the draggable scrub bar and the
// full-screen notes box. The player is an in-app Modal because the pinned expo-av
// cannot present native fullscreen on Android (see FullScreenVideo's header).
import {
  FullScreenVideo,
  FULL_SCREEN_VIDEO_CTA,
  FULL_SCREEN_VIDEO_ICON_LABEL,
  FULL_SCREEN_VIDEO_ICON_NAME,
} from '../components/FullScreenVideo';
import { Ionicons } from '@expo/vector-icons';
import { ScrubBar } from '../components/ScrubBar';
import { scrubSeekTargetMs } from '../services/videoScrub';
import { OVERLAY_EMPTY_LINE, OVERLAY_LANE_LABEL } from '../services/videoOverlayLayout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tabScreenBottomPadding } from '../services/tabBarLayout';
import { PracticeVideoSendToSheet } from '../components/PracticeVideoSendToSheet';
import { PracticeVideoCompare, type CompareTakeSide } from '../components/PracticeVideoCompare';
import { TakeStaffCard } from '../components/TakeStaffCard';
// THE FULL-SCREEN READING WINDOW (v43 fix batch, slice 3, item E7). The row's
// staff is card-width inside a scrolling page; this screen hands the shared
// opener to the card and renders the one window itself.
import { FullScreenScore, useFullScreenScoreBox } from '../components/FullScreenScore';
import { TakeCorrectionEditor } from '../components/TakeCorrectionEditor';

/**
 * Where the screen is. ONE machine for both modes (v39 fixes 2/3, owner
 * 10-11): `playback` is a real phase — a History row STARTS here and can never
 * fall into the record flow — and the record flow only ever leaves `permissions`
 * because the user pressed Start (never because the camera came up).
 */
export type PracticeVideoPhase =
  | 'playback'
  | 'permissions'
  /**
   * vc49: the COUNT-IN — a phase BEFORE any capture exists. Nothing is filmed and
   * no clock is stamped here; `startBothCaptures` runs only when it reaches zero.
   */
  | 'count_in'
  | 'recording'
  | 'keeping'
  | 'review'
  | 'blocked'
  | 'start_failed';

export interface PracticeVideoScreenProps {
  /** A History row to PLAY BACK (omitted = film a new take). */
  rowId?: string | null;
  /** The in-place host (History) closes the surface with this. */
  onClose?: () => void;
}

/** What the screen holds once a take is filmed (or read back from History). */
interface PracticeTakeRow {
  rowId: string;
  title: string;
  take: SavedCaptureTake | null;
  ref: PracticeVideoRef | null;
  audioUri: string | null;
  /** The take's own local label (v47 part B) — null on an older take. */
  takeNote: string | null;
}

/**
 * ── THE VIDEO'S OWN TRANSPORT (v40 fix J, owner 10-14) ──────────────────────
 *
 * THE OWNER'S FINDING: "Watch your Practice video won't play in either viewing
 * screen + no audio + slow processing."
 *
 * WHAT THE CODE SHOWED. The only place the screen ever re-applied the PLAYBACK
 * audio session was the player's `onReadyForDisplay` — and this screen is entered
 * straight from (or straight after) a filming session, where the app's recorder
 * left it in its RECORDING session. expo-av's Android player takes its volume
 * from audio focus, so under a recording session a play reports success at
 * volume 0: "it plays, with no sound". `onReadyForDisplay` only fires once a
 * frame is rendered, which is NOT guaranteed before the user presses play (and
 * never fires at all when the file cannot be decoded) — so the one restore this
 * screen had could simply never run. services/audioSession.ts documents the same
 * class of failure for every other surface in the app.
 *
 * WHAT THIS ADDS. The session is applied as soon as the screen is in its playback
 * phase (before the player mounts), our own Play/Pause control re-applies it on
 * every press, and the player's own error is rendered instead of leaving the user
 * a black rectangle with a control that does nothing.
 */
export const VIDEO_PLAY_CTA = '▶ Play the video';
export const VIDEO_PAUSE_CTA = '⏸ Pause';
export const VIDEO_PREPARING_LABEL = 'Preparing…';
export const VIDEO_PLAY_HINT =
  'Sound comes from the speaker. The notes below follow this video’s own clock — nudge them if they sit early or late.';
export const VIDEO_PLAYBACK_FAILED_LINE =
  'This video would not play on this device — the file could not be opened. Your take, its notation and its exports are untouched.';

/**
 * ── vc50: NO SILENT FAILURE, NO EMPTY SURFACE (owner 11-04) ───────────────────
 *
 * The owner's report: "Not recording takes… nothing shows up once processed in
 * the Record your Practice screen either in any of the boxes. A dead end." and
 * "the user is in the watch with notes page but can't watch anything as there's
 * nothing to watch on the page."
 *
 * Every line below is a surface for a failure that used to be silent: a camera
 * that never handed back a file (its rejection was swallowed by an empty
 * `.catch`), a take whose decode threw or never resolved (the screen stayed on
 * "Keeping your video…" forever), and a playback page with nothing on it.
 */
export const VIDEO_CAPTURE_FAILED_LINE =
  'The camera did not hand back a video file, so there is no video for this take. Your notes are kept and you can film again.';
export const VIDEO_TAKE_READING_LINE = 'Reading the notes out of your take…';
export const VIDEO_TAKE_TIMEOUT_LINE =
  'Reading the notes from this take took too long, so we stopped waiting. Your video and its audio are saved — you can try the notes again from the take.';
export const VIDEO_TAKE_SAVE_FAILED_LINE =
  'The notes were read but could not be saved onto this take. Your video and its audio are saved.';
export const VIDEO_REVIEW_TITLE = 'Your take';
export const VIDEO_REVIEW_VIDEO_LINE =
  'This is the video you just filmed. Trim it below, or watch it with your notes.';
export const VIDEO_NOTHING_TO_WATCH_LINE =
  'There is no video for this take on this device, so there is nothing to play here. Your take’s notes and exports are unaffected.';
export const VIDEO_NOTHING_AT_ALL_LINE =
  'Nothing was kept from this take — there is no video and no audio to play. Film it again and it will appear here.';
export const VIDEO_RECORD_AGAIN_CTA = 'Film a new take';
/**
 * ── vc52 (B1): A BLACK RECTANGLE IS NOT A VIDEO ───────────────────────────
 * The owner pressed "Watch with notes" and got a black screen. Half of that was a
 * player mounted over a file nobody had checked; the other half is the gap between
 * mounting a player and the decoder producing a frame, which is also black. The
 * surface now says which one it is looking at.
 */
export const VIDEO_LOADING_LINE = 'Opening your video…';

/**
 * How long the take's decode may hold the review surface's "reading" line before
 * the screen says it gave up. The decode runs OFF the surface's critical path (the
 * video is already on screen), so this is a bound on a promise, not a spinner the
 * user has to sit through.
 */
export const TAKE_DECODE_TIMEOUT_MS = 45000;

/**
 * Resolve with `promise`'s value, or with `fallback` once `ms` has passed. A
 * promise that never settles is the failure mode this exists for: the screen must
 * always have something to say, so every step that could hang is bounded.
 */
async function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const PracticeVideoScreen: React.FC<PracticeVideoScreenProps> = ({
  rowId: requestedRowId = null,
  onClose,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const recorder = useAudioRecorder();
  const cameraRef = useRef<CameraView>(null);

  // WHERE THE MODE STARTS (v39 fix 3): a History row means playback FROM THE
  // FIRST PAINT — the phase itself carries the mode, so no later render can put a
  // watch-only row through a permissions or recording path. No row means the
  // record flow, and that flow does not start filming until the user says so
  // (v39 fix 2).
  const watchMode = !!requestedRowId;
  const [row, setRow] = useState<PracticeTakeRow | null>(null);
  const [phase, setPhase] = useState<PracticeVideoPhase>(
    watchMode ? 'playback' : 'permissions',
  );
  // The camera is up and can film: the Start control's own precondition. It is
  // NOT the trigger — only the user's press starts the recording (v39 fix 2).
  const [cameraReady, setCameraReady] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  // THE FULL-SCREEN READING STATE (v43 slice 3, item E7) — the same window and
  // the same viewport box every other notation surface uses.
  const [takeExpanded, setTakeExpanded] = useState(false);
  const expandBoxHeight = useFullScreenScoreBox();
  /**
   * ── vc53, ITEMS 3 AND 7: TWO FULL-SCREEN WINDOWS ────────────────────────────
   * `videoFullOpen` is the in-app full-screen player (the native fullscreen
   * affordance expo-av shows on Android does nothing — see FullScreenVideo), and
   * `notesFullOpen` is the "notes NoteSnap heard in your take" box, full bleed.
   * The screen's bottom inset is read here too, because this surface scrolls and
   * its last control must clear the device's navigation bar.
   */
  const insets = useSafeAreaInsets();
  const [videoFullOpen, setVideoFullOpen] = useState(false);
  const [notesFullOpen, setNotesFullOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [midiBusy, setMidiBusy] = useState(false);
  const [midiLine, setMidiLine] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(0);
  const [offsetMs, setOffsetMs] = useState(0);
  const [deletedLine, setDeletedLine] = useState<string | null>(null);
  /**
   * ── vc52 (A5): THE SAVE'S OWN VERIFIED OUTCOME ──────────────────────────────
   * `saveState` is what the READ-BACK said, not what a write function hoped. A
   * failed save renders its own headline, its own card and a retry; it is never a
   * body line in the pale colour the owner cannot read.
   */
  const [saveState, setSaveState] = useState<PracticeVideoSaveState | null>(null);
  const [saveRetrying, setSaveRetrying] = useState(false);
  /**
   * ── vc52 (B1): THE PLAYER HAS PAINTED A FRAME ───────────────────────────────
   * Until the file is loaded and seeked, the player is a black rectangle. The
   * surface says "loading" instead of showing an empty box, and only calls itself
   * ready once a frame really exists.
   */
  const [videoLoaded, setVideoLoaded] = useState(false);
  /**
   * ── v47 PART B STATE ────────────────────────────────────────────────────────
   * `compareOpen` / `otherSide` are the side-by-side surface and the SECOND take it
   * puts beside this one (loaded from History, never invented); `trimSpan` is the
   * clip window stored on the row; `noteLine`/`noteBusy` are the label write's own
   * outcome, so a failed save is never silent.
   */
  const [compareOpen, setCompareOpen] = useState(false);
  const [otherSide, setOtherSide] = useState<CompareTakeSide | null>(null);
  const [trimSpan, setTrimSpan] = useState<TakeTrimSpan | null>(null);
  const [noteLine, setNoteLine] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);

  /**
   * ── vc49 DEVICE BATCH STATE (owner email 11-03) ─────────────────────────────
   *
   * `facing` is WHICH WAY THE CAMERA LOOKS and it is the only thing the camera's
   * `facing` prop is allowed to read (a literal there is the defect the owner hit:
   * "i could not turn it around to face me"). `countInSec` is the chosen lead-in
   * and `countInLeft` the number on screen while it runs; `recordingLengthSec` is
   * the chosen length, ALWAYS written through `clampRecordingLength`, and
   * `autoStopRef` makes the length-triggered stop fire exactly once.
   */
  const [facing, setFacing] = useState<CameraFacing>('back');
  const [countInSec, setCountInSec] = useState(0);
  const [countInLeft, setCountInLeft] = useState(0);
  const [recordingLengthSec, setRecordingLengthSec] = useState(PRACTICE_VIDEO_MAX_SECONDS);
  const autoStopRef = useRef(false);

  /**
   * ── vc50 STATE (owner 11-04) ────────────────────────────────────────────────
   *
   * `takeLine` is the take-decode's own outcome sentence and `takeBusy` is its
   * in-flight flag: the video lands on the review surface FIRST and the notes
   * arrive when they arrive, so a slow or failing decode can never leave the user
   * on a spinner with nothing to look at. `videoFailureRef` keeps the camera's own
   * rejection reason so the surface can say what happened instead of swallowing it.
   */
  const [takeLine, setTakeLine] = useState<string | null>(null);
  const [takeBusy, setTakeBusy] = useState(false);
  const videoFailureRef = useRef<string | null>(null);
  /** The take's own start stamp, so its length never depends on a ticker. */
  const recordingStartedAtRef = useRef(0);
  /** Stop is idempotent: the auto-stop and the Stop button cannot both run it. */
  const stoppingRef = useRef(false);

  /**
   * DECISION 1's STAMPS. Each capture stamp is taken at the moment its recorder
   * reports it is rolling, and the pair's offset is the MEASURED difference
   * between them — never a literal zero (guarded in v38UiContract).
   */
  const videoStartMsRef = useRef(0);
  const audioStartMsRef = useRef(0);
  /** DECISION 2: true when the notes come from a separate take. */
  const separateTakeRef = useRef(false);
  /** The row id the filmed take is being written under (stable across the flow). */
  const rowIdRef = useRef<string | null>(requestedRowId);
  const audioUriRef = useRef<string | null>(null);
  const videoUriRef = useRef<string | null>(null);
  const videoPromiseRef = useRef<Promise<void> | null>(null);
  const armedRef = useRef(false);
  const elapsedRef = useRef(0);

  /**
   * THE VIDEO PLAYER (v40 fix J). `videoPlaying` mirrors the player's OWN status
   * (so the button can never claim a state the player is not in), `videoBusy` is
   * the honest "Preparing…" while the session is applied and the file loads, and
   * `videoLine` is the player's failure sentence on the surface.
   */
  const videoRef = useRef<Video>(null);
  /**
   * vc53: the REVIEW page's player gets a ref of its own. Before this it had
   * none, so nothing on that page could move it — which is why the trim could be
   * set but not scrubbed and the full-screen window had no position to open at.
   */
  const reviewVideoRef = useRef<Video>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoLine, setVideoLine] = useState<string | null>(null);

  /**
   * THE PLAYBACK SESSION, APPLIED BEFORE THE PLAYER MOUNTS (v40 fix J — see the
   * note over VIDEO_PLAY_CTA above). The recorder put the app in its RECORDING
   * session; restoring it here means the video is never loaded under a session
   * that silences it. `row?.ref?.uri` is in the deps so a row that arrives late
   * (History reads it asynchronously) still gets the session applied.
   */
  useEffect(() => {
    if (phase !== 'playback') return undefined;
    void restorePlaybackAudioMode();
    // The session stays active in the background (v41 item 1), so the APP pauses
    // the video when the user leaves the screen/app — a practice video must never
    // play on behind them (the guard expo-av used to provide by throwing).
    const unregister = registerAudioPauseHandler(() => {
      void videoRef.current?.pauseAsync().catch(() => undefined);
    });
    return unregister;
  }, [phase, row?.ref?.uri]);

  /**
   * ── THE REVIEW SURFACE'S OWN VIDEO NEEDS THE PLAYBACK SESSION (vc50) ────────
   *
   * The review surface now shows the take the user just filmed (that is the fix
   * for "a large blue screen pops in … obscuring the video": the take is ON the
   * surface instead of hidden behind a panel). But the app has just left the
   * RECORDING session, and expo-av's Android player takes its volume from audio
   * focus — so a video played under a recording session reports success at volume
   * 0, which is the v40 fix J class of failure ("it plays, with no sound"). The
   * playback session is therefore applied as soon as the review surface has a
   * video to show, before the player mounts.
   */
  useEffect(() => {
    if (phase !== 'review') return undefined;
    void restorePlaybackAudioMode();
    return undefined;
  }, [phase, row?.ref?.uri]);

  /**
   * OUR OWN PLAY/PAUSE. Re-applies the playback session on EVERY press (the
   * recorder may have run since the last one), loads the file when the player is
   * not loaded yet, and puts every failure into `videoLine` plus the app-wide
   * diagnostics chip. Never throws: the button always leaves a sentence.
   */
  const toggleVideo = useCallback(async () => {
    const player = videoRef.current;
    if (!player || videoBusy) return;
    setVideoBusy(true);
    setVideoLine(null);
    try {
      await ensurePlaybackAudioMode();
      const status = await player.getStatusAsync();
      const loaded = (status as { isLoaded?: boolean }).isLoaded === true;
      if (videoPlaying && loaded) {
        await player.pauseAsync();
        return;
      }
      if (!loaded) {
        const uri = row?.ref?.uri ?? null;
        if (!uri) {
          setVideoLine(VIDEO_PLAYBACK_FAILED_LINE);
          return;
        }
        // THE ONE GUARDED PLAY PATH (v41 item 1): loading with shouldPlay IS the
        // play, so it is retried once after a refused audio-focus request —
        // expo-av's AudioFocusNotAcquiredException is exactly what the owner's v40
        // red banner carried ("the recording could not be opened on this device").
        await playWithAudioFocus(
          () => player.loadAsync({ uri }, { shouldPlay: true, volume: 1 }),
          { source: 'take-playback', reason: 'clip-load' },
        );
        return;
      }
      const at = (status as { positionMillis?: number; durationMillis?: number });
      const position = Number.isFinite(at.positionMillis) ? Number(at.positionMillis) : 0;
      const duration = Number.isFinite(at.durationMillis) ? Number(at.durationMillis) : 0;
      /**
       * THE WINDOW DECIDES WHERE PLAY BEGINS (vc52, A4). One rule
       * (`trimPlaybackAction`), the same one the status handler uses, so the button
       * and the native transport can never disagree: outside the window we seek to
       * its first frame, at its end we rewind to it, inside it we just play. With
       * no window this is a no-op and the finished-video restart stands.
       */
      const clipAction = trimPlaybackAction(position, trimSpan);
      if (clipAction.kind === 'seek' || clipAction.kind === 'stop') {
        await player.setPositionAsync(clipAction.toMs);
      } else if (duration > 0 && position >= duration - 250) {
        // A finished video starts again rather than appearing to do nothing.
        await player.setPositionAsync(0);
      }
      await playWithAudioFocus(() => player.playAsync(), {
        source: 'take-playback',
        reason: 'clip-load',
      });
    } catch (err) {
      setVideoLine(VIDEO_PLAYBACK_FAILED_LINE);
      reportAudioFailure({
        source: 'take-playback',
        reason: 'clip-load',
        detail: usableDetail(err),
      });
    } finally {
      setVideoBusy(false);
    }
  }, [row, trimSpan, videoBusy, videoPlaying]);

  /**
   * ── vc52 (A4): THE WINDOW IS IN FORCE FROM THE FIRST FRAME ──────────────────
   *
   * The owner: "If you trim a video, then play it, it should show up as trimmed and
   * play as trimmed." Two things make that true here, and neither needs a new
   * dependency:
   *   • `onLoad` seeks into the window, so the frame the user first sees is the
   *     window's first frame (and a real frame is decoded, instead of an unpainted
   *     black rectangle — B1's other half);
   *   • this effect re-seeks whenever `trimSpan` changes, so a ± press or a drag of
   *     the clip bar moves the picture immediately, not only on the next play.
   * The player's own status handler stops it at the window's end.
   */
  useEffect(() => {
    if (!videoLoaded) return;
    const startMs = trimWindowStartMs(trimSpan);
    if (startMs === null) return;
    const player = videoRef.current;
    if (!player) return;
    void player.setPositionAsync(startMs).catch(() => undefined);
  }, [trimSpan, videoLoaded]);

  /** The player has a frame: say so, and put it inside the window. */
  const handleVideoLoad = useCallback(() => {
    setVideoLoaded(true);
    const startMs = trimWindowStartMs(trimSpan);
    if (startMs === null) return;
    void videoRef.current?.setPositionAsync(startMs).catch(() => undefined);
  }, [trimSpan]);

  // ── PLAYBACK: read the row we were opened for ────────────────────────────────
  useEffect(() => {
    let alive = true;
    if (!requestedRowId) return () => {
      alive = false;
    };
    void (async () => {
      const stored = await loadPracticeVideoRow(requestedRowId);
      if (!alive) return;
      if (!stored) {
        setErrorLine(VIDEO_MISSING_LINE);
        return;
      }
      /**
       * ── vc52 (B1): THE FILE IS CHECKED BEFORE THE PLAYER IS MOUNTED ─────────
       *
       * The owner pressed "Watch with notes" and got a BLACK SCREEN. The row's
       * `practiceVideo.uri` was handed straight to `<Video>` without ever asking
       * the file system whether the file was still there — `practiceVideoFileExists`
       * has existed in the store since the feature shipped and was called by
       * nothing. A row whose file had gone (evicted, deleted, moved) therefore
       * mounted a player over nothing: an unpainted black rectangle with native
       * controls, and no sentence.
       *
       * Now the file is checked first. A missing file clears the ref (so no player
       * is mounted at all), keeps the take and its exports, and says so.
       */
      const storedRef = stored.practiceVideo ?? null;
      const refUsable = practiceVideoIsUsable(storedRef);
      const fileExists = refUsable ? await practiceVideoFileExists(storedRef.uri) : null;
      if (!alive) return;
      const plan = practiceVideoPlaybackPlan(refUsable, fileExists);
      const ref = plan === 'play' ? storedRef : null;
      if (plan === 'file-missing') setErrorLine(PRACTICE_VIDEO_FILE_GONE_LINE);
      audioUriRef.current = stored.personalMelody?.audioUri ?? null;
      setVideoLoaded(false);
      setRow({
        rowId: stored.id,
        title: stored.title || PRACTICE_VIDEO_ROW_TITLE,
        take: stored.capture ?? null,
        ref,
        audioUri: stored.personalMelody?.audioUri ?? null,
        takeNote: normaliseTakeNote(stored.takeNote),
      });
      setOffsetMs(Math.round(Number(ref?.audioOffsetMs) || 0));
      // The stored clip window (v47 part B) — absent on every older row, which
      // reads back as "the whole take" and changes nothing.
      setTrimSpan(normaliseTrimSpan(ref?.trim ?? null, Math.max(0, Number(ref?.durationSec) || 0)));
      // The row is in hand: this is the playback surface, stated in the phase
      // machine rather than left to a separate flag (v39 fix 3).
      setPhase('playback');
    })();
    return () => {
      alive = false;
    };
  }, [requestedRowId]);

  /**
   * DECISION 1 — BOTH CAPTURES, ONE HANDLER. The audio recorder starts first (if it
   * cannot, DECISION 2's KEEP-SOUND fallback takes over and the camera rolls with
   * its OWN microphone so the video is never silent), then the camera is asked to
   * record, and each side's start stamp is taken as it comes up.
   */
  const startBothCaptures = useCallback(async () => {
    if (armedRef.current || !cameraRef.current) return;
    armedRef.current = true;
    setErrorLine(null);
    setLine(PRACTICE_VIDEO_ARMING_LINE);

    let audioStarted = false;
    try {
      audioStarted = await recorder.startRecording();
    } catch {
      audioStarted = false;
    }
    if (audioStarted) {
      audioStartMsRef.current = Date.now();
      separateTakeRef.current = false;
    } else {
      const failure = recorder.takeStartFailure();
      separateTakeRef.current = true;
      setLine(
        failure ? `${VIDEO_SEPARATE_TAKE_LINE} (${failure.message})` : VIDEO_SEPARATE_TAKE_LINE,
      );
    }

    videoStartMsRef.current = Date.now();
    /**
     * THE TAKE'S OWN START STAMP (vc50). This is what the running clock and the
     * take's stored length are measured from — one stamp, taken once, so no timer
     * and no re-render can move it.
     */
    recordingStartedAtRef.current = videoStartMsRef.current;
    videoFailureRef.current = null;
    stoppingRef.current = false;
    setPhase('recording');
    try {
      /**
       * DECISION 3 — THE CAP IS IN THE CALL. `maxDuration` bounds the filming at
       * three minutes and the camera's own size cap bounds the file, so a device
       * with no clock of ours cannot film forever.
       */
      const recorded = cameraRef.current.recordAsync({
        maxDuration: PRACTICE_VIDEO_MAX_SECONDS,
        maxFileSize: PRACTICE_VIDEO_MAX_FILE_BYTES,
      });
      videoPromiseRef.current = recorded
        .then((result) => {
          videoUriRef.current = result?.uri ?? null;
          if (!videoUriRef.current) videoFailureRef.current = VIDEO_CAPTURE_FAILED_LINE;
        })
        .catch((err: unknown) => {
          /**
           * NO SILENT FAILURE (vc50). This used to be an empty `.catch` that set
           * the uri to null: a camera that refused the take left the screen with
           * no video and no reason, which is the "dead end" the owner hit. The
           * reason is kept and printed on the review surface.
           */
          videoUriRef.current = null;
          videoFailureRef.current = VIDEO_CAPTURE_FAILED_LINE;
          reportAudioFailure({
            source: 'recording',
            reason: 'clip-load',
            detail: usableDetail(err),
          });
        });
    } catch (err) {
      videoUriRef.current = null;
      videoFailureRef.current = VIDEO_CAPTURE_FAILED_LINE;
      reportAudioFailure({
        source: 'recording',
        reason: 'clip-load',
        detail: usableDetail(err),
      });
    }
  }, [recorder]);

  /**
   * ── THE LATEST CALLBACK, AS A REF (vc50 fix 1 & 2 — THE ROOT CAUSE) ─────────
   *
   * `useAudioRecorder()` returns a FRESH object on every render (its `return {}`
   * literal is rebuilt each time, and its live meter re-renders this screen every
   * 200 ms while recording). So every callback built from it — `startBothCaptures`,
   * `handleStop` — has a NEW identity on every render.
   *
   * The count-in and recording timers used to list those callbacks in their
   * dependency arrays. React therefore tore the interval down and rebuilt it on
   * every render, resetting the `started` stamp each time: the countdown repainted
   * its first number forever ("the count timer gets stuck and doesn't count down")
   * and the recording clock stayed at 0:00 for the whole take (so the chosen length
   * never stopped it, and the stored `durationSec` was 0 — which is why the trim
   * window had no timeline).
   *
   * The timers now depend ONLY on the phase, and reach the current callback
   * through these refs. The refs are updated in their own effect, declared before
   * the timers so it runs first, and a timer's first tick is ≥250 ms later.
   */
  const startBothCapturesRef = useRef(startBothCaptures);
  useEffect(() => {
    startBothCapturesRef.current = startBothCaptures;
  }, [startBothCaptures]);

  /**
   * The camera is up (v39 fix 2). Coming up is NOT a reason to film: the owner's
   * report is exactly this — the surface recorded the moment it opened, so the
   * user had no time to turn the phone around. This only arms the Start control.
   */
  const handleCameraReady = useCallback(() => {
    setCameraReady(true);
  }, []);

  /**
   * THE START CONTROL (v39 fix 2, owner 10-11: "there needs to be a start button
   * (there is a stop button) as it starts recording immediately — users will need
   * to manually press start to operate and turn the phone around"). ONE press
   * starts BOTH captures; nothing records before it, and a press while the camera
   * is still coming up says so instead of doing nothing (never a dead button).
   */
  const handleStart = useCallback(() => {
    if (!cameraReady || !cameraRef.current) {
      setErrorLine(PRACTICE_VIDEO_CAMERA_NOT_READY_LINE);
      return;
    }
    setErrorLine(null);
    /**
     * THE COUNT-IN IS A PHASE, NOT A DELAY INSIDE THE CAPTURE (vc49). With a
     * lead-in chosen, Start only moves the screen to `count_in` and RETURNS — the
     * one function that stamps the two clocks and asks the camera to record is
     * not reached until the countdown ends (see the effect below). Nothing is
     * captured during the count-in, so it cannot move the take's start.
     */
    if (countInSec > 0) {
      setCountInLeft(countInSec);
      setPhase('count_in');
      return;
    }
    void startBothCaptures();
  }, [cameraReady, countInSec, startBothCaptures]);

  /**
   * ── THE COUNT-IN ITSELF (vc49) ──────────────────────────────────────────────
   *
   * A visible countdown (the big number the record screen draws) that ends by
   * calling `startBothCaptures()` — the same single entry point the no-count-in
   * path uses, so both captures are stamped together exactly as before. The
   * effect runs ONLY in the `count_in` phase, which is a phase in which no
   * recorder is running: nothing is recorded into the video and no start stamp
   * exists yet, which is what keeps the notes on the video's clock.
   */
  useEffect(() => {
    if (phase !== 'count_in') return undefined;
    /**
     * THE DEADLINE IS ABSOLUTE (vc50 — the fix for "the count timer gets stuck").
     * It is computed ONCE, from the moment this phase was entered, and the number
     * on screen is `countInRemainingSec(deadline, now)`. Nothing here depends on a
     * callback's identity, so a re-render can no longer restart the count — which
     * is exactly what the previous `[phase, countInSec, startBothCaptures]` deps
     * did on every render (see `startBothCapturesRef` above).
     */
    const deadline = countInDeadline(countInSec, Date.now());
    setCountInLeft(countInRemainingSec(deadline, Date.now()));
    const timer = setInterval(() => {
      const left = countInRemainingSec(deadline, Date.now());
      setCountInLeft(left);
      if (left <= 0) {
        clearInterval(timer);
        // The ONE capture entry point, reached only when the count reaches zero.
        startBothCapturesRef.current();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [phase, countInSec]);

  /** Leaving the count-in before it finishes: nothing was captured, nothing lost. */
  const cancelCountIn = useCallback(() => {
    setCountInLeft(0);
    setPhase('permissions');
    setLine(null);
  }, []);

  /**
   * ── THE CAMERA FLIP (vc49, owner 11-03: "i could not turn it around") ───────
   *
   * `facing` is state, so the control turns the camera around both ways. It is
   * LOCKED while a capture is running: changing the camera's facing mid-take
   * re-mounts the preview under the running `recordAsync`, which is exactly the
   * way to lose or corrupt a recording. The control is disabled and says why
   * (`FLIP_LOCKED_LINE`); the handler refuses as well, so a stale press on a
   * disabled-looking control still cannot reach the camera.
   */
  const flipLocked = phase === 'recording' || phase === 'count_in' || phase === 'keeping';

  const handleFlipCamera = useCallback(() => {
    if (flipLocked) return;
    if (facing === 'front') {
      setFacing('back');
    } else {
      setFacing('front');
    }
  }, [facing, flipLocked]);

  /**
   * STOP → KEEP. The camera hands back its file, the audio take is read by the ONE
   * decode seam, the video is copied into the app's documents directory, and the
   * pair is written to History as ONE row.
   */
  const keepTake = useCallback(
    async (audioCacheUri: string | null, pairedSeparately: boolean) => {
      setPhase('keeping');
      setLine(PRACTICE_VIDEO_KEEPING_LINE);
      setErrorLine(null);
      setTakeLine(null);
      setTakeBusy(false);
      const capturedAt = new Date().toISOString();
      const rowId =
        rowIdRef.current ?? melodyRowId(capturedAt, 'practicevideo');
      rowIdRef.current = rowId;
      /**
       * THE TAKE'S LENGTH, MEASURED (vc50). `handleStop` writes this from the start
       * stamp the camera was given, so it is the real length of the take and not
       * whatever the last tick of a timer happened to say.
       */
      const durationSec = Math.max(0, Math.round(Number(elapsedRef.current) || 0));

      // ── PHASE A: THE VIDEO, ONTO THE DISK AND ONTO THE SCREEN ──────────────
      // THE VIDEO IS PERSISTED BEFORE ANY ROW REFERENCES IT (the cache trap).
      let persisted: Awaited<ReturnType<typeof persistPracticeVideo>> = {
        uri: null,
        sizeBytes: null,
        message: PRACTICE_VIDEO_NOT_KEPT_LINE,
      };
      try {
        const videoUri = videoUriRef.current;
        if (videoUri) persisted = await persistPracticeVideo(videoUri, rowId);
      } catch {
        persisted = { uri: null, sizeBytes: null, message: PRACTICE_VIDEO_NOT_KEPT_LINE };
      }

      let audioUri: string | null = null;
      try {
        audioUri = audioCacheUri ? await persistMelodyAudio(audioCacheUri, rowId) : null;
      } catch {
        audioUri = null;
      }
      audioUriRef.current = audioUri;

      const measuredOffsetMs = pairedSeparately
        ? separateTakeOffset()
        : captureSyncOffsetMs({
            videoStartMs: videoStartMsRef.current,
            audioStartMs: audioStartMsRef.current,
          });

      const ref = persisted.uri
        ? practiceVideoRefFromCapture({
            uri: persisted.uri,
            durationSec,
            audioOffsetMs: measuredOffsetMs,
            measuredOffsetMs,
            filmedAt: capturedAt,
            sizeBytes: persisted.sizeBytes,
            pairedSeparately,
          })
        : null;

      let saved: Awaited<ReturnType<typeof savePracticeVideoRow>> = null;
      try {
        saved = await savePracticeVideoRow({
          rowId,
          capturedAt,
          take: null,
          audioUri: audioUriRef.current,
          videoRef: ref,
          title: PRACTICE_VIDEO_ROW_TITLE,
        });
      } catch {
        saved = null;
      }
      /**
       * ── vc52 (A5): THE SAVE IS VERIFIED, AND A FAILED ONE IS LOUD ──────────
       *
       * `savePracticeVideoRow` now reads the row back out of History through the
       * same read the History tab performs, so `saved === null` means the take is
       * NOT in History — not "maybe". That is the state the owner's force-quit
       * test found and the app never told him about: the only signal was one
       * `styles.meta` line, in the same pale blue as the success line.
       *
       * It is now a card with a headline, the reason in full-contrast body text,
       * and a retry that re-runs exactly the same verified write.
       */
      const saveOutcome = practiceVideoSaveState(!!saved);
      setSaveState(saveOutcome);

      /**
       * LAND ON THE REVIEW SURFACE NOW (vc50 — the fix for "not recording takes…
       * nothing shows up once processed… a dead end").
       *
       * The row used to be written only AFTER the audio had been decoded into a
       * take, in one long `await` chain with no try/catch. A decode that threw or
       * never resolved left the screen on "Keeping your video…" for ever, with no
       * video, no notes and no message — the dead end. Now the VIDEO is on screen
       * the moment it is on disk, and the notes arrive underneath it.
       */
      setRow({
        rowId: saved?.id ?? rowId,
        title: PRACTICE_VIDEO_ROW_TITLE,
        take: null,
        ref,
        audioUri: audioUriRef.current,
        takeNote: null,
      });
      setOffsetMs(Math.round(Number(ref?.audioOffsetMs) || 0));
      setVideoLoaded(false);
      setSaveRetrying(false);
      setPhase('review');
      /**
       * The body line is now ONLY the "keeping"/progress text: whether the take is
       * in History is `saveState`'s job, and it is rendered as a card (see the
       * review body). The v51 sentence lived here, in `styles.meta`, and was the
       * whole of the failure signal.
       */
      setLine(null);
      // WHY THERE IS NO VIDEO, WHEN THERE IS NO VIDEO (vc50): the camera's own
      // refusal, said out loud instead of swallowed by an empty `.catch`.
      if (!persisted.uri) setErrorLine(videoFailureRef.current ?? PRACTICE_VIDEO_NOT_KEPT_LINE);

      // ── PHASE B: THE NOTES, BOUNDED AND NEVER SILENT ───────────────────────
      /**
       * ── vc53 (A5): THE VERIFY IS REPEATED AT THE END, NOT ONLY AT THE START ──
       *
       * The read-back inside `savePracticeVideoRow` proves the row was in History
       * when it was written. It cannot prove the row is still there once the take
       * has been attached — and that is exactly the vc52 gap: the save's own
       * read-back passed (so no failure card) and the row was gone by the time
       * History was opened. Every exit from this flow re-reads History through the
       * same read the History tab performs, so a row that did not survive becomes a
       * state the surface shows and the user can retry.
       */
      const verifyAgain = async (): Promise<void> => {
        const stillThere = await practiceVideoRowIsStored(saved?.id ?? rowId);
        setSaveState(practiceVideoSaveState(stillThere));
      };
      if (!audioCacheUri) {
        setTakeLine(VIDEO_TAKE_FAILED_LINE);
        await verifyAgain();
        return;
      }
      setTakeBusy(true);
      setTakeLine(VIDEO_TAKE_READING_LINE);
      let derived: Awaited<ReturnType<typeof deriveCaptureTakeFromRecording>>;
      try {
        derived = await settleWithin(
          deriveCaptureTakeFromRecording({ uri: audioCacheUri, capturedAt }),
          TAKE_DECODE_TIMEOUT_MS,
          { take: null, unavailable: true, message: VIDEO_TAKE_TIMEOUT_LINE },
        );
      } catch {
        derived = { take: null, unavailable: false, message: VIDEO_TAKE_FAILED_LINE };
      }
      setTakeBusy(false);
      const derivedTake = derived.take;
      if (!derivedTake) {
        setTakeLine(derived.message ?? VIDEO_TAKE_FAILED_LINE);
        await verifyAgain();
        return;
      }
      // The take reaches the surface FIRST (so it is never invisible), then the row.
      setRow((current) => (current && !current.take ? { ...current, take: derivedTake } : current));
      const written = await savePracticeVideoTake(rowId, derivedTake);
      setTakeLine(written ? null : VIDEO_TAKE_SAVE_FAILED_LINE);
      await verifyAgain();
    },
    [],
  );

  const handleStop = useCallback(async () => {
    // The auto-stop and the Stop button can both reach this: only the first runs.
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setPhase('keeping');
    try {
      cameraRef.current?.stopRecording();
    } catch {
      // A camera that is already down is not a failure of the take.
    }
    if (videoPromiseRef.current) {
      try {
        await videoPromiseRef.current;
      } catch {
        videoUriRef.current = null;
      }
    }
    /**
     * THE LENGTH OF THE TAKE, MEASURED FROM ITS START STAMP (vc50). The running
     * clock used to be the only writer of `elapsedRef`, and it was reset on every
     * render, so a 40-second take was stored as 0 seconds — which is what left the
     * trim window with no length and no timeline. This is a measurement, not a
     * guess: one stamp, taken when the camera was asked to record.
     */
    const startedAt = recordingStartedAtRef.current || videoStartMsRef.current;
    const filmedSec = startedAt > 0 ? recordingElapsedSec(startedAt, Date.now()) : 0;
    elapsedRef.current = Math.max(Number(elapsedRef.current) || 0, filmedSec);
    setElapsedSec(elapsedRef.current);

    let audio: Awaited<ReturnType<typeof recorder.stopRecording>> = null;
    try {
      audio = await recorder.stopRecording();
    } catch {
      audio = null;
    }
    const stopFailure = audio ? null : recorder.takeStopFailure();
    if (stopFailure) setErrorLine(stopFailure.message);
    const pairedSeparately = separateTakeRef.current;
    try {
      await keepTake(audio?.uri ?? null, pairedSeparately);
    } catch {
      /**
       * NO SILENT FAILURE (vc50). This `await` used to be the last statement of a
       * function the Stop button calls with `void`, so a rejection anywhere in the
       * keep path escaped as an unhandled rejection and left the screen on
       * "Keeping your video…" for ever. It is caught here and said out loud.
       */
      setTakeBusy(false);
      setLine('This take could not be saved to your History.');
      setErrorLine(
        'Your video file, if it was filmed, is still on this device. Nothing else was changed.',
      );
      setPhase('review');
    }
  }, [keepTake, recorder]);

  /**
   * The recording timer's own handle on the CURRENT `handleStop`. Same reason as
   * `startBothCapturesRef`: `handleStop` is rebuilt on every render (it closes over
   * the recorder), so listing it in the timer's dependency array restarted the
   * clock — and the chosen length could never be reached.
   */
  const handleStopRef = useRef(handleStop);
  useEffect(() => {
    handleStopRef.current = handleStop;
  }, [handleStop]);

  /**
   * ── THE RUNNING CLOCK AND THE CHOSEN LENGTH (vc49) ──────────────────────────
   *
   * One timer, two jobs: it draws the running clock (and the remaining time from
   * `recordingProgressLine`) and, when the length the user chose is reached, it
   * stops the take through the SAME `handleStop` the Stop button uses — so the
   * camera is closed, the audio is stopped and the pair is kept exactly as a
   * manual stop does. `autoStopRef` makes that fire once, so a slow tick can
   * never call Stop twice over the same recording.
   *
   * The length is read through `clampRecordingLength`, and the camera's own
   * `maxDuration` stays at `PRACTICE_VIDEO_MAX_SECONDS`: the user's choice is an
   * inner bound, never a way past the 3-minute cap.
   */
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    /**
     * THE CLOCK IS MEASURED FROM THE START STAMP, NOT FROM THIS EFFECT (vc50).
     * `recordingStartedAtRef` was stamped once, in `startBothCaptures`, at the
     * moment the camera was asked to record — so the number on screen (and the
     * length stored on the take) cannot be moved by a re-render, a slow tick or a
     * restarted interval. That is exactly what the old `[phase, recordingLengthSec,
     * handleStop]` deps did: the metering hook re-renders this screen every 200 ms
     * while recording, `handleStop` is rebuilt every render, so the interval was
     * rebuilt every 200 ms and the clock never left 0:00.
     */
    autoStopRef.current = false;
    const startedAt = recordingStartedAtRef.current || Date.now();
    const limit = clampRecordingLength(recordingLengthSec);
    const timer = setInterval(() => {
      const seconds = recordingElapsedSec(startedAt, Date.now());
      elapsedRef.current = seconds;
      setElapsedSec(seconds);
      if (recordingLengthReached(seconds, limit) && !autoStopRef.current) {
        autoStopRef.current = true;
        clearInterval(timer);
        // The take goes to the TRIM step: `handleStop` keeps the pair and the
        // review surface offers the clip, with a line saying why it stopped.
        void handleStopRef.current().then(() => setLine(RECORDING_LENGTH_REACHED_LINE));
      }
    }, 250);
    return () => clearInterval(timer);
  }, [phase, recordingLengthSec]);

  /**
   * DECISION 2's SECOND HALF. The video already carries its own sound; this films
   * nothing more and records ONLY the take, so the notes have a source without the
   * video being silent or the take being invented.
   */
  const recordSeparateTake = useCallback(async () => {
    setErrorLine(null);
    setLine(VIDEO_SEPARATE_TAKE_LINE);
    const started = await recorder.startRecording();
    if (!started) {
      const failure = recorder.takeStartFailure();
      setErrorLine(failure?.message ?? null);
      return;
    }
    const stopped = await recorder.stopRecording();
    if (!stopped) {
      const failure = recorder.takeStopFailure();
      setErrorLine(failure?.message ?? null);
      return;
    }
    await keepTake(stopped.uri, true);
  }, [keepTake, recorder]);

  const handleRecordAgain = useCallback(() => {
    armedRef.current = false;
    rowIdRef.current = null;
    audioUriRef.current = null;
    videoUriRef.current = null;
    videoPromiseRef.current = null;
    separateTakeRef.current = false;
    elapsedRef.current = 0;
    autoStopRef.current = false;
    setRow(null);
    setElapsedSec(0);
    setLine(null);
    setErrorLine(null);
    // A NEW take starts with no window and no label of the old one (vc49: the
    // clip is per-take, so re-filming must not inherit it), and the count-in
    // choice stays as the user left it — it is a preference, not take data.
    setTrimSpan(null);
    setNoteLine(null);
    setCountInLeft(0);
    // vc50: a new take carries none of the last take's outcome — not its notes
    // line, not its decode state, not the camera's old refusal.
    setTakeLine(null);
    setTakeBusy(false);
    videoFailureRef.current = null;
    recordingStartedAtRef.current = 0;
    stoppingRef.current = false;
    setPhase('permissions');
    // The camera remounts with the record body, so it is not ready yet — and the
    // new take still does not film until Start is pressed (v39 fix 2).
    setCameraReady(false);
    setDeletedLine(null);
  }, []);

  // ── PLAYBACK: the overlay's own numbers ─────────────────────────────────────
  const take = row?.take ?? null;
  const ref = row?.ref ?? null;

  /**
   * ── vc53, ITEM 4: WHERE A DRAG ON THE SCRUB BAR LANDS ──────────────────────
   * The bar spans the whole recording and the rule that keeps playback inside the
   * clip is `scrubSeekTargetMs` (services/videoScrub). Both players move through
   * this one callback, so a drag behaves the same on the review page and on the
   * watch page.
   */
  const seekPlayerTo = useCallback(
    (player: Video | null, ms: number) => {
      const durationMs = Math.max(0, Number(ref?.durationSec) || 0) * 1000;
      const target = scrubSeekTargetMs(
        durationMs > 0 ? ms / durationMs : 0,
        durationMs,
        trimSpan,
      );
      setClockMs(target);
      void player?.setPositionAsync(target).catch(() => undefined);
    },
    [ref, trimSpan],
  );

  // DECISION 4: the cues come from the take the EDITOR saved, never a raw trace.
  const cueSet: VideoCueSet = useMemo(
    () =>
      noteCuesForVideo(take, {
        audioOffsetMs: offsetMs,
        videoDurationSec: Math.max(0, Number(ref?.durationSec) || 0),
      }),
    [offsetMs, ref?.durationSec, take],
  );

  /**
   * ── vc54, DEFECT 2 ── WHAT THE LANE SAYS WHEN IT HAS NOTHING TO DRAW.
   *
   * The lane owns no facts: it is handed cues. The surface knows whether the take
   * held no melody at all or held notes that fall outside the video window, so it
   * supplies the sentence (`videoCueEmptyLine`) instead of letting every empty
   * lane claim it heard nothing.
   */
  const cueEmptyLine = useMemo(
    () => videoCueEmptyLine(cueSet) ?? OVERLAY_EMPTY_LINE,
    [cueSet],
  );

  const chordRow = useMemo(() => {
    if (!take) return [];
    const suggestion = suggestedChords(take.notes, take.key);
    return suggestion.chords.map((chord) => chord.name);
  }, [take]);

  const applyOffset = useCallback(
    async (next: number) => {
      // BOUNDED, and it never rewrites a note's times — only the drawing offset.
      const bounded = nudgeOffset(next, 0);
      setOffsetMs(bounded);
      if (row && practiceVideoIsUsable(row.ref)) {
        const updated: PracticeVideoRef = { ...row.ref, audioOffsetMs: bounded };
        setRow({ ...row, ref: updated });
        await attachPracticeVideo(row.rowId, updated);
      }
    },
    [row],
  );

  const setFromFirstNote = useCallback(() => {
    const computed = offsetFromFirstNoteTap({
      tapSec: clockMs / 1000,
      firstOnsetSec: firstOnsetSec(take),
    });
    if (computed === null) {
      setErrorLine('There are no notes in this take to line up yet.');
      return;
    }
    void applyOffset(computed);
  }, [applyOffset, clockMs, take]);

  /**
   * THE ONE MIDI EXPORT (v47 part B). The send sheet hands in the WINDOW's take so
   * the .mid matches the PDF and the video's window; with no window it is exactly
   * the take the surface already exported.
   */
  const shareTakeAsMidi = useCallback(
    async (windowTake?: SavedCaptureTake | null) => {
      const target = windowTake ?? take;
      if (!target || target.notes.length === 0) return;
      setMidiBusy(true);
      setMidiLine(null);
      try {
        const result = await exportCaptureMidiFromTake(target, { title: row?.title });
        setMidiLine(result.message);
      } finally {
        setMidiBusy(false);
      }
    },
    [row?.title, take],
  );

  /**
   * ── vc52 (A5): THE RETRY ─────────────────────────────────────────────────────────
   *
   * A failed save is now visible and actionable. This re-runs the SAME verified
   * write (`savePracticeVideoRow` reads the row back out of History) with the row
   * id, the audio and the video ref the take already has, so a retry can only ever
   * write the take that is on screen — never a second copy, and never a different
   * one.
   */
  const handleSaveRetry = useCallback(async () => {
    if (!row || saveRetrying) return;
    setSaveRetrying(true);
    setErrorLine(null);
    let stored = false;
    try {
      const written = await savePracticeVideoRow({
        rowId: row.rowId,
        capturedAt: row.ref?.filmedAt ?? new Date().toISOString(),
        take: row.take,
        audioUri: row.audioUri,
        videoRef: row.ref,
        title: PRACTICE_VIDEO_ROW_TITLE,
      });
      stored = !!written;
    } catch {
      stored = false;
    }
    setSaveRetrying(false);
    setSaveState(practiceVideoSaveState(stored));
    if (stored && row.take) {
      // The notes belong on the row too, if they were read but never stored.
      await savePracticeVideoTake(row.rowId, row.take);
      setTakeLine(null);
    }
  }, [row, saveRetrying]);

  const handleDeleteVideo = useCallback(async () => {
    if (!row) return;
    const ok = await deletePracticeVideo(row.rowId, row.ref);
    if (!ok) {
      setErrorLine(DELETE_PRACTICE_VIDEO_FAILED_LINE);
      return;
    }
    setRow({ ...row, ref: null });
    setDeletedLine('The video is gone. Your take, its notation and its exports are untouched.');
  }, [row]);

  const handleEditorSaved = useCallback((corrected: SavedCaptureTake) => {
    // The CORRECTED take is the single source of truth the overlay reads.
    setRow((current) => (current ? { ...current, take: corrected } : current));
  }, []);

  /**
   * ── v47 PART B, ITEM 1: OPEN THE SIDE-BY-SIDE COMPARISON ────────────────────
   *
   * The second take comes from the user's OWN History (`listPracticeVideoRows`),
   * never from a placeholder, and the first take is this row's own corrected take
   * and video. When there is no other filmed take the surface is still opened —
   * with the honest one-take line and the way to film a second — so the button can
   * never be a dead end (owner 09-28). Nothing here reads the network: both sides
   * are local files, which is what makes the comparison work in airplane mode.
   */
  const openCompare = useCallback(async () => {
    const rows = await listPracticeVideoRows(row?.rowId ?? null);
    const other = rows[0] ?? null;
    setOtherSide(
      other
        ? {
            label: COMPARE_RIGHT_LABEL,
            ref: other.practiceVideo ?? null,
            take: other.capture ?? null,
            note: normaliseTakeNote(other.takeNote),
          }
        : null,
    );
    setCompareOpen(true);
  }, [row?.rowId]);

  /** The one-take path out of the comparison: film a second take. */
  const handleRecordSecond = useCallback(() => {
    setCompareOpen(false);
    handleRecordAgain();
  }, [handleRecordAgain]);

  /**
   * ── v47 PART B, ITEM 2: THE CLIP ────────────────────────────────────────────
   *
   * The window is stored on the row's practice-video block (it is a window on the
   * VIDEO's clock, so it belongs with the video). Every member of the send pair is
   * derived from this one value in `trimmedSendPair`, so the PDF, the MIDI and the
   * video can never describe different windows.
   */
  const handleSpanChange = useCallback(
    async (next: TakeTrimSpan | null) => {
      if (!row) return;
      const bounded = normaliseTrimSpan(next, Math.max(0, Number(row.ref?.durationSec) || 0));
      setTrimSpan(bounded);
      if (practiceVideoIsUsable(row.ref)) {
        const updated: PracticeVideoRef = { ...(row.ref as PracticeVideoRef), trim: bounded };
        setRow({ ...row, ref: updated });
        await attachPracticeVideo(row.rowId, updated);
      }
    },
    [row],
  );

  /**
   * ── v47 PART B, ITEM 2: THE LABEL ───────────────────────────────────────────
   *
   * The label IS the take's own local text (`takeNote`, services/takeNotes.ts) —
   * the same field the History card edits — saved through the melody store's own
   * write so there is one label per take and nothing is ever generated. A failed
   * write says so and leaves the take untouched.
   */
  const handleNoteChange = useCallback(
    async (next: string) => {
      if (!row) return;
      const cleaned = normaliseTakeNote(next);
      setNoteBusy(true);
      try {
        const ok = await updatePersonalMelodyNote(row.rowId, cleaned);
        if (!ok) {
          setNoteLine(TAKE_TAG_FAILED_LINE);
          return;
        }
        setRow((current) => (current ? { ...current, takeNote: cleaned } : current));
        setNoteLine(cleaned ? TAKE_TAG_SAVED_LINE : TAKE_TAG_CLEARED_LINE);
      } catch {
        setNoteLine(TAKE_TAG_FAILED_LINE);
      } finally {
        setNoteBusy(false);
      }
    },
    [row],
  );

  /**
   * ── vc54, ITEM 3: THE FULLSCREEN CONTROL SITS ON THE VIDEO ────────────
   *
   * The owner: "icon on the video next build". `openFullScreen` is the ONE action
   * behind every fullscreen control on this surface — the icon drawn on the video
   * itself, and the labelled button under it. One action, so the two can never
   * drift into different behaviour, and neither is a dead control.
   */
  const openFullScreen = useCallback(() => setVideoFullOpen(true), []);

  /**
   * THE ICON ON THE VIDEO. A 44 pt square in the video's OWN top-right corner,
   * inside the frame that holds the player, so it can never land on the scrub bar
   * or the notes playhead (both sit UNDER the video). It carries its own label for
   * a screen reader; the labelled button under the video stays for a first-time
   * user who does not know the corner glyph.
   */
  const renderFullScreenIcon = () => (
    <TouchableOpacity
      style={styles.videoFullIcon}
      onPress={openFullScreen}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={FULL_SCREEN_VIDEO_ICON_LABEL}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name={FULL_SCREEN_VIDEO_ICON_NAME} size={20} color="#ffffff" />
    </TouchableOpacity>
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────
  // ONE mode test, off the phase machine (v39 fix 3): `playback` is the phase a
  // History row starts in, so a watch-only row can never render the record body
  // (and never mounts a camera at all).
  if (phase === 'playback') {
    /**
     * ── NOTHING TO WATCH IS SAID, AND HAS A WAY OUT (vc50, defect 5) ──────────
     *
     * The owner: "the user is in the watch with notes page but can't watch
     * anything as there's nothing to watch on the page." This page used to render
     * a generic missing card and then a wall of overlay/transport controls for a
     * video that was not there. It now names which of the three cases it is —
     * no row, no video but a take, nothing at all — and every one of them offers
     * the one move that helps: film a new take.
     */
    const noVideoLine = deletedLine
      ? deletedLine
      : !row
        ? VIDEO_MISSING_LINE
        : take
          ? VIDEO_NOTHING_TO_WATCH_LINE
          : VIDEO_NOTHING_AT_ALL_LINE;
    return (
      <View style={styles.container}>
        {/* vc53, item 2: the page reserves the device's bottom inset, so the last
            control on the watch surface is reachable on a handset with a
            three-button navigation bar. */}
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: tabScreenBottomPadding(insets.bottom) }]}
        >
          <Text style={styles.title}>Watch your practice</Text>
          {ref && practiceVideoIsUsable(ref) ? (
            <>
              {/* vc53, ITEMS 3 AND 4: NO NATIVE TRANSPORT HERE ANY MORE. The native
                  bar's fullscreen icon is the control the owner pressed and nothing
                  happened (pinned expo-av cannot present fullscreen on Android), and
                  its own scrubber would be a second timeline that ignores the trim.
                  This surface now owns all three: play/pause, the scrub bar under
                  the video, and the full-screen window. */}
              <View style={styles.videoFrame}>
              <Video
                ref={videoRef}
                style={styles.video}
                source={{ uri: ref.uri }}
                useNativeControls={false}
                volume={1}
                isMuted={false}
                resizeMode={ResizeMode.CONTAIN}
                progressUpdateIntervalMillis={200}
                onError={(message) => {
                  // A video that cannot be decoded SAYS SO (v40 fix J): never a
                  // black rectangle with a control that does nothing.
                  setVideoLine(VIDEO_PLAYBACK_FAILED_LINE);
                  reportAudioFailure({
                    source: 'take-playback',
                    reason: 'clip-load',
                    detail: usableDetail(message),
                  });
                }}
                onPlaybackStatusUpdate={(status) => {
                  const position = (status as { positionMillis?: number }).positionMillis;
                  if (typeof position === 'number' && Number.isFinite(position)) setClockMs(position);
                  /**
                   * ── vc52 (A4): THE WINDOW IS ENFORCED ON EVERY UPDATE ────────
                   *
                   * v47 only PAUSED at the window's end, and only our own Play
                   * button ever seeked to its start — so the native transport (and
                   * any re-play) ran from 0:00 and the take "plays it back as a
                   * whole video", exactly as the owner reported. One pure rule now
                   * answers for both edges, whatever moved the playhead:
                   *   • before the window  → seek to its first frame;
                   *   • at/past its end    → pause and rewind to the first frame,
                   *                          so the next play is the window again.
                   */
                  if (typeof position === 'number' && Number.isFinite(position)) {
                    const action = trimPlaybackAction(position, trimSpan);
                    if (action.kind === 'seek') {
                      void videoRef.current?.setPositionAsync(action.toMs).catch(() => undefined);
                    } else if (action.kind === 'stop') {
                      void videoRef
                        .current?.pauseAsync()
                        .then(() => videoRef.current?.setPositionAsync(action.toMs))
                        .catch(() => undefined);
                    }
                  }
                  // The button mirrors the PLAYER's own state, never our hope.
                  const playing = (status as { isPlaying?: boolean }).isPlaying === true;
                  setVideoPlaying((current) => (current === playing ? current : playing));
                }}
                onLoad={() => handleVideoLoad()}
                onReadyForDisplay={() => {
                  void restorePlaybackAudioMode();
                }}
              />
              {renderFullScreenIcon()}
              </View>
              {/* OUR OWN TRANSPORT (v40 fix J): the session is re-applied on every
                  press and the outcome is a sentence, not silence. */}
              <View style={styles.syncRow}>
                <TouchableOpacity
                  style={styles.syncBtn}
                  onPress={() => void toggleVideo()}
                  disabled={videoBusy}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={videoPlaying ? VIDEO_PAUSE_CTA : VIDEO_PLAY_CTA}
                >
                  <Text style={styles.syncBtnText}>
                    {videoBusy ? VIDEO_PREPARING_LABEL : videoPlaying ? VIDEO_PAUSE_CTA : VIDEO_PLAY_CTA}
                  </Text>
                </TouchableOpacity>
                {/* ── vc53, ITEM 3: THE FULLSCREEN CONTROL REALLY OPENS SOMETHING ──
                    It opens the in-app window (components/FullScreenVideo), built on
                    the FullScreenScore pattern, because the pinned expo-av cannot
                    present native fullscreen on Android. It is never a dead icon. */}
                <TouchableOpacity
                  style={[styles.syncBtn, styles.fullScreenBtn]}
                  onPress={openFullScreen}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Play this take full screen"
                >
                  <Text style={styles.syncBtnText}>{FULL_SCREEN_VIDEO_CTA}</Text>
                </TouchableOpacity>
              </View>
              {/* ── vc53, ITEM 4: THE SCRUB BAR, UNDER THE VIDEO ──────────────────
                  One timeline over the whole recording; the clip's cut ends are
                  dimmed and a drag into them snaps to the nearest window edge
                  (services/videoScrub). */}
              <ScrubBar
                positionMs={clockMs}
                durationMs={Math.max(0, Number(ref?.durationSec) || 0) * 1000}
                span={trimSpan}
                onSeekMs={(ms) => seekPlayerTo(videoRef.current, ms)}
              />
              {/* ── vc52, ITEM 4: THE CLIP SITS DIRECTLY UNDER THE VIDEO ──────
                  The owner had to scroll away from the video to reach the blue
                  editor panel. On the watch surface the clip was inside the Send-to
                  sheet, so trimming and watching were on different pages; it is now
                  under the player, where the trim can be seen taking effect. */}
              <TakeClipTagEditor
                durationSec={Math.max(0, Number(ref?.durationSec) || 0)}
                span={trimSpan}
                note={row?.takeNote ?? null}
                onSpanChange={(next) => void handleSpanChange(next)}
                onNoteChange={(next) => void handleNoteChange(next)}
                noteLine={noteLine}
                noteBusy={noteBusy}
              />
              {/* WHICH WINDOW PLAYS (vc52, A4). The trim is now enforced on the
                  player, so the surface says which window it is playing — and stays
                  honest that the .mp4 file itself is not cut. */}
              <Text style={styles.windowLine}>
                {trimPlaybackWindowLine(trimSpan, Math.max(0, Number(ref?.durationSec) || 0))}
              </Text>
              {videoLine ? (
                <Text style={styles.honest}>{videoLine}</Text>
              ) : (
                <Text style={styles.meta}>{VIDEO_PLAY_HINT}</Text>
              )}
            </>
          ) : (
            <View style={styles.missingCard}>
              <Text style={styles.missingText}>{noVideoLine}</Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleRecordAgain}
                accessibilityRole="button"
                accessibilityLabel={VIDEO_RECORD_AGAIN_CTA}
              >
                <Text style={styles.secondaryBtnText}>{VIDEO_RECORD_AGAIN_CTA}</Text>
              </TouchableOpacity>
            </View>
          )}

          {practiceVideoTakeLine(take) ? (
            <Text style={styles.meta}>{practiceVideoTakeLine(take)}</Text>
          ) : null}
          {ref ? (
            <Text style={styles.meta}>
              {videoSizeLine(Math.max(0, Number(ref.durationSec) || 0), ref.sizeBytes ?? null)}
            </Text>
          ) : null}
          {/* THE CLIP (v47 part B): what the send pair covers, in one line. */}
          {trimSpanLabel(trimSpan) ? (
            <Text style={styles.meta}>{`Clip: ${trimSpanLabel(trimSpan)}`}</Text>
          ) : null}

          {/* THE OVERLAY: the CORRECTED take's notes and chords, on the video clock.
              vc53, ITEM 7: the red playhead is now the user's — a drag on the box
              moves the video (through the same scrub rule as the bar), and the box
              opens full screen like the video does. */}
          {/* vc55: THE LANE DRAWS ON THE TIMELINE THE CUES WERE MADE ON.
                This used to be the stored `ref.durationSec`, which is 0 for a row
                whose length was never stored - and `overlayLayout` places nothing
                on a zero-length axis, so a take of real notes reached the lane and
                then vanished at the pixel. `cueSet.timelineSec` IS that axis
                (`noteCuesForVideo` returns it), so the notes and the pixels can no
                longer disagree. */}
          <VideoOverlayLane
            cues={cueSet.cues}
            videoDurationSec={cueSet.timelineSec}
            clockMs={clockMs}
            chordRow={chordRow}
            onSeekMs={(ms) => seekPlayerTo(videoRef.current, ms)}
            onExpand={() => setNotesFullOpen(true)}
            emptyLine={cueEmptyLine}
          />
          <Text style={styles.honest}>{VIDEO_SYNC_HONESTY}</Text>
          {videoCueCountLine(cueSet) ? (
            <Text style={styles.meta}>{`${VIDEO_NOTES_DROPPED_LINE} — ${videoCueCountLine(cueSet)}`}</Text>
          ) : null}

          {/* THE BOUNDED HAND ALIGNMENT (DECISION 1's residual error, §3.2/§3.3). */}
          <View style={styles.syncRow}>
            <Text style={styles.syncLabel}>{VIDEO_OFFSET_ROW_LABEL}</Text>
            <TouchableOpacity
              style={styles.syncBtn}
              onPress={() => void applyOffset(nudgeOffset(offsetMs, -VIDEO_OFFSET_NUDGE_MS))}
              accessibilityRole="button"
              accessibilityLabel="Move the notes earlier by a small step"
            >
              <Text style={styles.syncBtnText}>{VIDEO_OFFSET_MINUS_LABEL}</Text>
            </TouchableOpacity>
            <Text style={styles.syncValue}>{formatOffset(offsetMs)}</Text>
            <TouchableOpacity
              style={styles.syncBtn}
              onPress={() => void applyOffset(nudgeOffset(offsetMs, VIDEO_OFFSET_NUDGE_MS))}
              accessibilityRole="button"
              accessibilityLabel="Move the notes later by a small step"
            >
              <Text style={styles.syncBtnText}>{VIDEO_OFFSET_PLUS_LABEL}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.secondaryBtn} onPress={setFromFirstNote}>
            <Text style={styles.secondaryBtnText}>{VIDEO_OFFSET_SET_FROM_FIRST_NOTE_CTA}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => void applyOffset(Math.round(Number(ref?.measuredOffsetMs) || 0))}
          >
            <Text style={styles.secondaryBtnText}>{VIDEO_OFFSET_RESET_CTA}</Text>
          </TouchableOpacity>
          {practiceVideoIsManuallyAligned(row?.ref ?? null) ? (
            <Text style={styles.honest}>{VIDEO_OFFSET_MANUAL_LINE}</Text>
          ) : null}
          {ref?.pairedSeparately ? (
            <Text style={styles.honest}>{VIDEO_SEPARATE_TAKE_LINE}</Text>
          ) : null}
          {deletedLine ? <Text style={styles.meta}>{deletedLine}</Text> : null}

          {/* STILL NOTATION, unchanged: the editor's own staff of the same take. */}
          {take && take.notes.length > 0 ? (
            <TakeStaffCard
              take={take}
              chordNames={chordRow}
              chordHonestLine={null}
              title={PRACTICE_VIDEO_ROW_TITLE}
              interactive={false}
              onExpand={() => setTakeExpanded(true)}
            />
          ) : null}

          {/* THE FULL-SCREEN TAKE (v43 slice 3, item E7). Same window, same box,
              same affordance as every other notation surface; the card inside is
              plain (no `onExpand`) so the modal never carries a second button. */}
          <FullScreenScore
            visible={takeExpanded && !!take && take.notes.length > 0}
            onClose={() => setTakeExpanded(false)}
            title={PRACTICE_VIDEO_ROW_TITLE}
          >
            <ScrollView contentContainerStyle={[styles.expandedBody, { minHeight: expandBoxHeight }]}>
              {take ? (
                <TakeStaffCard
                  take={take}
                  chordNames={chordRow}
                  chordHonestLine={null}
                  title={PRACTICE_VIDEO_ROW_TITLE}
                  interactive={false}
                />
              ) : null}
            </ScrollView>
          </FullScreenScore>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setEditorOpen(true)}
            disabled={!take}
            accessibilityRole="button"
            accessibilityLabel="Correct the notes of this take"
          >
            <Text style={styles.primaryBtnText}>{'Correct the notes ›'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setSendOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={MIDI_EXPORT_LABEL}
          >
            <Text style={styles.primaryBtnText}>{'Send to…'}</Text>
          </TouchableOpacity>
          {/* ── v47 PART B, ITEM 1: the side-by-side comparison ──────────────── */}
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => void openCompare()}
            accessibilityRole="button"
            accessibilityLabel={COMPARE_CTA}
          >
            <Text style={styles.secondaryBtnText}>{COMPARE_CTA}</Text>
          </TouchableOpacity>
          {practiceVideoIsUsable(ref) ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => void handleDeleteVideo()}>
              <Text style={styles.secondaryBtnText}>{'Delete the video'}</Text>
            </TouchableOpacity>
          ) : null}
          {line ? <Text style={styles.meta}>{line}</Text> : null}
          {errorLine ? <Text style={styles.error}>{errorLine}</Text> : null}
          {onClose ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
              <Text style={styles.secondaryBtnText}>{'← Back'}</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>

        <TakeCorrectionEditor
          visible={editorOpen && !!take}
          take={take}
          rowId={row?.rowId ?? null}
          audioUri={row?.audioUri ?? null}
          frames={null}
          onSaved={handleEditorSaved}
          onClose={() => setEditorOpen(false)}
        />
        <PracticeVideoSendToSheet
          visible={sendOpen}
          record={{ video: ref, take, note: row?.takeNote ?? null }}
          trimSpan={trimSpan}
          durationSec={Math.max(0, Number(ref?.durationSec) || 0)}
          title={row?.title ?? PRACTICE_VIDEO_ROW_TITLE}
          onSendMidi={shareTakeAsMidi}
          midiBusy={midiBusy}
          midiLine={midiLine}
          onSpanChange={(next) => void handleSpanChange(next)}
          onNoteChange={(next) => void handleNoteChange(next)}
          noteLine={noteLine}
          noteBusy={noteBusy}
          onClose={() => setSendOpen(false)}
        />
        {/* ── v47 PART B, ITEM 1: TWO TAKES, SIDE BY SIDE ──────────────────────
            Mounted HERE, on the playback path the user walks, and handed this
            row's own video ref + corrected take plus the second take read from
            History. Both are local files, so the comparison needs no network. */}
        <PracticeVideoCompare
          visible={compareOpen}
          left={{ label: COMPARE_LEFT_LABEL, ref: row?.ref ?? null, take, note: row?.takeNote ?? null }}
          right={otherSide}
          onRecordSecond={handleRecordSecond}
          onClose={() => setCompareOpen(false)}
        />
        {/* ── vc53, ITEM 3: THE VIDEO, FULL SCREEN ─────────────────────────────
            An in-app window, not `presentFullscreenPlayer()`: the pinned expo-av
            documents that call as iOS-only, so on Android it is a no-op — which is
            exactly why the native fullscreen icon "did nothing". The window plays
            the same local file with the same trim window in force. */}
        <FullScreenVideo
          visible={videoFullOpen}
          uri={ref && practiceVideoIsUsable(ref) ? ref.uri : null}
          span={trimSpan}
          startMs={clockMs}
          title={row?.title ?? PRACTICE_VIDEO_ROW_TITLE}
          onClose={() => setVideoFullOpen(false)}
        />
        {/* ── vc53, ITEM 7: THE NOTES BOX, FULL SCREEN ─────────────────────────
            The same window the take's staff already opens (`FullScreenScore`), the
            same lane element, a taller box — plus the scrub bar, so the playhead
            can still be moved while the box fills the screen. */}
        <FullScreenScore
          visible={notesFullOpen}
          onClose={() => setNotesFullOpen(false)}
          title={OVERLAY_LANE_LABEL}
          subtitle={trimSpanLabel(trimSpan)}
        >
          <ScrollView contentContainerStyle={[styles.expandedBody, { minHeight: expandBoxHeight }]}>
            {/* vc55: THE LANE DRAWS ON THE TIMELINE THE CUES WERE MADE ON.
                This used to be the stored `ref.durationSec`, which is 0 for a row
                whose length was never stored - and `overlayLayout` places nothing
                on a zero-length axis, so a take of real notes reached the lane and
                then vanished at the pixel. `cueSet.timelineSec` IS that axis
                (`noteCuesForVideo` returns it), so the notes and the pixels can no
                longer disagree. */}
            <VideoOverlayLane
              cues={cueSet.cues}
              videoDurationSec={cueSet.timelineSec}
              clockMs={clockMs}
              chordRow={chordRow}
              laneHeight={OVERLAY_LANE_HEIGHT * 2}
              onSeekMs={(ms) => seekPlayerTo(videoRef.current, ms)}
              emptyLine={cueEmptyLine}
            />
            <ScrubBar
              positionMs={clockMs}
              durationMs={Math.max(0, Number(ref?.durationSec) || 0) * 1000}
              span={trimSpan}
              onSeekMs={(ms) => seekPlayerTo(videoRef.current, ms)}
            />
          </ScrollView>
        </FullScreenScore>
      </View>
    );
  }

  // ── RECORD MODE ────────────────────────────────────────────────────────────
  if (!permission || (!permission.granted && phase === 'permissions')) {
    return (
      <View style={styles.container}>
        <View style={styles.body}>
          <Text style={styles.title}>{PRACTICE_VIDEO_SCREEN_TITLE}</Text>
          <Text style={styles.honest}>{PRACTICE_VIDEO_PERMISSION_LINE}</Text>
          <Text style={styles.honest}>{VIDEO_RECORD_HONESTY}</Text>
          <Text style={styles.honest}>{VIDEO_STAYS_ON_PHONE_LINE}</Text>
          <Text style={styles.honest}>{PRACTICE_VIDEO_MAX_LINE}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => void requestPermission()}
            accessibilityRole="button"
            accessibilityLabel="Allow the camera and microphone"
          >
            <Text style={styles.primaryBtnText}>{'Allow camera and microphone'}</Text>
          </TouchableOpacity>
          {permission && !permission.canAskAgain ? (
            <Text style={styles.error}>{PRACTICE_VIDEO_PERMISSION_DENIED_LINE}</Text>
          ) : null}
          {onClose ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
              <Text style={styles.secondaryBtnText}>{'← Back'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* vc53, item 2: the record/review page reserves the device's bottom inset,
          so "Send to…" and the trim's last control are never under the bar. */}
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: tabScreenBottomPadding(insets.bottom) }]}
      >
        <Text style={styles.title}>{PRACTICE_VIDEO_SCREEN_TITLE}</Text>
        <Text style={styles.honest}>{VIDEO_RECORD_HONESTY}</Text>
        <Text style={styles.honest}>{VIDEO_STAYS_ON_PHONE_LINE}</Text>
        <Text style={styles.honest}>{PRACTICE_VIDEO_MAX_LINE}</Text>

        {phase !== 'review' ? (
          <View style={styles.preview}>
            {/* vc49: `facing` is STATE, never a literal — the owner's report was
                "i could not turn it around to face me". `mode="video"` and the
                single-mic audio path are untouched. */}
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              mode="video"
              facing={facing}
              mute={false}
              onCameraReady={handleCameraReady}
            />
          </View>
        ) : null}

        {/* ── vc49: THE CAMERA FLIP (owner 11-03) ──────────────────────────────
            Visible whenever the preview is up, DISABLED while a capture is
            running (or counting in): flipping mid-take re-mounts the preview
            under a running `recordAsync`, which loses the recording. The line
            under it says which way the camera is pointing, and while it is
            locked it says why. */}
        {phase !== 'review' ? (
          <View style={styles.flipRow}>
            <TouchableOpacity
              style={[styles.flipBtn, flipLocked && styles.flipBtnOff]}
              onPress={handleFlipCamera}
              disabled={flipLocked}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={FLIP_CAMERA_CTA}
              accessibilityHint={FLIP_CAMERA_HINT}
              accessibilityState={{ disabled: flipLocked }}
            >
              <Text style={styles.flipBtnText}>{FLIP_CAMERA_CTA}</Text>
            </TouchableOpacity>
            <Text style={styles.flipLine}>
              {flipLocked ? FLIP_LOCKED_LINE : facing === 'front' ? CAMERA_FRONT_LINE : CAMERA_BACK_LINE}
            </Text>
          </View>
        ) : null}

        {/* ── vc53, ITEM 5: THE START CONTROL, DIRECTLY UNDER THE FLIP ─────────
            The owner: move the record/start button "up, directly under the Flip
            camera button", keep it green, and make it larger and round. It stays
            in the same phase and calls the same `handleStart`, so the count-in and
            the one-press-start-both-captures behaviour are untouched; only where
            it sits and how big it is changed. The round visual system is the
            designer's pass — this is a plain larger round button so the layout is
            right and a restyle cannot move anything. */}
        {phase === 'permissions' ? (
          <TouchableOpacity
            style={styles.startBtnRound}
            onPress={handleStart}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={PRACTICE_VIDEO_START_CTA}
            accessibilityHint={PRACTICE_VIDEO_START_HINT}
          >
            <Text style={styles.startBtnRoundText}>{PRACTICE_VIDEO_START_CTA}</Text>
          </TouchableOpacity>
        ) : null}

        {phase === 'permissions' ? (
          <>
            <Text style={styles.meta}>{PRACTICE_VIDEO_START_LINE}</Text>
            <Text style={styles.honest}>{PRACTICE_VIDEO_START_HINT}</Text>

            {/* ── vc49: THE COUNT-IN AND THE RECORDING LENGTH ─────────────────
                Both are chosen BEFORE Start, on the surface the user is already
                looking at, and both are bounded by pure rules in
                services/practiceRecordingOptions.ts. */}
            <View style={styles.optionBlock}>
              <Text style={styles.optionLabel}>{COUNT_IN_LABEL}</Text>
              <View style={styles.chipRow}>
                {COUNT_IN_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={`countin-${option}`}
                    style={[styles.chip, countInSec === option && styles.chipOn]}
                    onPress={() => setCountInSec(normaliseCountIn(option))}
                    accessibilityRole="button"
                    accessibilityLabel={`Count-in ${countInLabel(option)}`}
                    accessibilityState={{ selected: countInSec === option }}
                  >
                    <Text style={styles.chipText}>{countInLabel(option)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.honest}>{COUNT_IN_HINT}</Text>

              <Text style={styles.optionLabel}>{RECORDING_LENGTH_LABEL}</Text>
              <View style={styles.chipRow}>
                {RECORDING_LENGTH_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={`length-${option}`}
                    style={[styles.chip, recordingLengthSec === clampRecordingLength(option) && styles.chipOn]}
                    onPress={() => setRecordingLengthSec(clampRecordingLength(option))}
                    accessibilityRole="button"
                    accessibilityLabel={`Record for ${recordingLengthLabel(option)}`}
                    accessibilityState={{ selected: recordingLengthSec === clampRecordingLength(option) }}
                  >
                    <Text style={styles.chipText}>{recordingLengthLabel(option)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.honest}>{RECORDING_LENGTH_HINT}</Text>
            </View>
            {/* vc53, ITEM 5: the Start control now sits ABOVE this block, directly
                under the Flip camera button (see the round green button above). */}
          </>
        ) : null}
        {/* ── vc49: THE COUNT-IN, ON SCREEN (owner 11-03) ──────────────────────
            A large, unmistakable countdown. It is deliberately VISIBLE rather
            than audible: the app plays no click track, and a sound here would be
            captured by the same microphone the take is recorded with. Nothing is
            recorded during this phase, so the count can never land in the video
            or move the take's start. */}
        {phase === 'count_in' ? (
          <>
            <Text style={styles.countInBig}>{String(countInLeft)}</Text>
            <Text style={styles.timer}>{countInCountdownLine(countInLeft)}</Text>
            <Text style={styles.honest}>{COUNT_IN_HONESTY}</Text>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={cancelCountIn}
              accessibilityRole="button"
              accessibilityLabel={COUNT_IN_CANCEL_CTA}
            >
              <Text style={styles.secondaryBtnText}>{COUNT_IN_CANCEL_CTA}</Text>
            </TouchableOpacity>
          </>
        ) : null}
        {phase === 'recording' ? (
          <>
            <Text style={styles.meta}>{PRACTICE_VIDEO_RECORDING_LINE}</Text>
            {/* vc49: the running clock, then how much of the CHOSEN length is
                left, then the cap line the screen has always shown. */}
            <Text style={styles.timer}>{recordingClock(elapsedSec)}</Text>
            <Text style={styles.meta}>{recordingProgressLine(elapsedSec, recordingLengthSec)}</Text>
            <Text style={styles.timer}>{practiceVideoRemainingLine(elapsedSec)}</Text>
            {practiceVideoNeedsWarning(elapsedSec) ? (
              <Text style={styles.warn}>
                {'Past a minute — the practice video stops itself at three minutes.'}
              </Text>
            ) : null}
            <View style={styles.levelRow}>
              {recorder.liveLevels.slice(-LIVE_LEVEL_BARS).map((level, index) => (
                <View
                  key={`level-${index}`}
                  style={[styles.levelBar, { height: levelHeight(level) }]}
                />
              ))}
            </View>
            <TouchableOpacity
              style={styles.stopBtn}
              onPress={() => void handleStop()}
              accessibilityRole="button"
              accessibilityLabel="Stop filming"
            >
              <Text style={styles.stopBtnText}>{PRACTICE_VIDEO_STOP_CTA}</Text>
            </TouchableOpacity>
          </>
        ) : null}
        {phase === 'keeping' ? (
          <>
            <ActivityIndicator color={theme.accent} />
            <Text style={styles.meta}>{line ?? PRACTICE_VIDEO_KEEPING_LINE}</Text>
          </>
        ) : null}

        {phase === 'review' ? (
          <>
            <Text style={styles.title}>{VIDEO_REVIEW_TITLE}</Text>
            {/* ── vc52 (A5): WHAT ACTUALLY HAPPENED TO THE SAVE ───────────────
                v51 printed a reassuring sentence whenever the write function
                returned anything — and that function could not report a failure.
                The line now comes from the VERIFIED outcome: a saved take says so,
                and a take that is not in History gets a loud card with a retry.
                `line` keeps only the keeping/progress text. */}
            {line ? <Text style={styles.meta}>{line}</Text> : null}
            {saveState && !saveState.saved ? (
              <View style={styles.saveFailedCard}>
                <Text style={styles.saveFailedHeadline}>{PRACTICE_VIDEO_SAVE_FAILED_HEADLINE}</Text>
                <Text style={styles.saveFailedText}>{saveState.line}</Text>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => void handleSaveRetry()}
                  disabled={saveRetrying}
                  accessibilityRole="button"
                  accessibilityLabel={PRACTICE_VIDEO_SAVE_RETRY_CTA}
                >
                  <Text style={styles.primaryBtnText}>
                    {saveRetrying ? VIDEO_PREPARING_LABEL : PRACTICE_VIDEO_SAVE_RETRY_CTA}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {saveState && saveState.saved ? (
              <Text style={styles.meta}>{saveState.line}</Text>
            ) : null}
            {!saveState && !row ? (
              <Text style={styles.meta}>{'Nothing was saved from this take.'}</Text>
            ) : null}

            {/* ── vc50: THE TAKE ITSELF, ON THIS SURFACE ────────────────────────
                The owner: "Once video is taken, a large blue screen pops in
                another window up obscuring the video." Two things were true. The
                notes editor used to slide in over this surface by itself (that
                auto-open is gone — see `keepTake`), and this surface showed no
                video of its own, so what filled the space was a panel with
                nothing in it. The take the user just filmed is now rendered
                here, with its own length under it, before anything else. */}
            {practiceVideoIsUsable(ref) ? (
              <>
                {/* vc53, ITEMS 3 AND 4: the review page gets the same three controls
                    as the watch page — our own transport, the scrub bar with the
                    trim's cut ends dimmed, and the full-screen window. The native
                    bar is off because its fullscreen icon does nothing on Android
                    with the pinned expo-av, and its scrubber ignored the trim. */}
                <View style={styles.videoFrame}>
                <Video
                  ref={reviewVideoRef}
                  style={styles.video}
                  source={{ uri: ref.uri }}
                  useNativeControls={false}
                  volume={1}
                  isMuted={false}
                  resizeMode={ResizeMode.CONTAIN}
                  progressUpdateIntervalMillis={200}
                  onError={() => setVideoLine(VIDEO_PLAYBACK_FAILED_LINE)}
                  onLoad={() => handleVideoLoad()}
                  onReadyForDisplay={() => {
                    void restorePlaybackAudioMode();
                  }}
                  onPlaybackStatusUpdate={(status) => {
                    const position = (status as { positionMillis?: number }).positionMillis;
                    if (typeof position !== 'number' || !Number.isFinite(position)) return;
                    setClockMs(position);
                    // The SAME window rule as the watch page: a trim set here is in
                    // force here, whichever control moved the playhead.
                    const action = trimPlaybackAction(position, trimSpan);
                    if (action.kind === 'seek') {
                      void reviewVideoRef.current?.setPositionAsync(action.toMs).catch(() => undefined);
                    } else if (action.kind === 'stop') {
                      void reviewVideoRef.current
                        ?.pauseAsync()
                        .then(() => reviewVideoRef.current?.setPositionAsync(action.toMs))
                        .catch(() => undefined);
                    }
                  }}
                />
                {renderFullScreenIcon()}
                </View>
                <View style={styles.syncRow}>
                  <TouchableOpacity
                    style={styles.syncBtn}
                    onPress={openFullScreen}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Play this take full screen"
                  >
                    <Text style={styles.syncBtnText}>{FULL_SCREEN_VIDEO_CTA}</Text>
                  </TouchableOpacity>
                </View>
                <ScrubBar
                  positionMs={clockMs}
                  durationMs={Math.max(0, Number(ref?.durationSec) || 0) * 1000}
                  span={trimSpan}
                  onSeekMs={(ms) => seekPlayerTo(reviewVideoRef.current, ms)}
                />
                <Text style={styles.meta}>
                  {videoSizeLine(Math.max(0, Number(ref?.durationSec) || 0), ref?.sizeBytes ?? null)}
                </Text>
                <Text style={styles.honest}>{VIDEO_REVIEW_VIDEO_LINE}</Text>
                {/* vc52 (B1): until a frame is decoded the player is a black
                    rectangle — so the surface says what is happening. */}
                {!videoLoaded ? <Text style={styles.meta}>{VIDEO_LOADING_LINE}</Text> : null}
                {videoLine ? <Text style={styles.error}>{videoLine}</Text> : null}
              </>
            ) : (
              <View style={styles.missingCard}>
                <Text style={styles.missingText}>
                  {videoFailureRef.current ?? PRACTICE_VIDEO_NOT_KEPT_LINE}
                </Text>
              </View>
            )}

            {/* ── vc52, ITEM 4: THE TRIM SITS DIRECTLY UNDER THE VIDEO ────────
                The owner: "The blue video editor panel needs to be closer to the
                captured video screen … you have to scroll too far down away from
                the video to start editing using the blue box." It was BELOW the
                staff card — the tallest thing on the page — so the editor was a
                screenful away. The order is now video → clip → notes/score, which
                is also the order the user works in. Same control, same state, same
                persisted write as before: only its position changed. */}
            {practiceVideoIsUsable(ref) ? (
              <>
                <TakeClipTagEditor
                  durationSec={Math.max(0, Number(ref?.durationSec) || 0)}
                  span={trimSpan}
                  note={row?.takeNote ?? null}
                  onSpanChange={(next) => void handleSpanChange(next)}
                  onNoteChange={(next) => void handleNoteChange(next)}
                  noteLine={noteLine}
                  noteBusy={noteBusy}
                />
                {/* WHICH WINDOW PLAYS (vc52, A4) — said on the surface, so a trim
                    that is in force is visible and the file's own limit is honest. */}
                <Text style={styles.windowLine}>
                  {trimPlaybackWindowLine(trimSpan, Math.max(0, Number(ref?.durationSec) || 0))}
                </Text>
              </>
            ) : null}

            {/* THE NOTES (vc50): read off the take's sound, bounded, and never a
                silent wait — "reading", then either the staff or the reason. The
                score sits BELOW the clip now (owner: "the notation score recorded
                can go lower in the page"). */}
            {takeBusy ? <Text style={styles.meta}>{VIDEO_TAKE_READING_LINE}</Text> : null}
            {!takeBusy && takeLine ? <Text style={styles.honest}>{takeLine}</Text> : null}
            {!takeBusy && !takeLine && !take ? (
              <Text style={styles.honest}>{VIDEO_TAKE_FAILED_LINE}</Text>
            ) : null}
            {take && take.notes.length > 0 ? (
              <TakeStaffCard
                take={take}
                chordNames={chordRow}
                chordHonestLine={null}
                title={PRACTICE_VIDEO_ROW_TITLE}
                interactive={false}
              />
            ) : null}
            {/* ── vc54, DEFECT 2: THE EMPTY TAKE IS NEVER A DEAD END ──────────────
                This action used to be rendered ONLY when the app's own recorder
                had failed to start (`separateTakeRef`), which is not the only way a
                filmed take comes back with no notes: the camera and the app's
                recorder share one microphone, and on the handset the filmed take's
                audio can arrive silent — the owner's "I have tried x3 takes — all
                shows the same error message", with no way forward on the screen.
                The one path that provably reads notes on a phone is a take recorded
                with the camera OFF, so it is offered whenever the take has no notes
                — and it is written onto THIS row (the same row id), so the notes
                land under this video. */}
            {!take && !takeBusy ? (
              <>
                <Text style={styles.honest}>{VIDEO_TAKE_ON_ITS_OWN_LINE}</Text>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => void recordSeparateTake()}
                  accessibilityRole="button"
                  accessibilityLabel={VIDEO_TAKE_ON_ITS_OWN_CTA}
                >
                  <Text style={styles.primaryBtnText}>{VIDEO_TAKE_ON_ITS_OWN_CTA}</Text>
                </TouchableOpacity>
              </>
            ) : null}

            {/* ── vc52, ITEM 4: the trim used to sit HERE, below the staff card.
                It now sits directly under the video (see above), so the editor is
                one glance from the take it edits instead of a screenful away. */}

            {/* The notes editor is one press below the trim (it used to open
                itself over this surface, which is what hid the clip). */}
            {take ? (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => setEditorOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Correct the notes of this take"
              >
                <Text style={styles.secondaryBtnText}>{'Correct the notes ›'}</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => {
                // Straight into the playback phase: the take is saved, so this is
                // the watch surface, never the record flow (v39 fix 3).
                setPhase('playback');
              }}
              accessibilityRole="button"
              accessibilityLabel={PRACTICE_VIDEO_DONE_CTA}
            >
              <Text style={styles.primaryBtnText}>{PRACTICE_VIDEO_DONE_CTA}</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {phase === 'start_failed' ? (
          <Text style={styles.error}>{PRACTICE_VIDEO_START_FAILED_LINE}</Text>
        ) : null}
        {phase === 'blocked' ? (
          <>
            <Text style={styles.error}>{PRACTICE_VIDEO_PERMISSION_DENIED_LINE}</Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={recorder.openSettings}>
              <Text style={styles.secondaryBtnText}>{PRACTICE_VIDEO_OPEN_SETTINGS_CTA}</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {recorder.error && phase !== 'keeping' ? (
          <Text style={styles.error}>{recorder.error}</Text>
        ) : null}
        {errorLine ? <Text style={styles.error}>{errorLine}</Text> : null}

        <TouchableOpacity style={styles.secondaryBtn} onPress={handleRecordAgain}>
          <Text style={styles.secondaryBtnText}>{PRACTICE_VIDEO_RECORD_AGAIN_CTA}</Text>
        </TouchableOpacity>
        {onClose ? (
          <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
            <Text style={styles.secondaryBtnText}>{'← Back'}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      <TakeCorrectionEditor
        visible={editorOpen && !!take}
        take={take}
        rowId={row?.rowId ?? null}
        audioUri={row?.audioUri ?? null}
        frames={null}
        onSaved={handleEditorSaved}
        onClose={() => setEditorOpen(false)}
      />
      {/* vc53, ITEM 3: the review page's own full-screen window, on the same
          in-app Modal as the watch page's (never `presentFullscreenPlayer()`). */}
      <FullScreenVideo
        visible={videoFullOpen}
        uri={ref && practiceVideoIsUsable(ref) ? ref.uri : null}
        span={trimSpan}
        startMs={clockMs}
        title={PRACTICE_VIDEO_ROW_TITLE}
        onClose={() => setVideoFullOpen(false)}
      />
    </View>
  );
};

/** How many live meter bars the record screen draws (the window's own meter). */
const LIVE_LEVEL_BARS = 16;

/** A dB reading mapped to a bar height — clamped, never NaN. */
function levelHeight(level: number): number {
  const value = Number(level);
  if (!Number.isFinite(value)) return 4;
  const normalised = Math.min(1, Math.max(0, (value + 60) / 60));
  return 4 + Math.round(normalised * 40);
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#12122b' },
  body: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },
  /** The full-screen take's own scrolling body (v43 slice 3, item E7). */
  expandedBody: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '800', marginBottom: 8 },
  honest: { color: '#9aa0b5', fontSize: 12, lineHeight: 18, marginTop: 6 },
  meta: { color: '#cfe4ff', fontSize: 13, lineHeight: 19, marginTop: 10 },
  error: { color: '#ffb4b4', fontSize: 12, lineHeight: 18, marginTop: 10 },
  /**
   * ── vc52 STYLES ──────────────────────────────────────────────────────
   * `windowLine` states which window the player is playing (A4). The save-failure
   * card is a CARD, not a body line: the owner's A5 loss was invisible partly
   * because its only signal was one 12px line in the pale body colour.
   * Every literal below is one `services/themeApply.ts` knows, so light mode
   * repaints all of them (scripts/vc52DeviceRepairs.test.ts measures the ratios).
   */
  windowLine: { color: '#cfe4ff', fontSize: 13, fontWeight: '700', lineHeight: 19, marginTop: 8 },
  saveFailedCard: {
    backgroundColor: '#1b2a4a',
    borderColor: '#e94560',
    borderWidth: 2,
    borderRadius: 12,
    padding: 16,
    marginTop: 14,
  },
  saveFailedHeadline: { color: '#ff6b6b', fontSize: 16, fontWeight: '800', marginBottom: 6 },
  saveFailedText: { color: '#cfe4ff', fontSize: 13, lineHeight: 19 },
  warn: { color: '#ffd166', fontSize: 12, marginTop: 8 },
  timer: { color: '#ffffff', fontSize: 16, fontWeight: '700', marginTop: 10 },
  preview: {
    height: OVERLAY_LANE_HEIGHT * 2,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 14,
    backgroundColor: '#000000',
  },
  camera: { flex: 1 },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 48,
    marginTop: 12,
  },
  levelBar: {
    width: 4,
    marginRight: 3,
    backgroundColor: '#4ecdc4',
    borderRadius: 2,
  },
  video: { width: '100%', height: 220, backgroundColor: '#000000', borderRadius: 12 },
  /**
   * ── vc54, ITEM 3: THE FRAME AROUND THE PLAYER ────────────────────
   * The video and the icon on it are one box, so the icon's `position: 'absolute'`
   * is measured against the VIDEO's corner, never the page.
   */
  videoFrame: { position: 'relative', width: '100%' },
  /**
   * THE ICON: 44 × 44 pt (the smallest comfortable touch target), pinned to the
   * video's TOP-RIGHT corner and never to its bottom — the scrub bar and the notes
   * playhead sit UNDER the video, so a top-anchored overlay cannot cover either.
   */
  videoFullIcon: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  missingCard: {
    backgroundColor: '#1b2a4a',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  missingText: { color: '#cfe4ff', fontSize: 13, lineHeight: 19 },
  syncRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  /** vc53 item 3 — the fullscreen control sits beside Play, not under it. */
  fullScreenBtn: { marginLeft: 10 },
  /**
   * vc53 item 5 — THE START CONTROL: larger, round and green, directly under the
   * Flip camera button. `minHeight`/`minWidth` keep it tappable at the WCAG size;
   * the round system is the designer's pass, so nothing here depends on the shape.
   */
  startBtnRound: {
    alignSelf: 'center',
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2ecc71',
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 8,
  },
  startBtnRoundText: { color: '#0b1a12', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  syncLabel: { color: '#9aa0b5', fontSize: 12, marginRight: 10 },
  syncBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f4370',
    backgroundColor: '#1b2a4a',
  },
  syncBtnText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  syncValue: { color: '#ffffff', fontSize: 13, marginHorizontal: 12, minWidth: 84, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 10,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    paddingHorizontal: 16,
  },
  primaryBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: '#1b2a4a',
    borderColor: '#2f4370',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingHorizontal: 16,
  },
  secondaryBtnText: { color: '#cfe4ff', fontSize: 14, fontWeight: '600' },
  stopBtn: {
    backgroundColor: '#e94560',
    borderRadius: 999,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  stopBtnText: { color: '#ffffff', fontSize: 17, fontWeight: '800' },
  /** The Start control (v39 fix 2) — the same big, obvious shape as Stop. */
  startBtn: {
    backgroundColor: '#2fbf71',
    borderRadius: 999,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  startBtnText: { color: '#06210f', fontSize: 17, fontWeight: '800' },
  /** vc49: the camera flip — visible whenever the preview is up. */
  flipRow: { marginTop: 10 },
  flipBtn: {
    backgroundColor: '#1b2a4a',
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  /** Locked while a capture is running: dimmed, disabled, and explained. */
  flipBtnOff: { opacity: 0.45, borderColor: '#2f4370' },
  flipBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  flipLine: { color: '#9aa0b5', fontSize: 12, lineHeight: 18, marginTop: 6 },
  /** vc49: the count-in and recording-length choices. */
  optionBlock: { marginTop: 16 },
  optionLabel: { color: '#ffffff', fontSize: 13, fontWeight: '800', marginTop: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  chip: {
    minWidth: 64,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1b2a4a',
    borderColor: '#2f4370',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  chipOn: { borderColor: '#4ecdc4', backgroundColor: '#12243a' },
  chipText: { color: '#cfe4ff', fontSize: 13, fontWeight: '700' },
  /** The count-in's big number — visible from across the room. */
  countInBig: {
    color: '#4ecdc4',
    fontSize: 72,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 18,
  },
});
