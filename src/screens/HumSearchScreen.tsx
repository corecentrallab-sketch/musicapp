/**
 * HumSearchScreen — the melody-capture FLOW (owner 10-02, rank-2 creator's tool;
 * "Melody Idea Capture"). Tapping hum/whistle/sing anywhere in the app lands
 * here, and what it renders is the full-screen capture window
 * (src/components/MelodyCaptureWindow.tsx): the mic is ALREADY live, the VU
 * meter is moving with the user's voice, and the take becomes the result IN
 * PLACE when it ends.
 *
 * WHAT THIS FILE OWNS (the window owns only the drawing):
 *
 *   1. THE TAP → RECORDING. `handleStart` runs on mount, so the window opens
 *      recording rather than asking for a second tap. A failed start is NEVER
 *      silent (the PR #115 rule): it lands on the honest error card below, via
 *      `humStartFailureOutcome()` — the same contract the modern flow uses.
 *
 *   2. THE TAKE, THE SOUND AND THE ROW. On stop, the recording is copied out of
 *      the recorder's cache into the app's documents directory (melodyStore) and
 *      READ through the app's one decode seam (captureMidiExport.
 *      deriveCaptureTakeFromRecording → coachCapture → pitchDetection →
 *      buildCaptureTake) — the same reading "Export MIDI" has always used. The
 *      take is written into History immediately as a PERSONAL MELODY (title "My
 *      melody", composer "Personal melody", id `melody-…`, the sound's URI in
 *      the row), so the user's tune is never lost and History can re-open it.
 *      The analysis (sequence, key, suggested chords) is decided by the pure
 *      module src/services/melodyCapture.ts and rendered by the window.
 *
 *   3. THE BONUS MATCH. The hum pass against OUR melody catalog still runs, and
 *      a confident hit is a BONUS on top of the take: the piece is saved to
 *      History (recognition counts as practice), its identity is shown in the
 *      window, and the ONE shared result surface opens with the hosted score.
 *      A MISS IS NOT A DEAD END — the window has already shown and saved the
 *      user's own melody, and the miss adds the honest "we don't hold that one"
 *      line plus the HUM → MODERN bridge (owner-approved 09-22) and the retry.
 *
 *   4. THE USER'S OWN TAKE, ALWAYS. Every note, key and chord in this flow comes
 *      from the take the user just made; chords are labelled "Suggested" and the
 *      cleaned sequence is labelled "Auto-cleaned". A modern-song match never
 *      renders generated notation for the song (standing rule) — a modern route
 *      is only ever the bridge OUT of here, into the licensed-retailer flow.
 *
 *   5. RE-OPENING A SAVED MELODY. History hands this screen a row (`reopen`), and
 *      the same window shows that take again — no recorder, no matching. A
 *      melody whose sound was kept but could not be read gets a real "try reading
 *      it again" action instead of a dead end.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useHardwareBack } from '../hooks/useHardwareBack';
import { fetchPieceById, humToSearch } from '../services/api';
import { humOutcome, humPhraseHint, humNoMatchMessage, type HumOutcome } from '../services/tier1';
import {
  HUM_RETRY_CTA,
  HUM_TO_MODERN_BLURB,
  HUM_TO_MODERN_CTA,
  humStartFailureOutcome,
} from '../services/humBridge';
// The hum result is mapped into the app's OWN recognition-response shape
// (frontDoor.humMatchToResultResponse) so the ONE result surface renders it — the
// function owns the honesty rules (public domain, therefore no purchase_url) and
// takes the hosted score the catalog resolved for this piece, when there is one.
import {
  humMatchToResultResponse,
  type HumResolvedSheet,
} from '../services/frontDoor';
import { saveRecognition } from '../services/storage';
import {
  deriveCaptureTakeFromRecording,
  exportCaptureMidiFromRecording,
  exportCaptureMidiFromTake,
} from '../services/captureMidiExport';
import {
  persistMelodyAudio,
  savePersonalMelodyRow,
  updatePersonalMelodyTake,
} from '../services/melodyStore';
// The detected key of the exported take, as text — "Key: G major" — or null when
// the take had no detected key. The window renders the line; the export outcome
// carries it, and the take's own key is what the analysis above shows.
import { keyCaption } from '../services/keyDetection';
import {
  ANALYSING_LINE,
  ANALYSING_SUBLINE,
  buildMelodyAnalysis,
  melodyRowId,
  personalMelodyFromRow,
  type MelodyAnalysis,
  type MelodyWindowCopy,
} from '../services/melodyCapture';
import {
  MelodyCaptureWindow,
  type MelodyWindowPhase,
} from '../components/MelodyCaptureWindow';
// The shared result surface (bundle A): the ONE card every recognition outcome
// lands on. Mounted here as an overlay — the capture window stays mounted
// underneath, so closing the card reveals the user's own melody again.
import { RecognitionResultView } from '../components/RecognitionResultView';
// THE TAKE AS NOTATION (v33 §C): the staff card the capture window renders in
// its `staff` slot — the dimmed raw trace, the "auto-clean ✦" divider and the
// crisp auto-cleaned line, with the take's SUGGESTED chords above the staff.
import { TakeStaffCard } from '../components/TakeStaffCard';
// THE TAKE-CORRECTION EDITOR (v33 §D): the full-screen surface that corrects the
// notes, pitch, timing and chords of THIS take. It saves through the one seam
// (services/correctedTakeStore), and the flow re-reads the corrected take so the
// sequence, the key, the chords, the MIDI export and History all show it.
import { TakeCorrectionEditor } from '../components/TakeCorrectionEditor';
import type { RecognitionResponse, SavedPiece } from '../types';
import type { SavedCaptureTake } from '../services/midiExport';

/** Auto-stop after this long so the melody extractor gets enough signal. */
const RECORDING_TIMEOUT_MS = 12000;

