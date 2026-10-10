/**
 * TakeCorrectionEditor — THE TAKE-CORRECTION EDITOR's surface (v33 slice D,
 * owner green-light 10-03; brief /home/team/shared/take-correction-editor-brief.md).
 *
 * WHAT IT IS. "NoteSnap got my take wrong" has to be fixable, or the take is
 * thrown away. This is the full-screen surface where the user corrects the
 * notes, the pitch, the timing and the chords of their OWN take — with the
 * corrected take becoming the single source of truth for History, the MIDI
 * export and the Hum-Along preview (all three read the same plain
 * `MidiNoteEvent[]`, the open contract of the brief's §1).
 *
 * THE SURFACE, top to bottom:
 *   1. the take drawn as a staff (the app's own ABC renderer, teal ink) — the
 *      ACTUAL staff this editor operates on;
 *   2. the touch layer UNDER it: one block per note, sized by its real duration,
 *      which the user TAPS to select, DRAGS UP/DOWN to change pitch, and whose
 *      EDGES they drag to move the timing (grid-snapped, never overlapping a
 *      neighbour — takeEditor.setNoteBoundary owns both rules);
 *   3. the selected note's panel: the semitone rail (each candidate pitch PLAYS
 *      as you pick it — musicians correct by ear), the duration touch-up, add a
 *      note, remove a note (with the last-note guard), insert a rest, re-detect;
 *   4. the chord row: the take's SUGGESTED chords, and the override palette +
 *      free input that turn one into the user's own ("yours", never "suggested");
 *   5. the batch fixes: transpose the take, snap it to the key, undo / redo /
 *      reset to detected;
 *   6. THE DOCKED PREVIEW (slice G) — the Hum-Along row, above the sticky bar;
 *   7. THE STICKY SAVE BAR: "Save & update" and "Save a copy", both writing the
 *      corrected take through the ONE seam (services/correctedTakeStore), which
 *      is what makes History, MIDI and playback read the corrected take.
 *
 * HONESTY: every note carries its own tag (Auto-detected / Corrected by you /
 * Added by you), a chord the user typed is marked "yours", the preview is
 * labelled preview-only, and no line anywhere claims a studio transcription.
 *
 * The MODEL is src/services/takeEditor.ts (pure, fully asserted by
 * scripts/v33TakeEditor.test.ts); this file only draws it and routes the taps.
 */
import { useThemedStyles } from '../services/themeStore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useHardwareBack } from '../hooks/useHardwareBack';
import { useNotePreview } from '../hooks/useNotePreview';
import {
  CHORD_TAG_SUGGESTED,
  CHORD_TAG_YOURS,
  EDITOR_INTRO,
  EDITOR_LAST_NOTE_REASON,
  EDITOR_NO_KEY_LINE,
  EDITOR_NO_REDETECT_REASON,
  EDITOR_TITLE,
  MAX_TRANSPOSE_SEMITONES,
  NOTE_TAG_ADDED,
  NOTE_TAG_CORRECTED,
  NOTE_TAG_DETECTED,
  addNoteAfter,
  canRedo,
  canRemoveNote,
  canUndo,
  chordPalette,
  clearChordOverrides,
  createEditorState,
  deriveTake,
  findNote,
  gridStepSec,
  insertRestAfter,
  noteLabel,
  noteTag,
  overrideChord,
  redetectNote,
  redo,
  removeNote,
  resetChord,
  resetToDetected,
  setNoteBoundary,
  setNotePitch,
  snapTakeToScale,
  transposeTake,
  undo,
  type AnalysisFrame,
  type TakeEditorState,
} from '../services/takeEditor';
import { staffKeyFromKey, staffKeySignature, takeToAbc } from '../services/takeStaff';
import {
  EDITOR_NO_TAKE_LINE,
  shouldReloadEditorModel,
  takeIdentityOf,
  takeNoteCount,
} from '../services/editorTakeLoad';
import {
  shouldCaptureEdgeDrag,
  shouldCapturePitchDrag,
  shouldStartEditorDrag,
} from '../services/editorGestures';
import { AbcScoreView } from './AbcScoreView';
import { TakeStaffCard } from './TakeStaffCard';
import { TakePreviewSection } from './TakePreviewSection';
import {
  EDITOR_ORIGINAL_TITLE,
  EDITOR_VIEW_CORRECTED,
  EDITOR_VIEW_CORRECTED_CTA,
  EDITOR_VIEW_DEFAULT,
  EDITOR_VIEW_LABEL,
  EDITOR_VIEW_ORIGINAL,
  editorViewIsEditable,
  editorViewNote,
  editorViewSegmentLabel,
  editorViewTarget,
  type EditorTakeView,
} from '../services/editorTakeViews';
import {
  SAVE_COPY_CTA,
  SAVE_COPY_HINT,
  SAVE_UPDATE_CTA,
  SAVE_UPDATE_HINT,
  saveCorrectedTake,
  type TakeSaveMode,
} from '../services/correctedTakeStore';
import { exportCaptureMidiFromTake } from '../services/captureMidiExport';
import {
  MIDI_EXPORT_BUSY_LABEL,
  MIDI_EXPORT_HINT,
  MIDI_EXPORT_LABEL,
} from '../services/midiExport';
/**
 * v37 items 7 + 8 (owner-approved, 10-09): the SEND-TO surface (the take as a
 * PDF, to the user's email through the system share sheet, and the MIDI export
 * that already exists) and the GUITAR TABLATURE page the "Tabs" button opens.
 *
 * The labels and the honest lines come from the pure models — the tab from
 * services/guitarTab.ts, the destinations from services/takeSendTo.ts, the PDF
 * from services/takeNotationPdf.ts — so the words on the buttons and the words on
 * the pages can never drift apart.
 */
import { TAB_LABEL } from '../services/guitarTab';
import { SEND_TO_CTA } from '../services/takeSendTo';
import { TakeTabsView } from './TakeTabsView';
import { TakeSendToSheet } from './TakeSendToSheet';
import type { TakePdfChord } from '../services/takeNotationPdf';
import { TAKE_STAFF_CLEANED_INK, TAKE_STAFF_PAPER } from './TakeStaffCard';
import type { SavedCaptureTake } from '../services/midiExport';

/** The one-line coach tip on the surface (brief §5 — no false claims). */
export const EDITOR_COACH_TIP =
  'Notes are suggestions — tap any note to fix it. Your corrections are what exports and playback use.';
