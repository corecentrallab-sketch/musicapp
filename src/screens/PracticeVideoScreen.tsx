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
import { Video } from 'expo-av';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { restorePlaybackAudioMode } from '../services/audioSession';
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
  type PracticeVideoRef,
} from '../services/practiceVideoRef';
import {
  PRACTICE_VIDEO_KEEPING_LINE,
  PRACTICE_VIDEO_NOT_KEPT_LINE,
  attachPracticeVideo,
  deletePracticeVideo,
  loadPracticeVideoRow,
  persistPracticeVideo,
  savePracticeVideoRow,
} from '../services/practiceVideoStore';
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
  captureSyncOffsetMs,
  firstOnsetSec,
  formatOffset,
  noteCuesForVideo,
  nudgeOffset,
  offsetFromFirstNoteTap,
  separateTakeOffset,
  videoCueCountLine,
  videoSizeLine,
  type VideoCueSet,
} from '../services/videoTakeSync';
import { OVERLAY_LANE_HEIGHT } from '../components/VideoOverlayLane';
import { VideoOverlayLane } from '../components/VideoOverlayLane';
import { PracticeVideoSendToSheet } from '../components/PracticeVideoSendToSheet';
import { TakeStaffCard } from '../components/TakeStaffCard';
import { TakeCorrectionEditor } from '../components/TakeCorrectionEditor';

/** Where the record flow is. */
export type PracticeVideoPhase =
  | 'permissions'
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
}