/**
 * The capture window's copy (owner 10-02). The three lines below each name ALL
 * THREE accepted input modes — hum, whistle AND sing — because this one capture
 * takes any of them (RC v28 Test 4b: a singer is recording a melody, not a hum).
 * They are declared HERE, in the flow that renders them, because this is the
 * capture surface the front-door copy contract reads.
 */
const CAPTURE_HEADLINE = 'Hum, whistle or sing the melody';
const CAPTURE_INTRO =
  'Hum, whistle or sing the tune you hear in your head — NoteSnap writes it down for you.';
const CAPTURE_HINT = 'Hum, whistle or sing a phrase — around 12 seconds is plenty.';
const RECORDING_LINE = 'Recording your melody...';

const CAPTURE_COPY: MelodyWindowCopy = {
  headline: CAPTURE_HEADLINE,
  intro: CAPTURE_INTRO,
  hint: CAPTURE_HINT,
  recordingLine: RECORDING_LINE,
  analysingLine: ANALYSING_LINE,
  analysingSubline: ANALYSING_SUBLINE,
};

/**
 * 'review' is the window showing the take's own result (its sequence, key and
 * suggested chords); 'no-match' is that SAME window with the library pass's miss
 * held for the separate "Find this melody ›" step; 'error' is a capture that
 * could not be made at all. There is deliberately no stage that renders a result
 * card of its own — the ONE result surface (bundle A) is what shows a match, so
 * a second card can never come back.
 *
 * v33 §B (owner device-pass 10-03): the miss NO LONGER RENDERS ON THE CAPTURE
 * PAGE. `'no-match'` is the state the pass reached; the card itself lives in the
 * overlay below and is opened only by the user's own "Find this melody ›" tap, so
 * the page under it stays capture-only.
 */
type Stage = 'recording' | 'analysing' | 'review' | 'no-match' | 'error';