/** The label over the touch layer. */
export const EDITOR_LANE_LABEL = 'Tap a note · drag it up or down for pitch · drag its edges for timing';
/** The label over the chord row. */
export const EDITOR_CHORD_LABEL = 'Chords';
export const EDITOR_CHORD_FREE_HINT = 'Type any chord (e.g. C#m7)';
export const EDITOR_CHORD_USE_CTA = 'Use this chord';
export const EDITOR_CHORD_RESET_CTA = 'Back to suggested';
export const EDITOR_CHORD_RESET_ALL_CTA = 'Reset all chords';
export const EDITOR_TRANSPOSE_LABEL = 'Whole take';
export const EDITOR_SNAP_TO_KEY_CTA = 'Snap to key';
export const EDITOR_UNDO_CTA = '↶ Undo';
export const EDITOR_REDO_CTA = '↷ Redo';
export const EDITOR_RESET_CTA = 'Reset to detected';
export const EDITOR_ADD_NOTE_CTA = '+ Add note after';
export const EDITOR_REMOVE_NOTE_CTA = 'Remove note';
export const EDITOR_REST_CTA = 'Insert rest after';
export const EDITOR_REDETECT_CTA = 'Re-detect this note';
export const EDITOR_SHORTER_CTA = 'Shorter';
export const EDITOR_LONGER_CTA = 'Longer';
export const EDITOR_DONE_CTA = '← Back to my take';
export const EDITOR_NO_CHORDS_LINE = 'No chords to change on this take yet.';
export const EDITOR_SAVING_LABEL = 'Saving…';

/** How wide one second of the take is drawn (the drag → seconds mapping). */
export const LANE_PX_PER_SEC = 84;
/** How far a vertical drag must travel to mean one semitone. */
export const LANE_PX_PER_SEMITONE = 26;
/**
 * THE VIEW SWITCH'S SEGMENTS, in the order they are shown (v36 fix 2, backlog
 * #43): the editable take first — it is the default — then the read-only original.
 */
export const EDITOR_VIEW_OPTIONS: readonly EditorTakeView[] = [
  EDITOR_VIEW_CORRECTED,
  EDITOR_VIEW_ORIGINAL,
];

export interface TakeCorrectionEditorProps {
  /** Whether the editor is open (the host owns this). */
  visible: boolean;
  /** The take to correct (the user's own; plain notes + tempo + key). */
  take: SavedCaptureTake | null | undefined;
  /** The History row this take belongs to ('' / null when it is not saved yet). */
  rowId: string | null;
  /** The saved clip's URI — carried onto a corrected copy, never re-recorded. */
  audioUri?: string | null;
  /** The take's own analysis frames, for a per-note re-detect (null = none). */
  frames?: ReadonlyArray<AnalysisFrame> | null;
  /** Called after a WRITE succeeded, with the corrected take. */
  onSaved?: (take: SavedCaptureTake, mode: TakeSaveMode, rowId: string | null) => void;
  /** Called for every edit, so the host can hold the corrected take (optional). */
  onChanged?: (take: SavedCaptureTake) => void;
  onClose: () => void;
}