export const PracticeVideoScreen: React.FC<PracticeVideoScreenProps> = ({
  rowId: requestedRowId = null,
  onClose,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const recorder = useAudioRecorder();
  const cameraRef = useRef<CameraView>(null);

  // WHERE THE MODE STARTS: a History row means playback, no row means film.
  const [row, setRow] = useState<PracticeTakeRow | null>(null);
  const [playing, setPlaying] = useState<boolean>(!!requestedRowId);
  const [phase, setPhase] = useState<PracticeVideoPhase>('permissions');
  const [line, setLine] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [midiBusy, setMidiBusy] = useState(false);
  const [midiLine, setMidiLine] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(0);
  const [offsetMs, setOffsetMs] = useState(0);
  const [deletedLine, setDeletedLine] = useState<string | null>(null);

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
      const ref = stored.practiceVideo ?? null;
      audioUriRef.current = stored.personalMelody?.audioUri ?? null;
      setRow({
        rowId: stored.id,
        title: stored.title || PRACTICE_VIDEO_ROW_TITLE,
        take: stored.capture ?? null,
        ref,
        audioUri: stored.personalMelody?.audioUri ?? null,
      });
      setOffsetMs(Math.round(Number(ref?.audioOffsetMs) || 0));
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
        })
        .catch(() => {
          videoUriRef.current = null;
        });
    } catch {
      videoUriRef.current = null;
    }
  }, [recorder]);

  /** The camera is up: only then is there something to film with. */
  const handleCameraReady = useCallback(() => {
    void startBothCaptures();
  }, [startBothCaptures]);

  /** The running clock, the remaining time and the hard stop at the cap. */
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const started = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.round((Date.now() - started) / 1000);
      elapsedRef.current = seconds;
      setElapsedSec(seconds);
    }, 500);
    return () => clearInterval(timer);
  }, [phase]);

  /**
   * STOP → KEEP. The camera hands back its file, the audio take is read by the ONE
   * decode seam, the video is copied into the app's documents directory, and the
   * pair is written to History as ONE row.
   */
  const keepTake = useCallback(
    async (audioCacheUri: string | null, pairedSeparately: boolean) => {
      setPhase('keeping');
      setLine(PRACTICE_VIDEO_KEEPING_LINE);
      const capturedAt = new Date().toISOString();
      const rowId =
        rowIdRef.current ?? melodyRowId(capturedAt, 'practicevideo');
      rowIdRef.current = rowId;

      // THE VIDEO IS PERSISTED BEFORE ANY ROW REFERENCES IT (the cache trap).
      const videoUri = videoUriRef.current;
      const persisted = videoUri
        ? await persistPracticeVideo(videoUri, rowId)
        : { uri: null, sizeBytes: null, message: PRACTICE_VIDEO_NOT_KEPT_LINE };

      let take: SavedCaptureTake | null = null;
      let takeLine: string | null = null;
      if (audioCacheUri) {
        const audioUri = await persistMelodyAudio(audioCacheUri, rowId);
        audioUriRef.current = audioUri;
        const derived = await deriveCaptureTakeFromRecording({ uri: audioCacheUri, capturedAt });
        take = derived.take;
        takeLine = derived.message;
      }

      const measuredOffsetMs = pairedSeparately
        ? separateTakeOffset()
        : captureSyncOffsetMs({
            videoStartMs: videoStartMsRef.current,
            audioStartMs: audioStartMsRef.current,
          });

      const ref = persisted.uri
        ? practiceVideoRefFromCapture({
            uri: persisted.uri,
            durationSec: elapsedRef.current,
            audioOffsetMs: measuredOffsetMs,
            measuredOffsetMs,
            filmedAt: capturedAt,
            sizeBytes: persisted.sizeBytes,
            pairedSeparately,
          })
        : null;

      const saved = await savePracticeVideoRow({
        rowId,
        capturedAt,
        take,
        audioUri: audioUriRef.current,
        videoRef: ref,
        title: PRACTICE_VIDEO_ROW_TITLE,
      });

      const nextRow: PracticeTakeRow = {
        rowId: saved?.id ?? rowId,
        title: PRACTICE_VIDEO_ROW_TITLE,
        take,
        ref,
        audioUri: audioUriRef.current,
      };
      setRow(nextRow);
      setOffsetMs(Math.round(Number(ref?.audioOffsetMs) || 0));
      setPhase('review');
      setLine(
        saved
          ? take
            ? null
            : VIDEO_TAKE_FAILED_LINE
          : 'Could not write this practice recording into your History — your video is still on this device.',
      );
      setErrorLine(takeLine);
      if (!persisted.uri) setErrorLine(PRACTICE_VIDEO_NOT_KEPT_LINE);
      if (take && saved) setEditorOpen(true);
    },
    [],
  );

  const handleStop = useCallback(async () => {
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
    const audio = await recorder.stopRecording();
    const stopFailure = audio ? null : recorder.takeStopFailure();
    if (stopFailure) setErrorLine(stopFailure.message);
    const pairedSeparately = separateTakeRef.current;
    await keepTake(audio?.uri ?? null, pairedSeparately);
  }, [keepTake, recorder]);

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
    setRow(null);
    setElapsedSec(0);
    setLine(null);
    setErrorLine(null);
    setPlaying(false);
    setPhase('permissions');
    setDeletedLine(null);
  }, []);

  // ── PLAYBACK: the overlay's own numbers ─────────────────────────────────────
  const take = row?.take ?? null;
  const ref = row?.ref ?? null;

  // DECISION 4: the cues come from the take the EDITOR saved, never a raw trace.
  const cueSet: VideoCueSet = useMemo(
    () =>
      noteCuesForVideo(take, {
        audioOffsetMs: offsetMs,
        videoDurationSec: Math.max(0, Number(ref?.durationSec) || 0),
      }),
    [offsetMs, ref?.durationSec, take],
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

  const shareTakeAsMidi = useCallback(async () => {
    if (!take || take.notes.length === 0) return;
    setMidiBusy(true);
    setMidiLine(null);
    try {
      const result = await exportCaptureMidiFromTake(take, { title: row?.title });
      setMidiLine(result.message);
    } finally {
      setMidiBusy(false);
    }
  }, [row?.title, take]);

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

  // ── RENDER ─────────────────────────────────────────────────────────────────
  if (playing) {
    const missing = !!row && !practiceVideoIsUsable(row.ref) && !deletedLine;
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>Watch your practice</Text>
          {ref && practiceVideoIsUsable(ref) ? (
            <Video
              style={styles.video}
              source={{ uri: ref.uri }}
              useNativeControls
              resizeMode="contain"
              progressUpdateIntervalMillis={200}
              onPlaybackStatusUpdate={(status) => {
                const position = (status as { positionMillis?: number }).positionMillis;
                if (typeof position === 'number' && Number.isFinite(position)) setClockMs(position);
              }}
              onReadyForDisplay={() => {
                void restorePlaybackAudioMode();
              }}
            />
          ) : (
            <View style={styles.missingCard}>
              <Text style={styles.missingText}>{deletedLine ?? VIDEO_MISSING_LINE}</Text>
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

          {/* THE OVERLAY: the CORRECTED take's notes and chords, on the video clock. */}
          <VideoOverlayLane
            cues={cueSet.cues}
            videoDurationSec={Math.max(0, Number(ref?.durationSec) || 0)}
            clockMs={clockMs}
            chordRow={chordRow}
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
            />
          ) : null}

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
          record={{ video: ref, take }}
          title={row?.title ?? PRACTICE_VIDEO_ROW_TITLE}
          onSendMidi={shareTakeAsMidi}
          midiBusy={midiBusy}
          midiLine={midiLine}
          onClose={() => setSendOpen(false)}
        />
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
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{PRACTICE_VIDEO_SCREEN_TITLE}</Text>
        <Text style={styles.honest}>{VIDEO_RECORD_HONESTY}</Text>
        <Text style={styles.honest}>{VIDEO_STAYS_ON_PHONE_LINE}</Text>
        <Text style={styles.honest}>{PRACTICE_VIDEO_MAX_LINE}</Text>

        {phase !== 'review' ? (
          <View style={styles.preview}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              mode="video"
              facing="back"
              mute={false}
              onCameraReady={handleCameraReady}
            />
          </View>
        ) : null}

        {phase === 'permissions' ? (
          <Text style={styles.meta}>{PRACTICE_VIDEO_START_LINE}</Text>
        ) : null}
        {phase === 'recording' ? (
          <>
            <Text style={styles.meta}>{PRACTICE_VIDEO_RECORDING_LINE}</Text>
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
            <ActivityIndicator color="#e94560" />
            <Text style={styles.meta}>{line ?? PRACTICE_VIDEO_KEEPING_LINE}</Text>
          </>
        ) : null}

        {phase === 'review' ? (
          <>
            <Text style={styles.meta}>{line ?? 'Saved to your History.'}</Text>
            {!take ? (
              <>
                <Text style={styles.honest}>{VIDEO_TAKE_FAILED_LINE}</Text>
                {separateTakeRef.current ? (
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => void recordSeparateTake()}
                    accessibilityRole="button"
                    accessibilityLabel="Record the take now"
                  >
                    <Text style={styles.primaryBtnText}>{'Record the take now'}</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : null}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => {
                setPlaying(true);
                setPhase('permissions');
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
  title: { color: '#ffffff', fontSize: 22, fontWeight: '800', marginBottom: 8 },
  honest: { color: '#9aa0b5', fontSize: 12, lineHeight: 18, marginTop: 6 },
  meta: { color: '#cfe4ff', fontSize: 13, lineHeight: 19, marginTop: 10 },
  error: { color: '#ffb4b4', fontSize: 12, lineHeight: 18, marginTop: 10 },
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
  missingCard: {
    backgroundColor: '#1b2a4a',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  missingText: { color: '#cfe4ff', fontSize: 13, lineHeight: 19 },
  syncRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
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
});