/**
 * The separate "Find this melody ›" step's own state: `idle` before/after the
 * pass, `checking` while it is in flight (the page's button says so), `hit` once
 * the ONE result surface holds the match.
 */
type MatchState = 'idle' | 'checking' | 'hit';

interface HumSearchScreenProps {
  onClose: () => void;
  /** The HUM → MODERN bridge: leave this flow and open the modern "Find any
   *  song" screen (its own recorder), which identifies the actual recording via
   *  the licensed fingerprint service and links the official sheet music.
   *  Offered on the library-miss card so a hum miss is never a dead end.
   *
   *  REQUIRED, like the modern flow's own levers: a host that opens the capture
   *  window must decide where a library miss goes. History's re-open passes a
   *  close-the-window handler (a re-opened melody has no library pass to miss,
   *  so that card never renders there) rather than leaving the route undefined. */
  onSwitchToModern: () => void;
  /** A personal melody from History: show that take again instead of recording. */
  reopen?: SavedPiece | null;
}

export const HumSearchScreen: React.FC<HumSearchScreenProps> = ({
  onClose,
  onSwitchToModern,
  reopen,
}) => {
  const recorder = useAudioRecorder();
  const [stage, setStage] = useState<Stage>('recording');
  const [outcome, setOutcome] = useState<HumOutcome | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hub, setHub] = useState<string | undefined>(undefined);
  // The RESULT the shared surface renders (bundle A).
  const [humResult, setHumResult] = useState<RecognitionResponse | null>(null);
  // The take the user just recorded: its own URI (what "Export MIDI" serializes)
  // and the kept copy of it in the app's documents directory.
  const [takeUri, setTakeUri] = useState<string | null>(null);
  const [take, setTake] = useState<SavedCaptureTake | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string>('');
  const [analysis, setAnalysis] = useState<MelodyAnalysis | null>(null);
  /**
   * THE TAKE-CORRECTION EDITOR'S state (v33 §D). While it is open the flow holds
   * the take it was handed; when the user SAVES, the corrected take replaces it
   * here, so the sequence, the staff, the key, the chords, the MIDI export and
   * the History row all move together — one take, one source of truth.
   */
  const [editorOpen, setEditorOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exportKey, setExportKey] = useState<string | null>(null);
  const [matchLine, setMatchLine] = useState<string | null>(null);
  // The separate "Find this melody ›" step (v33 §B): its state, and whether the
  // user has actually opened it (a miss may NEVER render on the capture page).
  const [matchState, setMatchState] = useState<MatchState>('idle');
  const [findOpen, setFindOpen] = useState(false);
  const [findNote, setFindNote] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopInFlightRef = useRef(false);
  // The saved melody this screen was opened from, when History re-opened one.
  const reopenedRow = useMemo(() => (reopen ? personalMelodyFromRow(reopen) : null), [reopen]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // ── RE-OPENING A SAVED MELODY ─────────────────────────────────
  // No recorder, no library pass: the row already carries the take and the
  // sound. A row whose sound was kept but never read (the decoder was down when
  // it was captured) shows the honest "could not read it" state with a real
  // "try reading it again" action, so the user's own file is never a dead end.
  useEffect(() => {
    if (!reopenedRow) return;
    setTake(reopenedRow.take);
    setAudioUri(reopenedRow.audioUri);
    setTakeUri(reopenedRow.audioUri);
    setCapturedAt(reopenedRow.capturedAt);
    setAnalysis(buildMelodyAnalysis(reopenedRow.take, { unavailable: !reopenedRow.take }));
    setSaved(!!reopenedRow.take);
    setStage('review');
  }, [reopenedRow]);

  /**
   * The library pass (the BONUS). Skipped when the take held nothing readable —
   * there is no melody to match, and the window already says so.
   *
   * A hit: the piece is saved to History (recognition counts as practice), its
   * identity is shown in the window, and the ONE result surface opens with the
   * hosted score when the catalog has one. A miss: the window keeps the user's
   * melody and the library-miss card appears with the retry and the bridge.
   * A failed request is neither: the take stands, and the window says the
   * library could not be checked.
   */
  const handleMatch = useCallback(async (uri: string, skip: boolean) => {
    if (skip) {
      // Nothing readable in the take: there is no melody to check, and the page
      // already says so. The step stays available for a re-read take.
      setMatchState('idle');
      return;
    }
    setMatchState('checking');
    setFindNote(null);
    try {
      const resp = await humToSearch(uri);
      const res = humOutcome(resp);
      setHub(humPhraseHint(resp));
      setOutcome(res);
      if (res.ok && res.topMatch) {
        await saveRecognition({
          id: res.topMatch.piece_id,
          title: res.topMatch.title,
          composer: res.topMatch.composer,
          savedAt: new Date().toISOString(),
        });
        // THE HOSTED SCORE, best effort (bundle A): a HumMatch carries identity
        // only, so we look the piece up in OUR catalog to get the score the
        // shared surface renders INLINE. A miss is not an error — the surface
        // then says honestly that it holds no score for this one.
        let sheet: HumResolvedSheet | null = null;
        const info = await fetchPieceById(res.topMatch.piece_id);
        if (info) {
          sheet = {
            sheetMusicUrl: info.sheetMusicUrl,
            // The catalog's own gate. `?? undefined` keeps a MISSING flag
            // missing (the surface only withholds the score on an explicit
            // false — never because we dropped the value on the way through).
            sheetMusicAvailable: info.sheetMusicAvailable ?? undefined,
            isPublicDomain: info.isPublicDomain ?? undefined,
          };
        }
        setMatchLine(`That's ${res.topMatch.title} — it's in our free library.`);
        setHumResult(humMatchToResultResponse(resp, res.matches, sheet));
        setMatchState('hit');
      } else {
        // THE MISS, HELD FOR THE EXPLICIT STEP (v33 §B.1). Only a window that has
        // FINISHED its take may record the miss (a late answer must never
        // interrupt a new recording) — and it draws NOTHING here: the card is in
        // the overlay below, opened by the user's own "Find this melody ›" tap.
        setStage((previous) => (previous === 'review' ? 'no-match' : previous));
        setMatchState('idle');
      }
    } catch {
      setMatchState('idle');
      setFindNote('We could not check the library just now — your melody is saved either way.');
    }
  }, []);

  /**
   * THE EXPLICIT "Find this melody ›" STEP (v33 §B.2). This is the ONLY door from
   * the capture page to a matching result: a hit opens the shared result surface,
   * a miss opens the honest miss card — both as overlays over the take, never as
   * boxes inside it. The take is already saved either way, so this step can never
   * be a dead end: closing it reveals the user's own melody again.
   */
  const handleFindMelody = useCallback(() => {
    if (matchState === 'checking') return;
    if (matchState === 'hit' && humResult) {
      setHumResult(humResult);
      return;
    }
    if (stage === 'no-match') {
      setFindOpen(true);
      return;
    }
    setFindNote('There is nothing to check yet — record a melody first.');
  }, [humResult, matchState, stage]);

  /**
   * Stop the take and turn it into the user's own melody. The ORDER matters:
   * the sound is kept first (it is the one thing that cannot be recreated), then
   * it is read, then the row is written — and only then is the library asked.
   */
  const handleStop = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (stopInFlightRef.current) return;
    stopInFlightRef.current = true;
    try {
      const stopped = await recorder.stopRecording();
      if (!stopped) {
        recorder.clearError();
        setStage('error');
        setErrorMessage('Recording failed — please try again.');
        return;
      }
      // The take we can export later, and the stamp every part of the row uses.
      setTakeUri(stopped.uri);
      setStage('analysing');
      setSaveNote(null);
      setExportNote(null);
      setExportKey(null);
      setMatchLine(null);
      const stamp = new Date().toISOString();
      setCapturedAt(stamp);
      const rowId = melodyRowId(stamp);

      // 1. THE SOUND: copy it out of the recorder's cache so it survives.
      const keptUri = await persistMelodyAudio(stopped.uri, rowId);
      setAudioUri(keptUri);

      // 2. THE READING: the same decode seam Export MIDI has always used.
      const derived = await deriveCaptureTakeFromRecording({
        uri: stopped.uri,
        capturedAt: stamp,
      });
      const analysed = buildMelodyAnalysis(derived.take, { unavailable: derived.unavailable });
      setTake(derived.take);
      setAnalysis(analysed);
      setStage('review');

      // 3. THE ROW: the melody lands in History the moment it exists.
      if (analysed.canSave) {
        const row = await savePersonalMelodyRow({
          rowId,
          capturedAt: stamp,
          take: derived.take,
          audioUri: keptUri,
        });
        setSaved(!!row);
        if (!row) {
          setSaveNote('Could not write this melody into your History — tap Save melody to try again.');
        } else if (!keptUri) {
          setSaveNote(
            'Saved to your History. The recording itself could not be kept on this device, so re-opening this melody will read the take instead.',
          );
        }
      } else {
        setSaveNote(analysed.disabledReason);
      }

      // 4. THE BONUS: the library pass, on top of the take. Never required.
      void handleMatch(stopped.uri, analysed.state !== 'ready');
    } catch (err) {
      recorder.completeRecording();
      setStage('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      stopInFlightRef.current = false;
    }
  }, [handleMatch, recorder]);

  /**
   * Open the capture: the flow starts the mic itself (owner 10-02 — the window
   * opens RECORDING, not waiting for a second tap).
   */
  const handleStart = useCallback(async () => {
    if (recorder.isRecording) {
      void handleStop();
      return;
    }
    setErrorMessage(null);
    setOutcome(null);
    const started = await recorder.startRecording();
    if (!started) {
      // NEVER a silent dead end (the PR #115 rule, now applied here too). The
      // pre-fix code did `if (!started) return;`, which set NOTHING: no error
      // card, no message, no retry — the screen simply sat there and ate taps.
      const failedStart = humStartFailureOutcome(recorder.takeStartFailure());
      if (!failedStart.keepHookError) recorder.clearError();
      setErrorMessage(failedStart.message);
      setStage(failedStart.stage);
      return;
    }
    setStage('recording');
    setElapsedMs(0);
    timeoutRef.current = setTimeout(() => {
      void handleStop();
    }, RECORDING_TIMEOUT_MS);
  }, [handleStop, recorder]);

  // THE WINDOW OPENS LISTENING. Tapping the hum entry anywhere in the app mounts
  // this screen, and the recording starts here — no intermediate idle screen.
  useEffect(() => {
    if (reopenedRow) return;
    void handleStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The elapsed clock the window shows next to the LIVE badge.
  useEffect(() => {
    if (stage !== 'recording' || !recorder.isRecording) return;
    const startedAt = Date.now() - elapsedMs;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, recorder.isRecording]);

  /** Record another take, straight into the same window. */
  const handleRetry = useCallback(() => {
    setOutcome(null);
    setHumResult(null);
    setAnalysis(null);
    setTake(null);
    setEditorOpen(false);
    setAudioUri(null);
    setTakeUri(null);
    setSaved(false);
    setSaveNote(null);
    setExportNote(null);
    setExportKey(null);
    setMatchLine(null);
    setMatchState('idle');
    setFindOpen(false);
    setFindNote(null);
    setErrorMessage(null);
    setElapsedMs(0);
    recorder.resetForRetry();
    setStage('recording');
    setTimeout(() => {
      void handleStart();
    }, 300);
  }, [handleStart, recorder]);

  /**
   * "Export MIDI": the user's own take as a Standard MIDI File, through the
   * existing Batch A path. A take recorded HERE is exported from the recording
   * itself (the raw take, unchanged); a re-opened melody whose sound could not be
   * kept exports the take the row already carries — exactly what the History row
   * does. Every outcome is surfaced; a take with no melody says so.
   */
  const handleExportMidi = useCallback(async () => {
    if (exporting) return;
    if (analysis && !analysis.canExportMidi) {
      setExportNote(analysis.disabledReason);
      return;
    }
    setExporting(true);
    setExportNote(null);
    setExportKey(null);
    try {
      if (take) {
        // THE TAKE THIS PAGE SHOWS IS WHAT GETS EXPORTED (v33 §D). Re-decoding the
        // recording here would silently export the PRE-correction take, so the
        // displayed take (which the editor's corrections are written into) is the
        // source of truth for the export, exactly as it is for History.
        const result = await exportCaptureMidiFromTake(take, { title: analysis?.rowTitle });
        setExportNote(result.message);
        setExportKey(keyCaption(result.key));
      } else if (takeUri) {
        const result = await exportCaptureMidiFromRecording({ uri: takeUri });
        setExportNote(result.message);
        // The key the FILE was written in (the SMF key-signature verdict), or
        // null when the take was too thin to name one.
        setExportKey(keyCaption(result.key));
        if (result.status === 'exported' && result.take && analysis) {
          // Keep the take on the saved row so History can export it again
          // (offline, no re-decode). A missing row is not a failure.
          await updatePersonalMelodyTake(analysis.rowId, result.take);
        }
      } else if (take) {
        const result = await exportCaptureMidiFromTake(take, { title: analysis?.rowTitle });
        setExportNote(result.message);
        setExportKey(keyCaption(result.key));
      } else {
        setExportNote('Record a take first — then we can write it out as MIDI.');
      }
    } catch (err) {
      setExportNote(
        err instanceof Error && err.message
          ? err.message
          : 'Could not write the MIDI file on this device — please try again.',
      );
    } finally {
      setExporting(false);
    }
  }, [analysis, exporting, take, takeUri]);

  /**
   * Read a SAVED melody again (the re-open path for a take whose sound was kept
   * but never read). On success the take is written onto the same row, so the
   * user's melody gains its notes without ever leaving History.
   */
  const handleReanalyse = useCallback(async () => {
    if (!analysis || !audioUri) return;
    setStage('analysing');
    setSaveNote(null);
    const stamp = capturedAt || take?.capturedAt || new Date().toISOString();
    const derived = await deriveCaptureTakeFromRecording({ uri: audioUri, capturedAt: stamp });
    const analysed = buildMelodyAnalysis(derived.take, { unavailable: derived.unavailable });
    setTake(derived.take);
    setAnalysis(analysed);
    setStage('review');
    if (analysed.canSave) {
      const stored = await updatePersonalMelodyTake(analysis.rowId, derived.take);
      setSaved(stored);
      if (!stored) setSaveNote('Tap Save melody to keep this reading of your melody.');
    } else {
      setSaveNote(analysed.disabledReason);
    }
  }, [analysis, audioUri, capturedAt, take]);

  // Android hardware BACK (in-place flow — owner bug class 09-23). This screen
  // is not a route and not a modal: its host tab replaces its whole body with it,
  // so an unconsumed BACK press pops React Navigation's last route and finishes
  // the activity (the app "exits"). Consume it here, unwinding ONE level: the
  // shared result surface (a Modal, which handles its own BACK while it is open)
  // first, then the take (stop it and land on the analysis rather than leaving a
  // live microphone behind), then back to the screen that opened the capture.
  // Guarded by src/services/backExitContract.ts.
  useHardwareBack(() => {
    if (humResult) {
      setHumResult(null);
      return true;
    }
    if (stage === 'recording' && recorder.isRecording) {
      void handleStop();
      return true;
    }
    onClose();
    return true;
  });

  const windowPhase: MelodyWindowPhase =
    stage === 'recording' ? 'recording' : stage === 'analysing' ? 'analysing' : 'review';

  /**
   * THE TAKE AS NOTATION (v33 §C). The window owns no renderer, so the flow
   * builds the card and hands it in. It is only built for a take that has notes
   * (a silent or unreadable take keeps the window's own honest state card), and
   * every note on it comes from THIS take — never from a matched song.
   */
  const staffCard = useMemo(() => {
    if (!take || analysis?.state !== 'ready') return null;
    return (
      <TakeStaffCard
        take={take}
        chordNames={analysis.chords.chords.map((chord) => chord.name)}
        chordHonestLine={analysis.chords.honestLine}
        title={analysis.rowTitle}
      />
    );
  }, [take, analysis]);

  /**
   * A SAVED CORRECTION (v33 §D). The editor has already written the corrected
   * take through the one seam; the flow adopts it, so the sequence, the staff,
   * the key, the chords and the MIDI export all describe the CORRECTED take from
   * here on. The editor stays open (the user may keep correcting) and its own
   * save line says what happened.
   */
  const handleTakeCorrected = useCallback((corrected: SavedCaptureTake) => {
    setTake(corrected);
    setAnalysis(buildMelodyAnalysis(corrected));
    setSaved(true);
    setSaveNote(null);
  }, []);

  return (
    <>
      {/* THE TAKE-CORRECTION EDITOR (v33 §D) — mounted here, driven by the take
          this flow holds, reached through the window's own "Correct notes, pitch
          or chords ›" door. */}
      <TakeCorrectionEditor
        visible={editorOpen}
        take={take}
        rowId={analysis?.rowId ?? null}
        audioUri={audioUri}
        frames={null}
        onSaved={handleTakeCorrected}
        onClose={() => setEditorOpen(false)}
      />

      <MelodyCaptureWindow
        phase={windowPhase}
        levels={recorder.liveLevels}
        elapsedMs={elapsedMs}
        // This build has NO live pitch source (the recorder hands us the finished
        // clip and a dB level, not a PCM stream), so the window says in words that
        // the notes are written when the take ends. The strip renders live notes
        // the moment a frame source can supply them.
        liveSourceReady={false}
        analysis={analysis}
        onFindMelody={handleFindMelody}
        findingMelody={matchState === 'checking'}
        findNote={findNote}
        onStop={handleStop}
        onClose={onClose}
        onRecordAgain={handleRetry}
        saved={saved}
        saveNote={saveNote}
        onExportMidi={handleExportMidi}
        exporting={exporting}
        exportNote={exportNote}
        exportKeyLine={exportKey}
        staff={staffCard}
        onCorrectTake={() => setEditorOpen(true)}
        copy={CAPTURE_COPY}
      >
      {recorder.error && !recorder.isRecording && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{recorder.error}</Text>
          <TouchableOpacity style={styles.settingsBtn} onPress={recorder.openSettings}>
            <Text style={styles.settingsBtnText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      )}

      {stage === 'error' && (
        <View style={styles.resultCard}>
          <Text style={styles.resultEmoji}>⚠️</Text>
          <Text style={styles.resultTitle}>Something went wrong</Text>
          <Text style={styles.resultText}>{errorMessage ?? 'Please try again.'}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry}>
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* A melody whose sound was kept but never read: the read can be retried
          without losing the take, and the window's own honest state explains it. */}
      {stage === 'review' && analysis?.state === 'unavailable' && !!audioUri && (
        <TouchableOpacity style={styles.primaryBtn} onPress={handleReanalyse}>
          <Text style={styles.primaryBtnText}>Try reading it again</Text>
        </TouchableOpacity>
      )}

      {/* THE LIBRARY MISS — ALWAYS AN OVERLAY, NEVER ON THE PAGE (v33 §B.1).
          The capture window is capture-only, so this card lives in a Modal and is
          reachable only through the explicit "Find this melody ›" step. The copy
          comes from humNoMatchMessage(): "we were close" vs "we're not sure —
          library still growing". Never a raw percentage, never a fabricated
          title. The user's own melody is already saved, so closing this reveals
          it again. */}
      <Modal
        visible={findOpen}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setFindOpen(false)}
      >
        <View style={styles.missScreen}>
          {stage === 'no-match' && outcome && (
            <View style={styles.resultCard}>
              <Text style={styles.resultEmoji}>🔍</Text>
              <Text style={styles.resultTitle}>No match for that melody</Text>
              <Text style={styles.resultText}>{humNoMatchMessage(outcome)}</Text>
              {hub && <Text style={styles.hintText}>{hub}</Text>}
              <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry}>
                <Text style={styles.primaryBtnText}>{HUM_RETRY_CTA}</Text>
              </TouchableOpacity>
              {/* THE BRIDGE (owner-approved 09-22): our melody catalog is small, so
                  a melody we don't hold must not be the end of the road. This hands
                  the user to the modern "Find any song" flow, where the actual
                  recording is identified and the official sheet music is linked. */}
              {onSwitchToModern && (
                <TouchableOpacity
                  style={styles.bridgeBtn}
                  onPress={onSwitchToModern}
                  activeOpacity={0.7}
                >
                  <Text style={styles.bridgeBtnText}>{HUM_TO_MODERN_CTA}</Text>
                  <Text style={styles.bridgeBtnHint}>{HUM_TO_MODERN_BLURB}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.quietBtn}
                onPress={() => setFindOpen(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.quietBtnText}>Back to my take</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* ── THE ONE RESULT SURFACE (bundle A) ──
          A confident hum match opens the SAME surface every other match uses,
          which shows the piece's hosted score INLINE, the hum provenance, the
          printed-arrangement search the backend supplied, and — from the
          contract below — the export of the take this screen just recorded. The
          capture window stays mounted underneath, so Done/BACK simply reveals
          the user's own melody again. */}
      {humResult ? (
        <RecognitionResultView
          visible
          phase={{ type: 'success', response: humResult }}
          onClose={() => setHumResult(null)}
          onRetry={handleRetry}
          midiExport={{
            takeUri,
            exporting,
            note: exportNote,
            keyLine: exportKey,
            onExport: handleExportMidi,
          }}
        />
      ) : null}
      </MelodyCaptureWindow>
    </>
  );
};

const styles = StyleSheet.create({
  errorCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    width: '100%',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e94560',
    alignItems: 'center',
  },
  errorText: {
    color: '#ffb347',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 18,
  },
  settingsBtn: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  settingsBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  resultCard: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 22,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
    marginTop: 8,
  },
  resultEmoji: {
    fontSize: 44,
    marginBottom: 8,
  },
  resultTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
    textAlign: 'center',
  },
  resultText: {
    fontSize: 14,
    color: '#a0a0b8',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 16,
  },
  hintText: {
    fontSize: 12,
    color: '#4ecdc4',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  primaryBtn: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    padding: 14,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  /** The HUM → MODERN bridge action: bordered in the app's teal accent so it
   *  reads as a route onward, not as a second retry. */
  bridgeBtn: {
    backgroundColor: '#0f3460',
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
  },
  bridgeBtnText: {
    color: '#4ecdc4',
    fontSize: 15,
    fontWeight: '700',
  },
  bridgeBtnHint: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 4,
  },
  /** The miss overlay's own screen (the capture page is never re-laid out). */
  missScreen: {
    flex: 1,
    backgroundColor: '#12122b',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  /** The overlay's own quiet exit — back to the user's take, never a dead end. */
  quietBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  quietBtnText: { color: '#a0a0b8', fontSize: 14, fontWeight: '600' },
});