export const TakeCorrectionEditor: React.FC<TakeCorrectionEditorProps> = ({
  visible,
  take,
  rowId,
  audioUri,
  frames,
  onSaved,
  onChanged,
  onClose,
}) => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const [state, setState] = useState<TakeEditorState>(() => createEditorState(take));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chordIndex, setChordIndex] = useState<number | null>(null);
  const [freeChord, setFreeChord] = useState('');
  const [saving, setSaving] = useState<TakeSaveMode | null>(null);
  const [saveLine, setSaveLine] = useState<string | null>(null);
  /**
   * SENDING THE CORRECTED TAKE OFF THE DEVICE (v37 item 6, backlog d2e9e2c5,
   * owner v36 ask item 6). The owner needs the .mid on a desktop; this page is
   * where the take they CORRECTED lives, so the export belongs here. `midiBusy`
   * keeps a second tap from starting a second encode, and `midiLine` carries the
   * export's OWN sentence back to the surface — a swallowed outcome would read as
   * a dead button, and this repo does not ship those.
   */
  const [midiBusy, setMidiBusy] = useState(false);
  const [midiLine, setMidiLine] = useState<string | null>(null);
  /**
   * THE GUITAR TAB PAGE (v37 item 8, backlog ee3a6e13). The owner's placement,
   * re-confirmed 10-09: the "Tabs" button sits UNDERNEATH the tap-a-note lane and
   * JUST ABOVE the Chords section. The piano staff above stays exactly as it is —
   * this opens a SECOND, additive view of the same corrected take, never a
   * replacement for the notation.
   */
  const [tabsOpen, setTabsOpen] = useState(false);
  /**
   * THE SEND-TO SURFACE (v37 item 7, backlog baa39e66). One place from which the
   * corrected take can leave the device: the PDF, the user's own email through the
   * system share sheet, and the MIDI export this page already has. It is opened by
   * a button inside the same take-gated block as the MIDI export, so it is offered
   * exactly when there is something to send.
   */
  const [sendOpen, setSendOpen] = useState(false);
  /** True only while a note drag owns the gesture (the drag blocks native scroll
      through its own responder — the page's scroller is never switched off). */
  const [dragging, setDragging] = useState(false);
  /**
   * WHICH EDITOR SESSION THE PAGE IS ON (v37 item 1, backlog 3ff40fd1).
   *
   * WHY THIS EXISTS. The owner opened the editor from a History row and the page
   * would not scroll, while the SAME component opened from the capture window
   * scrolled fine. Everything that could be checked from the source was already
   * right (every WebView on the page is shielded with `interactive={false}`), so
   * what is left is a NATIVE scroller that entered a bad state and stayed in it.
   * The page's ScrollView is therefore keyed on this counter and the counter is
   * bumped on every OPEN: each session gets a brand-new native scroller, so a
   * scroller that got stuck can never follow the user into the next session.
   */
  const [pageSession, setPageSession] = useState(0);
  /**
   * WHICH TAKE THE PAGE IS SHOWING (v36 fix 2, backlog #43): the editable take, or
   * the take exactly as it was auto-detected. DISPLAY ONLY — see
   * services/editorTakeViews.ts. It is not part of the model, so switching can
   * never disturb an edit.
   */
  const [view, setView] = useState<EditorTakeView>(EDITOR_VIEW_DEFAULT);
  const stateRef = useRef<TakeEditorState>(state);
  const dragBaseRef = useRef(0);
  /** The take the MODEL was built from — the reload decision reads it (v34). */
  const loadedIdentityRef = useRef<string | null>(null);
  const wasVisibleRef = useRef(false);
  const preview = useNotePreview(state.notes, { enabled: visible });

  /**
   * THE MODEL RELOADS FROM THE TAKE THE HOST HOLDS (v34 fix 2).
   *
   * v33 built the editable model exactly once, in the useState initializer, from
   * whatever `take` was at MOUNT. A host that mounts the editor before its take
   * exists (the capture flow: `take` starts null) therefore opened a BLANK editor
   * with "No key detected in this take" on every attempt, and a take read back
   * from persistence never reached the model at all. The rule (pure, asserted by
   * scripts/v34Fixes.test.ts) is in services/editorTakeLoad.ts: reload on every
   * OPEN, on a late-arriving take with notes, and on a different take the user has
   * not edited — never under a user who has edits in flight.
   */
  useEffect(() => {
    const opened = visible && !wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!visible) return;
    /**
     * v37 item 1: every OPEN gets a FRESH native page scroller (see pageSession).
     * This is the one thing about the page that must not survive a close/reopen.
     */
    if (opened) setPageSession((session) => session + 1);
    // Opening the editor always lands on the EDITABLE take (v36 fix 2): a stale
    // "original" view would show the PREVIOUS take's baseline under the new take's
    // title, which is worse than showing nothing.
    if (opened) setView(EDITOR_VIEW_DEFAULT);
    // A fresh open starts on the page itself: the tab page and the Send-to surface
    // (v37 items 7 + 8) belong to the session that opened them.
    if (opened) setTabsOpen(false);
    if (opened) setSendOpen(false);
    const incomingIdentity = takeIdentityOf(take, rowId);
    const current = stateRef.current;
    const reload = shouldReloadEditorModel({
      loadedIdentity: loadedIdentityRef.current,
      incomingIdentity,
      opened,
      edited: current.past.length > 0 || current.future.length > 0,
      currentNoteCount: current.notes.length,
      incomingNoteCount: takeNoteCount(take),
    });
    if (!reload) return;
    const next = createEditorState(take);
    loadedIdentityRef.current = incomingIdentity;
    stateRef.current = next;
    setState(next);
    setSelectedId(null);
    setChordIndex(null);
    setFreeChord('');
    setSaveLine(null);
    setView(EDITOR_VIEW_DEFAULT);
  }, [rowId, take, visible]);

  const derived = useMemo(() => deriveTake(state), [state]);
  /** The editable view: the lane, the chords, the batch fixes and the preview. */
  const editable = editorViewIsEditable(view);
  /**
   * THE ORIGINAL VIEW'S BASELINE (v36 fix 2, backlog #43). It is derived from the
   * live model through `resetToDetected` — the SAME seam the "Reset to detected"
   * button restores — so the read-only original and that button can never disagree
   * about what "as detected" means, and it follows the take the editor is on.
   */
  const original = useMemo(() => deriveTake(resetToDetected(state)), [state]);
  const originalChords = useMemo(
    () => original.chords.map((chord) => chord.name),
    [original],
  );
  /**
   * THE CHORDS THE PDF PRINTS (v37 item 7a): the SAME suggested chords the chord
   * row shows, in the same state — the ones the user has re-derived after their
   * corrections. The PDF is a view of this take, so it reads the live model.
   */
  const pdfChords = useMemo<TakePdfChord[]>(
    () => derived.chords.map((chord) => ({ index: chord.index, name: chord.name })),
    [derived],
  );
  /** The facts the top card describes: whichever take is on screen. */
  const viewFacts = editable ? derived : original;

  /** Every edit lands here: one place updates the model and the host's copy. */
  const apply = useCallback(
    (next: TakeEditorState, auditionMidi?: number) => {
      if (next !== stateRef.current) {
        stateRef.current = next;
        setState(next);
        onChanged?.(deriveTake(next).take);
      }
      if (typeof auditionMidi === 'number') void preview.playNote(auditionMidi);
    },
    [onChanged, preview],
  );

  const selected = selectedId ? findNote(state, selectedId) : null;
  const step = gridStepSec(state.tempoBpm);

  const staffAbc = useMemo(() => {
    const signature = staffKeySignature(staffKeyFromKey(derived.key));
    return takeToAbc(state.notes, {
      signature,
      eighthSec: step,
      title: 'Your corrected take',
    });
  }, [derived.key, state.notes, step]);

  // ── the touch layer's gestures ───────────────────────────────────────────
  // A DRAG LAYER INSIDE A SCROLLER MAY ONLY TAKE A GESTURE IT CAN USE (v34 fix 3).
  // v33 claimed the touch the moment a finger landed (`onStartShouldSetPanResponder:
  // () => true`) on a full-width band in the middle of the page, and the timing
  // handles claimed every move — so a scroll that started there never reached the
  // page's ScrollView and the page read as frozen. The intent rules live in
  // services/editorGestures.ts (pure, asserted by the gate).
  const pitchPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: shouldStartEditorDrag,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          shouldCapturePitchDrag(gesture.dx, gesture.dy),
        // A CLAIMED DRAG BLOCKS NATIVE SCROLLING (v36 fix 1). This is what makes
        // the page's `scrollEnabled` flag unnecessary: an edit cannot be stolen by
        // the scroller mid-gesture, and the scroller is never left switched off by
        // editor state (a stuck flag was one way the page could stop scrolling for
        // good). The page scrolls from every other touch, everywhere else.
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => setDragging(true),
        onPanResponderTerminate: () => setDragging(false),
        onPanResponderRelease: (_event, gesture) => {
          setDragging(false);
          if (!selectedId) return;
          const semitones = Math.round(-gesture.dy / LANE_PX_PER_SEMITONE);
          if (semitones === 0) return;
          const note = findNote(stateRef.current, selectedId);
          if (!note) return;
          const target = note.midi + semitones;
          apply(setNotePitch(stateRef.current, selectedId, target), target);
        },
      }),
    [apply, selectedId],
  );

  const boundaryPan = useCallback(
    (edge: 'start' | 'end') =>
      PanResponder.create({
        onStartShouldSetPanResponder: shouldStartEditorDrag,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          shouldCaptureEdgeDrag(gesture.dx, gesture.dy),
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => {
          setDragging(true);
          if (!selectedId) return;
          const note = findNote(stateRef.current, selectedId);
          if (!note) return;
          dragBaseRef.current = edge === 'start' ? note.startSec : note.startSec + note.durationSec;
        },
        onPanResponderTerminate: () => setDragging(false),
        onPanResponderRelease: () => setDragging(false),
        onPanResponderMove: (_event, gesture) => {
          if (!selectedId) return;
          const seconds = dragBaseRef.current + gesture.dx / LANE_PX_PER_SEC;
          apply(setNoteBoundary(stateRef.current, selectedId, edge, seconds));
        },
      }),
    [apply, selectedId],
  );

  // ── actions ──────────────────────────────────────────────────────────────
  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setChordIndex(null);
      const note = findNote(stateRef.current, id);
      if (note) void preview.playNote(note.midi);
    },
    [preview],
  );

  const doAddNote = useCallback(() => {
    if (!selectedId) return;
    const anchorIndex = stateRef.current.notes.findIndex((note) => note.id === selectedId);
    const next = addNoteAfter(stateRef.current, selectedId);
    const added = anchorIndex >= 0 ? next.notes[anchorIndex + 1] ?? null : null;
    apply(next);
    if (added) {
      setSelectedId(added.id);
      void preview.playNote(added.midi);
    }
  }, [apply, preview, selectedId]);

  const doRemove = useCallback(() => {
    if (!selectedId) return;
    if (!canRemoveNote(stateRef.current, selectedId)) {
      setSaveLine(EDITOR_LAST_NOTE_REASON);
      return;
    }
    const index = stateRef.current.notes.findIndex((note) => note.id === selectedId);
    const next = removeNote(stateRef.current, selectedId);
    apply(next);
    const neighbour = next.notes[Math.min(Math.max(0, index - 1), next.notes.length - 1)] ?? null;
    setSelectedId(neighbour ? neighbour.id : null);
  }, [apply, selectedId]);

  const doRest = useCallback(() => {
    if (!selectedId) return;
    apply(insertRestAfter(stateRef.current, selectedId));
  }, [apply, selectedId]);

  const doRedetect = useCallback(() => {
    if (!selectedId) return;
    if (!frames || frames.length === 0) {
      setSaveLine(EDITOR_NO_REDETECT_REASON);
      return;
    }
    const next = redetectNote(stateRef.current, selectedId, frames);
    const note = findNote(next, selectedId);
    apply(next, note ? note.midi : undefined);
  }, [apply, frames, selectedId]);

  const doDuration = useCallback(
    (factor: number, deltaSteps: number) => {
      if (!selectedId) return;
      const note = findNote(stateRef.current, selectedId);
      if (!note) return;
      const wanted = (note.startSec + note.durationSec) * factor + deltaSteps * step;
      apply(setNoteBoundary(stateRef.current, selectedId, 'end', wanted));
    },
    [apply, selectedId, step],
  );

  const doTranspose = useCallback(
    (semitones: number) => {
      apply(transposeTake(stateRef.current, semitones));
    },
    [apply],
  );

  const doSnap = useCallback(() => {
    apply(snapTakeToScale(stateRef.current, derived.key));
  }, [apply, derived.key]);

  const doSave = useCallback(
    async (mode: TakeSaveMode) => {
      if (saving) return;
      setSaving(mode);
      setSaveLine(null);
      const result = await saveCorrectedTake({
        rowId,
        take: derived.take,
        audioUri: audioUri ?? null,
        mode,
      });
      setSaving(null);
      setSaveLine(result.line);
      if (result.ok) onSaved?.(derived.take, mode, result.rowId);
      else if (result.mode === 'update' && !rowId) {
        // Not a dead end: the copy action is right there, and it always works.
        setSaveLine(`${result.line}`);
      }
    },
    [audioUri, derived.take, onSaved, rowId, saving],
  );

  /**
   * SEND THE CORRECTED TAKE TO THE SYSTEM SHARE SHEET (v37 item 6).
   *
   * It uses the EXISTING export — the same encode → write → share path the result
   * card and the History row use (`exportCaptureMidiFromTake`) — on `derived.take`,
   * which IS the corrected take this page treats as the single source of truth.
   * The file's structure is validated inside that path before it is shared, and
   * the outcome's own sentence is rendered (never swallowed): 'exported',
   * 'no-melody', 'unavailable' or 'failed' each say what happened.
   */
  const shareTakeAsMidi = useCallback(async () => {
    if (midiBusy) return;
    setMidiBusy(true);
    setMidiLine(null);
    const result = await exportCaptureMidiFromTake(derived.take, {});
    setMidiBusy(false);
    setMidiLine(result.message);
  }, [derived.take, midiBusy]);

  // Android BACK closes the editor, never the app (the in-place flow rule).
  useHardwareBack(() => {
    if (visible) {
      onClose();
      return true;
    }
    return false;
  });

  const railBase = selected ? selected.midi : null;
  const rail = useMemo(() => {
    if (railBase === null) return [];
    const out: number[] = [];
    for (let offset = -6; offset <= 6; offset++) out.push(railBase + offset);
    return out;
  }, [railBase]);

  const palette = useMemo(() => chordPalette(derived.key), [derived.key]);

  const canUpdate = !!rowId;

  return (
    <>
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={EDITOR_DONE_CTA}
          >
            <Text style={styles.backText}>{EDITOR_DONE_CTA}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{EDITOR_TITLE}</Text>
        </View>

        {/* THE PAGE MAY ALWAYS SCROLL (v34 fix 3, hardened in v36 fix 1 and again
            in v37 item 1): the page's own scroller is BOUNDED here
            (`styles.page`), carries NO `scrollEnabled` prop at all — no editor
            state may EVER be able to switch the page's scroller off, because one
            stuck value would freeze the page for the rest of the session with no
            user action able to recover (v36 made the old flag a constant TRUE;
            v37 removed the prop outright) — and is REMOUNTED on every open (the
            `key` below) so a native scroller that entered a bad state can never
            follow the user into the next session (owner FAIL #8: opened from a
            History row it would not scroll, while the same component opened from
            the capture window scrolled fine). `nestedScrollEnabled` keeps the
            horizontal note lane usable inside this vertical scroller on Android.
            An in-flight drag is protected by the responder itself
            (`onShouldBlockNativeResponder: () => true` — see
            services/editorGestures.ts), so nothing is lost by never freezing the
            page. Every surface on the page — including the staff, the biggest one
            — hands the gesture to this ScrollView (AbcScoreView's touch shield). */}
        <ScrollView
          key={`editor-page-${pageSession}`}
          style={styles.page}
          contentContainerStyle={styles.body}
          nestedScrollEnabled
        >
          <Text style={styles.intro}>{EDITOR_INTRO}</Text>
          <Text style={styles.tip}>{EDITOR_COACH_TIP}</Text>

          {/* 0. THE VIEW SWITCH (v36 fix 2, backlog #43) — the capture page's own
              two-score display, brought to the editor: the editable take, or the
              take exactly as it was auto-detected (read-only). DISPLAY ONLY: the
              corrected take stays the one source of truth for History, the MIDI
              export and the preview. */}
          <View style={styles.viewSwitch}>
            <Text style={styles.viewSwitchLabel}>{EDITOR_VIEW_LABEL}</Text>
            <View style={styles.segmentRow}>
              {EDITOR_VIEW_OPTIONS.map((option) => {
                const on = option === view;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.segment, on && styles.segmentOn]}
                    onPress={() => setView(option)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Show ${editorViewSegmentLabel(option)}`}
                  >
                    <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                      {editorViewSegmentLabel(option)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.viewNote}>{editorViewNote(view)}</Text>
          </View>

          {/* The take's re-derived facts, after EVERY edit (brief §3b: the key and
              the chords are recomputed, never left stale). */}
          <View style={styles.factCard}>
            {takeNoteCount(take) === 0 ? (
              /* NO TAKE, IN WORDS (v34 fix 2). v33 showed a blank staff and "No key
                 detected in this take", which reads as a broken app; the truth is
                 that this melody was saved without notes. */
              <Text style={styles.factKey}>{EDITOR_NO_TAKE_LINE}</Text>
            ) : (
              <Text style={styles.factKey}>
                {viewFacts.keyLabel ? `Key: ${viewFacts.keyLabel}` : 'No key detected in this take'}
              </Text>
            )}
            {editable && viewFacts.summaryLine ? (
              <Text style={styles.factSummary}>{viewFacts.summaryLine}</Text>
            ) : (
              <Text style={styles.factSummary}>
                {editable
                  ? 'Nothing changed yet — this is the take exactly as detected.'
                  : editorViewNote(view)}
              </Text>
            )}
          </View>

          {editable ? (
            <>
          {/* 1. THE STAFF — the take as notation, redrawn from the CURRENT notes.
              DECORATIVE: it is drawn in a WebView, and a WebView swallows the
              page's scroll gestures (it is not part of RN's responder system).
              `interactive={false}` closes the viewer's own touch surface and mounts
              its touch shield, so the biggest surface on the page scrolls the page
              (v36 fix 1 — the owner's "Again page does not scroll down"). All
              editing happens on the lane below (v34 fix 3). */}
          <View style={styles.staffBox}>
            <AbcScoreView
              abc={staffAbc}
              ink={TAKE_STAFF_CLEANED_INK}
              background={TAKE_STAFF_PAPER}
              interactive={false}
            />
          </View>

          {/* 2. THE TOUCH LAYER — one block per note, real duration, drag + edges. */}
          <Text style={styles.laneLabel}>{EDITOR_LANE_LABEL}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.lane}>
            <View style={styles.laneRow}>
              {state.notes.map((note, index) => {
                const isSelected = note.id === selectedId;
                const width = Math.max(
                  44,
                  Math.round(note.durationSec * LANE_PX_PER_SEC),
                );
                return (
                  <View key={note.id} style={styles.noteWrap}>
                    <View
                      style={[
                        styles.noteBlock,
                        isSelected && styles.noteBlockSelected,
                        preview.cursor === index && styles.noteBlockCursor,
                        { width },
                      ]}
                      {...(isSelected ? pitchPan.panHandlers : {})}
                    >
                      <TouchableOpacity
                        style={styles.noteBlockInner}
                        onPress={() => select(note.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Note ${index + 1}: ${noteLabel(note.midi)}, ${noteTag(note)}`}
                      >
                        <Text style={styles.noteBlockText}>{noteLabel(note.midi)}</Text>
                        <Text style={styles.noteBlockTag}>
                          {note.source === 'added' ? '+' : note.source === 'corrected' ? '✎' : '·'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {isSelected && (
                      <>
                        <View style={[styles.handle, styles.handleStart]} {...boundaryPan('start').panHandlers} />
                        <View style={[styles.handle, styles.handleEnd]} {...boundaryPan('end').panHandlers} />
                      </>
                    )}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {/* 3. THE SELECTED NOTE — the semitone rail (audible), timing, structure. */}
          {selected ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>
                {noteLabel(selected.midi)} · {noteTag(selected)}
              </Text>
              <Text style={styles.panelSub}>
                Pick a semitone — each one plays as you tap it.
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rail}>
                <View style={styles.railRow}>
                  {rail.map((midi) => (
                    <TouchableOpacity
                      key={midi}
                      style={[styles.railChip, midi === selected.midi && styles.railChipOn]}
                      onPress={() => apply(setNotePitch(stateRef.current, selected.id, midi), midi)}
                      accessibilityRole="button"
                      accessibilityLabel={`Set pitch ${noteLabel(midi)}`}
                    >
                      <Text
                        style={[
                          styles.railChipText,
                          midi === selected.midi && styles.railChipTextOn,
                        ]}
                      >
                        {noteLabel(midi)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={styles.opBtn}
                  onPress={() => {
                    const target = selected.midi - 12;
                    apply(setNotePitch(stateRef.current, selected.id, target), target);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Octave down"
                >
                  <Text style={styles.opBtnText}>−12</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.opBtn}
                  onPress={() => {
                    const target = selected.midi + 12;
                    apply(setNotePitch(stateRef.current, selected.id, target), target);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Octave up"
                >
                  <Text style={styles.opBtnText}>+12</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.opBtn}
                  onPress={() => doDuration(1, -1)}
                  accessibilityRole="button"
                  accessibilityLabel={EDITOR_SHORTER_CTA}
                >
                  <Text style={styles.opBtnText}>{EDITOR_SHORTER_CTA}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.opBtn}
                  onPress={() => doDuration(1, 1)}
                  accessibilityRole="button"
                  accessibilityLabel={EDITOR_LONGER_CTA}
                >
                  <Text style={styles.opBtnText}>{EDITOR_LONGER_CTA}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.opBtn}
                  onPress={() => doDuration(2, 0)}
                  accessibilityRole="button"
                  accessibilityLabel="Double the length"
                >
                  <Text style={styles.opBtnText}>×2</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.opBtn}
                  onPress={() => doDuration(0.5, 0)}
                  accessibilityRole="button"
                  accessibilityLabel="Halve the length"
                >
                  <Text style={styles.opBtnText}>÷2</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={styles.opBtn}
                  onPress={doAddNote}
                  accessibilityRole="button"
                  accessibilityLabel={EDITOR_ADD_NOTE_CTA}
                >
                  <Text style={styles.opBtnText}>{EDITOR_ADD_NOTE_CTA}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.opBtn, !canRemoveNote(state, selected.id) && styles.opBtnOff]}
                  onPress={doRemove}
                  accessibilityRole="button"
                  accessibilityLabel={EDITOR_REMOVE_NOTE_CTA}
                >
                  <Text style={styles.opBtnText}>{EDITOR_REMOVE_NOTE_CTA}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.opBtn}
                  onPress={doRest}
                  accessibilityRole="button"
                  accessibilityLabel={EDITOR_REST_CTA}
                >
                  <Text style={styles.opBtnText}>{EDITOR_REST_CTA}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.opBtn, (!frames || frames.length === 0) && styles.opBtnOff]}
                  onPress={doRedetect}
                  accessibilityRole="button"
                  accessibilityLabel={EDITOR_REDETECT_CTA}
                >
                  <Text style={styles.opBtnText}>{EDITOR_REDETECT_CTA}</Text>
                </TouchableOpacity>
              </View>
              {!canRemoveNote(state, selected.id) && (
                <Text style={styles.reason}>{EDITOR_LAST_NOTE_REASON}</Text>
              )}
              {(!frames || frames.length === 0) && (
                <Text style={styles.reason}>{EDITOR_NO_REDETECT_REASON}</Text>
              )}
            </View>
          ) : (
            <Text style={styles.reason}>
              Tap a note on the lane above to correct its pitch, timing or length.
            </Text>
          )}

          {/* 3b. TABS (v37 item 8, backlog ee3a6e13) — the owner's placement,
              re-confirmed 10-09: UNDERNEATH the tap-a-note lane (the block above)
              and JUST ABOVE the Chords section (the block below). It opens the
              take laid out as guitar tablature, standard tuning.

              THE PIANO NOTATION IS UNTOUCHED: the staff is still drawn at the top
              of this page and stays there (owner: "The piano notation is correct
              and needs to remain"). Tabs is a SECOND, additive view of the same
              corrected take — it never replaces the notation, and it writes
              nothing back to the take. */}
          <TouchableOpacity
            style={styles.tabsBtn}
            onPress={() => setTabsOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${TAB_LABEL} — your take as guitar tab`}
            accessibilityHint="Opens your take as guitar tablature in standard tuning"
          >
            <Text style={styles.tabsBtnText}>{TAB_LABEL}</Text>
          </TouchableOpacity>

          {/* 4. THE CHORD ROW — suggested, or the user's own ("yours"). */}
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{EDITOR_CHORD_LABEL}</Text>
            {derived.chords.length > 0 ? (
              <View style={styles.chordRow}>
                {derived.chords.map((slot) => (
                  <TouchableOpacity
                    key={`${slot.index}-${slot.name}`}
                    style={[
                      styles.chordChip,
                      slot.tag === CHORD_TAG_YOURS && styles.chordChipYours,
                      chordIndex === slot.index && styles.chordChipOn,
                    ]}
                    onPress={() => {
                      setChordIndex(slot.index);
                      setFreeChord(slot.name);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Chord ${slot.name}, ${slot.tag}`}
                  >
                    <Text style={styles.chordChipText}>
                      {slot.degree ? `${slot.degree} ` : ''}
                      {slot.name}
                    </Text>
                    <Text style={styles.chordChipTag}>
                      {slot.tag === CHORD_TAG_YOURS ? 'yours' : CHORD_TAG_SUGGESTED}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={styles.reason}>{EDITOR_NO_KEY_LINE || EDITOR_NO_CHORDS_LINE}</Text>
            )}

            {chordIndex !== null && (
              <View style={styles.chordEditor}>
                {palette.length > 0 && (
                  <View style={styles.chordRow}>
                    {palette.map((entry) => (
                      <TouchableOpacity
                        key={`${entry.degree}-${entry.name}`}
                        style={styles.paletteChip}
                        onPress={() => {
                          setFreeChord(entry.name);
                          apply(overrideChord(stateRef.current, chordIndex, entry.name, entry.degree));
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Use chord ${entry.name}`}
                      >
                        <Text style={styles.paletteChipText}>
                          {entry.degree} {entry.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <TextInput
                  style={styles.chordInput}
                  value={freeChord}
                  onChangeText={setFreeChord}
                  placeholder={EDITOR_CHORD_FREE_HINT}
                  placeholderTextColor={theme.subtext}
                  autoCapitalize="characters"
                  accessibilityLabel={EDITOR_CHORD_FREE_HINT}
                />
                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={styles.opBtn}
                    onPress={() => apply(overrideChord(stateRef.current, chordIndex, freeChord))}
                    accessibilityRole="button"
                    accessibilityLabel={EDITOR_CHORD_USE_CTA}
                  >
                    <Text style={styles.opBtnText}>{EDITOR_CHORD_USE_CTA}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.opBtn}
                    onPress={() => apply(resetChord(stateRef.current, chordIndex))}
                    accessibilityRole="button"
                    accessibilityLabel={EDITOR_CHORD_RESET_CTA}
                  >
                    <Text style={styles.opBtnText}>{EDITOR_CHORD_RESET_CTA}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.opBtn}
                    onPress={() => apply(clearChordOverrides(stateRef.current))}
                    accessibilityRole="button"
                    accessibilityLabel={EDITOR_CHORD_RESET_ALL_CTA}
                  >
                    <Text style={styles.opBtnText}>{EDITOR_CHORD_RESET_ALL_CTA}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* 5. THE BATCH FIXES + THE ESCAPE HATCHES. */}
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{EDITOR_TRANSPOSE_LABEL}</Text>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={styles.opBtn}
                onPress={() => doTranspose(-1)}
                accessibilityRole="button"
                accessibilityLabel="Transpose the take down one semitone"
              >
                <Text style={styles.opBtnText}>−1 semitone</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.opBtn}
                onPress={() => doTranspose(1)}
                accessibilityRole="button"
                accessibilityLabel="Transpose the take up one semitone"
              >
                <Text style={styles.opBtnText}>+1 semitone</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.opBtn, !derived.key && styles.opBtnOff]}
                onPress={doSnap}
                accessibilityRole="button"
                accessibilityLabel={EDITOR_SNAP_TO_KEY_CTA}
              >
                <Text style={styles.opBtnText}>{EDITOR_SNAP_TO_KEY_CTA}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.reason}>
              Transpose moves at most ±{MAX_TRANSPOSE_SEMITONES} semitones at a time.
            </Text>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.opBtn, !canUndo(state) && styles.opBtnOff]}
                onPress={() => apply(undo(stateRef.current))}
                accessibilityRole="button"
                accessibilityLabel={EDITOR_UNDO_CTA}
              >
                <Text style={styles.opBtnText}>{EDITOR_UNDO_CTA}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.opBtn, !canRedo(state) && styles.opBtnOff]}
                onPress={() => apply(redo(stateRef.current))}
                accessibilityRole="button"
                accessibilityLabel={EDITOR_REDO_CTA}
              >
                <Text style={styles.opBtnText}>{EDITOR_REDO_CTA}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.opBtn}
                onPress={() => {
                  apply(resetToDetected(stateRef.current));
                  setSelectedId(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={EDITOR_RESET_CTA}
              >
                <Text style={styles.opBtnText}>{EDITOR_RESET_CTA}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 6. THE TAGS LEGEND — the user can always tell what is theirs. */}
          <Text style={styles.legend}>
            {NOTE_TAG_DETECTED} · {NOTE_TAG_CORRECTED} · {NOTE_TAG_ADDED}
          </Text>

          {/* 7. THE DOCKED PREVIEW (v33 slice G) — owner-ratified option 4: ONE
              control row INSIDE this editor, above the sticky save bar. It plays
              the corrected take (this screen's own notes), never a separate
              screen and never a second player. It belongs to the EDITABLE view:
              it plays the take the user is editing. */}
              <TakePreviewSection preview={preview} />
            </>
          ) : (
            /* THE ORIGINAL VIEW (v36 fix 2, backlog #43) — the take exactly as it
               was auto-detected, in the capture page's OWN two-score card (raw
               trace dimmed → auto-clean divider → crisp cleaned line), which is the
               display the owner already confirmed. READ-ONLY: no lane, no chord
               editor, no batch fixes, and the save bar still saves the CORRECTED
               take — nothing on this view can change the take. */
            <>
              <Text style={styles.viewModeTitle}>{EDITOR_ORIGINAL_TITLE}</Text>
              <TakeStaffCard
                take={original.take}
                chordNames={originalChords}
                chordHonestLine={originalChords.length > 0 ? null : EDITOR_NO_CHORDS_LINE}
                title={EDITOR_ORIGINAL_TITLE}
                interactive={false}
              />
              <View style={styles.originalNote}>
                <Text style={styles.viewNote}>{editorViewNote(view)}</Text>
                <TouchableOpacity
                  style={styles.backToEditing}
                  onPress={() => setView(editorViewTarget(view))}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${EDITOR_VIEW_CORRECTED_CTA}`}
                >
                  <Text style={styles.backToEditingText}>{EDITOR_VIEW_CORRECTED_CTA}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* 8. SEND THE TAKE OFF THE DEVICE (v37 item 6). The owner has no MIDI
              hardware, so the ONLY way they can open this take on a desktop is a
              shared file — and the take they corrected is the one worth sending.
              It is offered only when the take HAS notes (a button that can only
              fail is not offered), shows the export's own outcome line under it,
              and lives in the page's scroller so it is reachable from either view
              (the save bar below still saves the same corrected take). */}
          {derived.take && derived.take.notes.length > 0 ? (
            <View style={styles.midiBlock}>
              <TouchableOpacity
                style={[styles.midiBtn, midiBusy && styles.midiBtnOff]}
                onPress={() => void shareTakeAsMidi()}
                disabled={midiBusy}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={MIDI_EXPORT_LABEL}
                accessibilityHint={MIDI_EXPORT_HINT}
              >
                <Text style={styles.midiBtnText}>
                  {midiBusy ? MIDI_EXPORT_BUSY_LABEL : MIDI_EXPORT_LABEL}
                </Text>
              </TouchableOpacity>
              {midiLine ? (
                <Text style={styles.midiLine}>{midiLine}</Text>
              ) : (
                <Text style={styles.midiHint}>{MIDI_EXPORT_HINT}</Text>
              )}
              {/* 8b. SEND TO… (v37 item 7, backlog baa39e66) — the take as a PDF,
                  to the user's own email through the SYSTEM share sheet, and the
                  MIDI export right above (the sheet calls THIS page's own
                  shareTakeAsMidi, so there is one MIDI path, not two). Nothing is
                  ever emailed from our side. It sits inside the same
                  take-has-notes gate as the export: offered exactly when there is
                  something to send. */}
              <TouchableOpacity
                style={styles.sendToBtn}
                onPress={() => setSendOpen(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={SEND_TO_CTA}
                accessibilityHint="PDF, MIDI, or your own email through the system share sheet"
              >
                <Text style={styles.sendToBtnText}>{SEND_TO_CTA}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>

        {/* THE STICKY SAVE BAR — the only two writes in the flow. */}
        <View style={styles.saveBar}>
          {saveLine ? <Text style={styles.saveLine}>{saveLine}</Text> : null}
          <View style={styles.saveRow}>
            <TouchableOpacity
              style={[styles.savePrimary, (!canUpdate || !!saving) && styles.saveOff]}
              onPress={() => void doSave('update')}
              disabled={!canUpdate || !!saving}
              accessibilityRole="button"
              accessibilityLabel={SAVE_UPDATE_CTA}
            >
              <Text style={styles.savePrimaryText}>
                {saving === 'update' ? EDITOR_SAVING_LABEL : SAVE_UPDATE_CTA}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveSecondary, !!saving && styles.saveOff]}
              onPress={() => void doSave('copy')}
              disabled={!!saving}
              accessibilityRole="button"
              accessibilityLabel={SAVE_COPY_CTA}
            >
              <Text style={styles.saveSecondaryText}>
                {saving === 'copy' ? EDITOR_SAVING_LABEL : SAVE_COPY_CTA}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.saveHint}>
            {canUpdate ? SAVE_UPDATE_HINT : 'This take is not in History yet — save a copy.'}
          </Text>
          <Text style={styles.saveHint}>{SAVE_COPY_HINT}</Text>
        </View>
      </View>
    </Modal>
    {/* THE TWO SHEETS OF THE v37 BATCH ARE SIBLINGS OF THE EDITOR'S MODAL, not
        children of it — each one presents its own dialog, so a sheet is never a
        dialog stacked inside another dialog (which is where Android gets
        unpredictable about the back button and about touch delivery).

        THE TAB PAGE (item 8) is read-only and derives its layout from the take the
        editor holds. THE SEND-TO SHEET (item 7) is handed THIS page's own MIDI
        export (`shareTakeAsMidi`) rather than a second copy of it, so the two can
        never diverge, and the PDF/email destinations go through the system share
        sheet only (services/takeSendDevice.ts). Both are bound to the editor being
        open (`visible && …`), so a closed editor can never leave one behind. */}
    <TakeTabsView
      visible={visible && tabsOpen}
      take={derived.take}
      onClose={() => setTabsOpen(false)}
    />
    <TakeSendToSheet
      visible={visible && sendOpen}
      take={derived.take}
      chords={pdfChords}
      onSendMidi={shareTakeAsMidi}
      midiBusy={midiBusy}
      midiLine={midiLine}
      onClose={() => setSendOpen(false)}
    />
    </>
  );
};

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#12122b' },
  header: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 8 },
  backBtn: { minHeight: 44, justifyContent: 'center' },
  backText: { color: '#e94560', fontSize: 16, fontWeight: '600' },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '800', marginTop: 2 },
  /**
   * THE PAGE'S SCROLLER IS BOUNDED ON PURPOSE (v36 fix 1). A ScrollView takes the
   * space its flex style gives it; saying `flex: 1` here means the scroller can
   * never be laid out taller than the page and clip its own bottom half (the
   * "page does not scroll down" shape).
   */
  page: { flex: 1 },
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  viewSwitch: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
    padding: 12,
    marginTop: 14,
  },
  viewSwitchLabel: {
    color: '#7d7d99',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  segmentRow: { flexDirection: 'row', marginTop: 8 },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#12122b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginRight: 6,
  },
  segmentOn: { borderColor: '#4ecdc4', backgroundColor: '#0f3460' },
  segmentText: { color: '#c0c0d0', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  segmentTextOn: { color: '#4ecdc4' },
  viewNote: { color: '#a0a0b8', fontSize: 11, lineHeight: 16, marginTop: 8 },
  viewModeTitle: { color: '#4ecdc4', fontSize: 15, fontWeight: '800', marginTop: 14 },
  originalNote: { marginTop: 12 },
  backToEditing: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  backToEditingText: { color: '#4ecdc4', fontSize: 14, fontWeight: '700' },
  intro: { color: '#c0c0d0', fontSize: 13, lineHeight: 19 },
  tip: { color: '#4ecdc4', fontSize: 12, lineHeight: 18, marginTop: 8 },
  factCard: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
    padding: 14,
    marginTop: 14,
  },
  factKey: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  factSummary: { color: '#a0a0b8', fontSize: 12, lineHeight: 17, marginTop: 6 },
  staffBox: { height: 150, marginTop: 14, borderRadius: 12, overflow: 'hidden' },
  laneLabel: { color: '#7d7d99', fontSize: 11, lineHeight: 16, marginTop: 12 },
  lane: { marginTop: 8, maxHeight: 96 },
  laneRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  noteWrap: { position: 'relative', marginRight: 6, justifyContent: 'center' },
  noteBlock: {
    backgroundColor: '#0f3460',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    minHeight: 52,
    justifyContent: 'center',
  },
  noteBlockSelected: { backgroundColor: '#1d4b7a', borderColor: '#ffffff' },
  noteBlockCursor: { borderColor: '#ffb347' },
  noteBlockInner: { minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  noteBlockText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  noteBlockTag: { color: '#4ecdc4', fontSize: 11, marginTop: 2 },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 18,
    backgroundColor: 'rgba(78,205,196,0.25)',
  },
  handleStart: { left: -9, borderTopLeftRadius: 10, borderBottomLeftRadius: 10 },
  handleEnd: { right: -9, borderTopRightRadius: 10, borderBottomRightRadius: 10 },
  panel: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
    padding: 14,
    marginTop: 14,
  },
  panelTitle: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  panelSub: { color: '#7d7d99', fontSize: 11, marginTop: 4 },
  rail: { marginTop: 10, maxHeight: 56 },
  railRow: { flexDirection: 'row', alignItems: 'center' },
  railChip: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#12122b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  railChipOn: { borderColor: '#4ecdc4', backgroundColor: '#0f3460' },
  railChipText: { color: '#c0c0d0', fontSize: 13, fontWeight: '700' },
  railChipTextOn: { color: '#4ecdc4' },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  opBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    backgroundColor: '#0f3460',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 8,
  },
  opBtnOff: { borderColor: '#3a3a52', backgroundColor: '#1a1a2e' },
  opBtnText: { color: '#4ecdc4', fontSize: 13, fontWeight: '700' },
  reason: { color: '#ffb347', fontSize: 11, lineHeight: 16, marginTop: 8 },
  chordRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  chordChip: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#12122b',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 8,
  },
  chordChipYours: { borderColor: '#ffb347' },
  chordChipOn: { borderColor: '#4ecdc4' },
  chordChipText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  chordChipTag: { color: '#7d7d99', fontSize: 10, marginTop: 2 },
  chordEditor: { marginTop: 6 },
  paletteChip: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    backgroundColor: '#0f3460',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 8,
  },
  paletteChipText: { color: '#4ecdc4', fontSize: 13, fontWeight: '700' },
  chordInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#0f3460',
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#ffffff',
    backgroundColor: '#12122b',
    marginTop: 10,
  },
  legend: { color: '#7d7d99', fontSize: 11, marginTop: 14, textAlign: 'center' },
  saveBar: {
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  saveRow: { flexDirection: 'row' },
  savePrimary: {
    flex: 1,
    minHeight: 48,
    backgroundColor: '#e94560',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  savePrimaryText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  saveSecondary: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveSecondaryText: { color: '#4ecdc4', fontSize: 15, fontWeight: '700' },
  saveOff: { opacity: 0.55 },
  saveLine: { color: '#ffb347', fontSize: 12, lineHeight: 17, marginBottom: 8 },
  saveHint: { color: '#7d7d99', fontSize: 11, lineHeight: 15, marginTop: 6 },
  // ── SEND THE TAKE OFF THE DEVICE (v37 item 6) ──
  // The export block's own styling (added with the button itself): a real
  // control above the sticky save bar, with its outcome line under it. Kept
  // here beside the save-bar styles because it lives at the end of the same
  // page and obeys the same 44pt touch-target rule.
  midiBlock: {
    marginTop: 18,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#0f3460',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#16213e',
  },
  midiBtn: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  midiBtnOff: { opacity: 0.55 },
  midiBtnText: { color: '#4ecdc4', fontSize: 14, fontWeight: '700' },
  midiLine: { color: '#4ecdc4', fontSize: 12, lineHeight: 17, marginTop: 8 },
  /**
   * v37 item 8: the "Tabs" button — a first-class action on the page, sitting
   * between the note lane and the chord row at the owner's placement.
   */
  tabsBtn: {
    backgroundColor: '#1b2a4a',
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  tabsBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  /**
   * v37 item 7: the "Send to…" action, under the MIDI export inside the same
   * take-gated block (PDF / email / MIDI in one place).
   */
  sendToBtn: {
    backgroundColor: '#1b2a4a',
    borderColor: '#4ecdc4',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  sendToBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  midiHint: { color: '#7d7d99', fontSize: 11, lineHeight: 15, marginTop: 8 },
});
