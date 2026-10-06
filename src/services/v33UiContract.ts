/**
 * v33UiContract.ts — the v33 UI SLICES' source contracts (pure, tier1).
 *
 * WHY THIS MODULE EXISTS. The v33 model layers are pure and fully asserted by
 * scripts/v33TakeEditor.test.ts, but the release's riskiest work is the WIRING:
 * the owner-ratified capture page (no Save button, no match card), the staff card,
 * the take-correction editor's save seam, the docked preview, the Home sibling
 * hum button. No emulator runs in this repo's gate, so those are guarded the way
 * every other screen-level rule here is: by reading the REAL screen sources and
 * asserting the contract (the `musicapp-tier1-live-scan-suite` pattern).
 *
 * The scanners below are pure string functions over a source file's text, so
 * scripts/v33UiWiring.test.ts can run them against the real screens AND against
 * pre-fix fixtures that MUST fail. A scanner that cannot fail proves nothing.
 */
import { maskComments } from './modalBackContract';
import { bandRegion } from './frontDoorBands';

/** The element (opening tag + children) that carries `marker`. */
export function elementFromTag(
  masked: string,
  marker: string,
  tag = '<TouchableOpacity',
): string {
  const at = masked.indexOf(marker);
  if (at < 0) return '';
  const open = masked.lastIndexOf(tag, at);
  if (open < 0) return '';
  const close = masked.indexOf(`</${tag.slice(1)}>`, at);
  return close < 0 ? masked.slice(open) : masked.slice(open, close + tag.length + 2);
}

/** Source order of a set of markers, or null when one of them is missing. */
export function markerOrder(source: string, markers: readonly string[]): number[] | null {
  const masked = maskComments(source);
  const out: number[] = [];
  for (const marker of markers) {
    const at = masked.indexOf(marker);
    if (at < 0) return null;
    out.push(at);
  }
  return out;
}

/** True when every marker appears, in the given order. */
export function appearsInOrder(source: string, markers: readonly string[]): boolean {
  const found = markerOrder(source, markers);
  if (!found) return false;
  for (let i = 1; i < found.length; i++) {
    if (found[i] <= found[i - 1]) return false;
  }
  return true;
}

// ─────────────────────── B: the capture page (v33 §B) ───────────────────────

/**
 * The owner-ratified take-end page: CAPTURE-ONLY, no Save button, the auto-save
 * shown as a chip, and the ratified action bar in its ratified order.
 *
 * `windowSource` is src/components/MelodyCaptureWindow.tsx.
 */
export function capturePageIsCaptureOnly(windowSource: string): boolean {
  const masked = maskComments(windowSource);
  if (masked.length < 3000) return false;
  // The rule is visible to the USER, not just to us.
  if (masked.indexOf('CAPTURE_ONLY_CHIP_LABEL') < 0) return false;
  if (masked.indexOf('CAPTURE_ONLY_LINE') < 0) return false;
  // "When you stop": the honest contract, printed before the stop tap.
  if (masked.indexOf('WHEN_YOU_STOP_TITLE') < 0) return false;
  if (masked.indexOf('WHEN_YOU_STOP_ITEMS.map(') < 0) return false;
  // NO Save button anywhere on the page (owner ratification 10-04): the take
  // auto-saves at take end and the page says so with a chip.
  if (masked.indexOf('SAVE_MELODY_CTA') >= 0) return false;
  if (masked.indexOf('onSave') >= 0) return false;
  if (masked.indexOf('SAVED_CHIP_LABEL') < 0) return false;
  if (masked.indexOf('SAVED_CHIP_HINT') < 0) return false;
  if (masked.indexOf('saved ? (') < 0) return false;
  return true;
}

// ─────────────────── C: the take drawn as a staff (v33 §C) ───────────────────

/** How many times a marker appears in a source (the "two rows" test). */
export function countOf(source: string, marker: string): number {
  if (!marker) return 0;
  let at = source.indexOf(marker);
  let count = 0;
  while (at >= 0) {
    count += 1;
    at = source.indexOf(marker, at + marker.length);
  }
  return count;
}

/**
 * The staff card draws the take TWICE — the dimmed raw trace, then the crisp
 * auto-cleaned line — with the "auto-clean ✦" divider between them and the
 * suggested chords above the staff.
 *
 * `cardSource` is src/components/TakeStaffCard.tsx.
 */
export function staffCardDrawsBothRows(cardSource: string): boolean {
  const masked = maskComments(cardSource);
  if (masked.length < 1500) return false;
  // The rows come from the take ALONE: the app's own cleaning pass, then the
  // pure ABC builder. A card that builds its own notes could drift from the
  // sequence, the MIDI export and the editor.
  if (masked.indexOf('autoCleanTake(') < 0) return false;
  if (masked.indexOf('takeStaffRows(') < 0) return false;
  if (masked.indexOf('staffKeyFromKey(') < 0) return false;
  // TWO renders of the SAME renderer: raw + cleaned.
  if (countOf(masked, '<AbcScoreView') < 2) return false;
  if (masked.indexOf('rows.rawAbc') < 0) return false;
  if (masked.indexOf('rows.cleanedAbc') < 0) return false;
  // The raw trace is DIMMED (the theme's raw ink) and the cleaned line is CRISP
  // (the app's teal) — the whole point of the two rows.
  if (masked.indexOf('ink={TAKE_STAFF_RAW_INK}') < 0) return false;
  if (masked.indexOf('ink={TAKE_STAFF_CLEANED_INK}') < 0) return false;
  if (!/TAKE_STAFF_CLEANED_INK\s*=\s*'#4ecdc4'/.test(masked)) return false;
  // …in that order, with the divider label BETWEEN them (and from the model,
  // never a second copy of the string in the view).
  if (
    !appearsInOrder(masked, [
      'ink={TAKE_STAFF_RAW_INK}',
      'rows.dividerLabel',
      'ink={TAKE_STAFF_CLEANED_INK}',
    ])
  ) {
    return false;
  }
  // The chord chips sit ABOVE the staff.
  if (!appearsInOrder(masked, ['styles.chordChip', 'ink={TAKE_STAFF_RAW_INK}'])) return false;
  // The two honest lines and the empty state are rendered (never silence).
  if (masked.indexOf('STAFF_RAW_HONESTY') < 0) return false;
  if (masked.indexOf('STAFF_CLEANED_HONESTY') < 0) return false;
  if (masked.indexOf('STAFF_EMPTY_LINE') < 0) return false;
  if (masked.indexOf('STAFF_CAPTION') < 0) return false;
  return true;
}

/**
 * The staff is fed the take and only the take (v33 §C's standing rule): the flow
 * builds the card from the decoded take + its own analysis, and passes it through
 * the window's `staff` slot. A matched song's notation never reaches this card.
 *
 * `flowSource` is src/screens/HumSearchScreen.tsx; `windowSource` is
 * src/components/MelodyCaptureWindow.tsx.
 */
export function staffIsTheUsersOwnTake(flowSource: string, windowSource: string): boolean {
  const flow = maskComments(flowSource);
  const window = maskComments(windowSource);
  if (flow.indexOf('<TakeStaffCard') < 0) return false;
  if (flow.indexOf('take={take}') < 0) return false;
  if (flow.indexOf('analysis.chords.chords') < 0) return false;
  // Only a take with notes is drawn (a silent take keeps the honest state card).
  if (flow.indexOf("analysis?.state !== 'ready'") < 0) return false;
  // The flow hands it in through the window's own slot.
  if (flow.indexOf('staff={staffCard}') < 0) return false;
  if (window.indexOf('staff?: React.ReactNode') < 0) return false;
  if (window.indexOf('{analysis.state === \'ready\' ? staff : null}') < 0) return false;
  // A matched song never renders notation on this card: the card is built from
  // the take, and no match object is passed to it.
  if (/<TakeStaffCard[\s\S]{0,400}(humResult|topMatch|matchLine)/.test(flow)) return false;
  return true;
}

/**
 * The one renderer grows an INK seam instead of a second renderer (v33 §C):
 * `generateAbcHtml(abc, ink, background)` puts the ink into the ABCjs options
 * (`foregroundColor`) and into the document's own CSS, and the WebView reloads
 * when it changes.
 *
 * `viewSource` is src/components/AbcScoreView.tsx.
 */
export function abcViewHasInkSeam(viewSource: string): boolean {
  const masked = maskComments(viewSource);
  if (masked.length < 1200) return false;
  if (!/export function generateAbcHtml\(\s*abc: string,\s*ink: string/.test(masked)) return false;
  if (masked.indexOf('foregroundColor: ink') < 0) return false;
  // The document's own CSS takes the same ink, so lines and text follow too.
  if (!/fill: \$\{ink\}/.test(masked)) return false;
  if (masked.indexOf('background: ${background}') < 0) return false;
  // The prop exists and is threaded through the render + the WebView key.
  if (masked.indexOf('ink?: string') < 0) return false;
  if (masked.indexOf('generateAbcHtml(abc, ink, background)') < 0) return false;
  return true;
}

// ────────── D: the take-correction editor (v33 §D) ──────────

/** Every model entry point the surface must actually route to. */
const EDITOR_MODEL_OPS: readonly string[] = [
  'createEditorState(',
  'deriveTake(',
  'setNotePitch(',
  'setNoteBoundary(',
  'addNoteAfter(',
  'canRemoveNote(',
  'removeNote(',
  'insertRestAfter(',
  'overrideChord(',
  'chordPalette(',
  'undo(',
  'redo(',
  'resetToDetected(',
  'noteTag(',
];

/**
 * The editor surface really corrects every fact the brief lists — pitch (with an
 * AUDIBLE verify), timing boundaries by drag, add/remove/rest with the last-note
 * guard, chord overrides with a free input, undo/redo/reset — inside ≥44dp
 * targets, with the tags visible and no transcription claim anywhere.
 *
 * `editorSource` is src/components/TakeCorrectionEditor.tsx.
 */
export function editorSurfaceCorrectsEveryFact(editorSource: string): boolean {
  const masked = maskComments(editorSource);
  if (masked.length < 8000) return false;
  for (const op of EDITOR_MODEL_OPS) {
    if (masked.indexOf(op) < 0) return false;
  }
  // The TOUCH layer: a vertical pitch drag AND two boundary handles (drag is the
  // primary gesture of the brief's §3b, not a hidden extra).
  if (countOf(masked, 'PanResponder.create') < 2) return false;
  if (masked.indexOf("boundaryPan('start')") < 0) return false;
  if (masked.indexOf("boundaryPan('end')") < 0) return false;
  if (masked.indexOf('LANE_PX_PER_SEMITONE') < 0) return false;
  // AUDIBLE VERIFY: a rail tap sets the pitch AND plays it (one argument pair).
  if (!/setNotePitch\(stateRef\.current, selected\.id, midi\), midi\)/.test(masked)) return false;
  // Every target the user presses is at least 44dp.
  if (countOf(masked, 'minHeight: 44') < 6) return false;
  // The tags and the chord honesty are on the surface.
  if (masked.indexOf('NOTE_TAG_DETECTED') < 0) return false;
  if (masked.indexOf('NOTE_TAG_CORRECTED') < 0) return false;
  if (masked.indexOf('NOTE_TAG_ADDED') < 0) return false;
  if (masked.indexOf('CHORD_TAG_YOURS') < 0) return false;
  // The two guards say WHY instead of failing silently.
  if (masked.indexOf('EDITOR_LAST_NOTE_REASON') < 0) return false;
  if (masked.indexOf('EDITOR_NO_REDETECT_REASON') < 0) return false;
  // BOTH save actions exist and are wired (the sticky bar).
  if (masked.indexOf("void doSave('update')") < 0) return false;
  if (masked.indexOf("void doSave('copy')") < 0) return false;
  if (masked.indexOf('SAVE_UPDATE_CTA') < 0 || masked.indexOf('SAVE_COPY_CTA') < 0) return false;
  // Android BACK leaves the editor, never the app.
  if (masked.indexOf('useHardwareBack(') < 0) return false;
  // No line anywhere claims more than a corrected user take.
  if (/studio transcription/i.test(masked)) return false;
  return true;
}

/**
 * A corrected take is written through the ONE seam, as a PLAIN note list (the
 * open contract of take-correction-editor-brief.md §1): both save actions end at
 * melodyStore.updatePersonalMelodyTake, and the editor never builds its own take
 * shape.
 *
 * `storeSource` is src/services/correctedTakeStore.ts.
 */
export function editorWritesThroughOneSeam(
  storeSource: string,
  editorSource: string,
): boolean {
  const store = maskComments(storeSource);
  const editor = maskComments(editorSource);
  if (store.length < 1200) return false;
  // BOTH paths reach the row's take through the same seam.
  if (countOf(store, 'updatePersonalMelodyTake(') < 2) return false;
  if (store.indexOf("mode === 'copy'") < 0) return false;
  // The copy is a NEW row (nothing already in History is overwritten).
  if (store.indexOf('savePersonalMelodyRow(') < 0) return false;
  // A failed write is never silent.
  if (store.indexOf('SAVE_UPDATE_FAILED_LINE') < 0) return false;
  if (store.indexOf('SAVE_COPY_FAILED_LINE') < 0) return false;
  // The corrected take stays a generic note list.
  if (store.indexOf('Array.isArray(take.notes)') < 0) return false;
  if (store.indexOf('SavedCaptureTake') < 0) return false;
  // The editor writes the DERIVED take (the single source of truth) with the row
  // and the clip it was opened on.
  if (editor.indexOf('saveCorrectedTake(') < 0) return false;
  if (editor.indexOf('take: derived.take') < 0) return false;
  if (editor.indexOf('rowId,') < 0) return false;
  if (editor.indexOf('audioUri: audioUri ?? null') < 0) return false;
  return true;
}

/**
 * The editor is reachable from BOTH doors the brief names — the capture window
 * and a History melody row — and it is the same component in both places.
 *
 * `flowSource` is src/screens/HumSearchScreen.tsx; `historySource` is
 * src/screens/HistoryScreen.tsx.
 */
export function editorReachedFromBothDoors(
  flowSource: string,
  historySource: string,
): boolean {
  const flow = maskComments(flowSource);
  const history = maskComments(historySource);
  // Door 1: the capture window's own "Correct notes, pitch or chords ›" CTA.
  if (flow.indexOf('<TakeCorrectionEditor') < 0) return false;
  if (flow.indexOf('onCorrectTake={() => setEditorOpen(true)}') < 0) return false;
  if (flow.indexOf('visible={editorOpen}') < 0) return false;
  if (flow.indexOf('rowId={analysis?.rowId ?? null}') < 0) return false;
  if (flow.indexOf('audioUri={audioUri}') < 0) return false;
  // Door 2: a History melody row, driven by the row's own take/clip.
  if (history.indexOf('<TakeCorrectionEditor') < 0) return false;
  if (history.indexOf('take={editTake.capture ?? null}') < 0) return false;
  if (history.indexOf('rowId={editTake.id}') < 0) return false;
  if (history.indexOf('audioUri={editTake.personalMelody?.audioUri ?? null}') < 0) return false;
  return true;
}

/**
 * NO DRIFT: what the page SHOWS is what gets exported. Once the take is in hand
 * the export encodes THAT take (which the editor's corrections were written
 * into) instead of re-decoding the raw recording over the top of them.
 *
 * `flowSource` is src/screens/HumSearchScreen.tsx.
 */
export function correctedTakeIsWhatExports(flowSource: string): boolean {
  const flow = maskComments(flowSource);
  if (flow.indexOf('if (take) {') < 0) return false;
  if (!appearsInOrder(flow, ['exportCaptureMidiFromTake(take', "exportCaptureMidiFromRecording({ uri: takeUri })"])) {
    return false;
  }
  return true;
}

// ────────── G: the docked Hum-Along preview (v33 §G) ──────────

/**
 * The Hum-Along preview is DOCKED INSIDE the take-correction editor, above the
 * sticky save bar (owner-ratified option 4, 10-04) — one control row with play/
 * pause, loop, prev/next, the preview-only tempo rail, the instrument overlays
 * and the honesty captions. A second Modal (a separate preview screen) fails.
 *
 * `editorSource` is src/components/TakeCorrectionEditor.tsx; `sectionSource` is
 * src/components/TakePreviewSection.tsx.
 */
export function previewIsDockedInTheEditor(
  editorSource: string,
  sectionSource: string,
): boolean {
  const editor = maskComments(editorSource);
  const section = maskComments(sectionSource);
  if (section.length < 1500) return false;
  // The control row, all four controls, each labelled and wired.
  if (section.indexOf('PREVIEW_PLAY_LABEL') < 0) return false;
  if (section.indexOf('PREVIEW_PAUSE_LABEL') < 0) return false;
  if (section.indexOf('PREVIEW_LOOP_ON_LABEL') < 0) return false;
  if (section.indexOf('PREVIEW_LOOP_OFF_LABEL') < 0) return false;
  if (section.indexOf('PREVIEW_PREV_LABEL') < 0) return false;
  if (section.indexOf('PREVIEW_NEXT_LABEL') < 0) return false;
  if (section.indexOf('preview.toggle') < 0) return false;
  if (section.indexOf('preview.toggleLoop') < 0) return false;
  if (section.indexOf('preview.step(-1)') < 0) return false;
  if (section.indexOf('preview.step(1)') < 0) return false;
  // The PREVIEW-ONLY tempo rail, the instrument overlays and the captions.
  if (section.indexOf('preview.setTempoPct(') < 0) return false;
  if (section.indexOf('previewTempoLabel(preview.tempoPct)') < 0) return false;
  if (section.indexOf('PREVIEW_TEMPO_CAPTION') < 0) return false;
  if (section.indexOf('PREVIEW_INSTRUMENTS.map(') < 0) return false;
  if (section.indexOf('preview.setInstrument(') < 0) return false;
  if (section.indexOf('PREVIEW_ONLY_CAPTION') < 0) return false;
  // …inside ≥44dp targets.
  if (countOf(section, 'minHeight: 44') < 2) return false;

  // DOCKED: rendered in the editor's own scroll body, ABOVE the sticky save bar.
  if (editor.indexOf('<TakePreviewSection preview={preview} />') < 0) return false;
  if (!appearsInOrder(editor, ['styles.body', '<TakePreviewSection', 'styles.saveBar'])) return false;
  // ONE screen: the editor owns exactly one Modal (a separate preview screen
  // would be a second one — the treatment the owner rejected on 10-04).
  if (countOf(editor, '<Modal') !== 1) return false;
  return true;
}

/** Operations that WRITE a take — none of them may appear in the preview engine. */
const TAKE_WRITERS: readonly string[] = [
  'setNoteBoundary(',
  'setNotePitch(',
  'addNoteAfter(',
  'removeNote(',
  'insertRestAfter(',
  'transposeTake(',
  'requantizeTake(',
];

/**
 * The preview engine READS the take and nothing else: it builds the timeline from
 * takePreview.buildPreviewTimeline, runs on a plain JS clock, plays the generated
 * tone bank, and never contains a take-writing operation — which is the
 * "tempo slider must never rewrite note times" rule, enforced at the source.
 *
 * `hookSource` is src/hooks/useNotePreview.ts.
 */
export function previewEngineNeverRewritesTheTake(hookSource: string): boolean {
  const hook = maskComments(hookSource);
  if (hook.length < 1200) return false;
  if (hook.indexOf('buildPreviewTimeline(') < 0) return false;
  if (hook.indexOf('setInterval(') < 0) return false;
  if (hook.indexOf('PREVIEW_TICK_MS') < 0) return false;
  if (hook.indexOf('cursorIndexAt(') < 0) return false;
  if (hook.indexOf('clampPreviewTempo(') < 0) return false;
  if (hook.indexOf('toneSourceFor(') < 0) return false;
  for (const writer of TAKE_WRITERS) {
    if (hook.indexOf(writer) >= 0) return false;
  }
  return true;
}

/**
 * The action bar: Export MIDI · "Find this melody ›" · Record another melody ·
 * Done, each WIRED (a rendered control with no handler is the dead-CTA class this
 * app keeps getting bitten by).
 */
export function takeActionBarWired(windowSource: string): boolean {
  const masked = maskComments(windowSource);
  // Only the RENDERED body counts: the same constant names appear in the import
  // block at the top of the file, and reading their order there would prove
  // nothing about the action bar the user sees.
  const returnAt = masked.indexOf('return (');
  const body = returnAt >= 0 ? masked.slice(returnAt) : masked;
  if (!appearsInOrder(body, ['MIDI_EXPORT_LABEL', 'FIND_THIS_MELODY_CTA', 'RECORD_ANOTHER_CTA', 'DONE_CTA'])) {
    return false;
  }
  if (body.indexOf('onPress={onExportMidi}') < 0) return false;
  if (body.indexOf('onPress={onFindMelody}') < 0) return false;
  if (body.indexOf('onPress={onRecordAgain}') < 0) return false;
  if (body.indexOf('onPress={onClose}') < 0) return false;
  // Each control must be a real one on the page while the take is shown.
  if (body.indexOf('styles.midiBtn') < 0) return false;
  if (body.indexOf('styles.findBtn') < 0) return false;
  if (body.indexOf('styles.secondaryBtn') < 0) return false;
  return true;
}

/**
 * NO match surface renders on the capture page (owner device-pass 10-03): the
 * window carries no match line, no "open the piece" button and no no-match copy;
 * the flow holds the library pass's outcome behind its own explicit step.
 */
export function matchResultsAreOffThePage(windowSource: string, flowSource: string): boolean {
  const window = maskComments(windowSource);
  const flow = maskComments(flowSource);
  if (window.indexOf('matchLine') >= 0) return false;
  if (window.indexOf('onOpenMatch') >= 0) return false;
  if (window.indexOf('humNoMatchMessage') >= 0) return false;
  if (window.indexOf('No match for that melody') >= 0) return false;
  // The miss card lives inside the flow's OVERLAY, between its Modal tags — not
  // in the page's scroll body, which is what the owner's device pass asked for.
  const modalOpen = flow.indexOf('<Modal');
  const modalClose = flow.indexOf('</Modal>');
  const missAt = flow.indexOf("stage === 'no-match' && outcome && (");
  if (modalOpen < 0 || modalClose < 0 || missAt < 0) return false;
  if (!(modalOpen < missAt && missAt < modalClose)) return false;
  if (flow.indexOf('visible={findOpen}') < 0) return false;
  if (flow.indexOf('onFindMelody={handleFindMelody}') < 0) return false;
  // The miss may only be opened by that step (the gate is the step's own state).
  if (!/if\s*\(stage === 'no-match'\)\s*\{\s*setFindOpen\(true\)/.test(flow)) return false;
  // The honest miss copy and the way back to the user's own take both stay.
  if (flow.indexOf('humNoMatchMessage') < 0) return false;
  if (flow.indexOf('Back to my take') < 0) return false;
  return true;
}

// ────────── E: the front door's hum SIBLING CARD (v33 §E) ──────────

/** The declaration body of a `key: { … }` entry in a stylesheet. */
export function styleBlockOf(source: string, key: string): string {
  const at = source.indexOf(`${key}: {`);
  if (at < 0) return '';
  const close = source.indexOf('},', at);
  return close < 0 ? source.slice(at, at + 400) : source.slice(at, close);
}

/**
 * The Listen hero stays DOMINANT and Hum is a real SIBLING CARD directly beneath
 * it (owner 10-03, designer concept 5): its own full-width card element, its own
 * title + body copy from frontDoor.ts, one tap that opens the hum flow (whose
 * capture window records on mount), and the teaching line under the pair. A
 * chip, a menu item and the v32 quiet underlined text row all fail.
 *
 * `homeSource` is src/screens/HomeScreen.tsx.
 */
export function humIsTheHerosSiblingCard(homeSource: string): boolean {
  const masked = maskComments(homeSource);
  if (masked.length < 5000) return false;
  const heroAt = masked.indexOf('onPress={handleHeroTap}');
  const humAt = masked.indexOf('onPress={handleHumEntry}');
  if (heroAt < 0 || humAt < 0) return false;
  // SIBLING, not nested-in-the-hero and not a rival above it: it renders after.
  if (humAt < heroAt) return false;
  // Its OWN element, carrying the module's copy by reference.
  const card = elementFromTag(masked, 'styles.humEntryBtn');
  if (!card) return false;
  if (card.indexOf('onPress={handleHumEntry}') < 0) return false;
  if (card.indexOf('HUM_SIBLING_TITLE') < 0) return false;
  if (card.indexOf('HUM_SIBLING_BODY') < 0) return false;
  // The style really IS a card: full width + the v33 teal, and NOT the v32
  // quiet text row (underlined, unfilled).
  const style = styleBlockOf(masked, 'humEntryBtn');
  if (!style) return false;
  if (style.indexOf("width: '100%'") < 0) return false;
  if (style.indexOf('#4ecdc4') < 0) return false;
  if (/textDecorationLine/.test(style)) return false;
  // …and the one line that teaches which door is which.
  if (masked.indexOf('HUM_SPLIT_TEACH_LINE') < 0) return false;
  return true;
}

/**
 * The search field is OUT of the Listen/Hum block and has its OWN Discover band
 * (owner 10-04: the search bar under hum/whistle "does not fit the flow there").
 * Band A may not carry the chip; the Discover band must carry it, labelled from
 * the band model and wired to the real search.
 *
 * `homeSource` is src/screens/HomeScreen.tsx.
 */
export function searchHasItsOwnDiscoverBand(homeSource: string): boolean {
  const bandA = bandRegion(homeSource, 'identify');
  const discover = bandRegion(homeSource, 'discover');
  if (!bandA || !discover) return false;
  if (bandA.indexOf('styles.findAnySongChip') >= 0) return false;
  if (discover.indexOf('style={styles.findAnySongChip}') < 0) return false;
  if (discover.indexOf('onPress={handleFindAnySong}') < 0) return false;
  if (discover.indexOf('FIND_ANY_SONG_CHIP_LABEL') < 0) return false;
  if (discover.indexOf('BAND_TITLES.discover') < 0) return false;
  // The band's own honest line: search is a destination, not a promise.
  if (discover.indexOf('DISCOVER_BAND_NOTE') < 0) return false;
  return true;
}

// ────────── F1: a History melody row plays its SAVED clip (v33 §F1) ──────────

/** Operations that REBUILD audio — none may appear in the clip player. */
const AUDIO_REBUILDERS: readonly string[] = [
  'buildPreviewTimeline(',
  'toneSourceFor(',
  'toneBank',
  'createBuffer(',
];

/**
 * A History melody row plays the take it SAVED (owner 10-04 §F1): the row's own
 * `personalMelody.audioUri` — the clip the capture window persisted in
 * notesnap-melodies/ — through expo-av, with the control living INSIDE the
 * melody block (beside MIDI export / the correction editor) and the honest
 * caption on the row while it plays. The player never re-synthesises the notes:
 * that would be a different recording, not the user's take.
 *
 * `historySource` is src/screens/HistoryScreen.tsx; `hookSource` is
 * src/hooks/useTakeClipPlayer.ts.
 */
export function historyRowPlaysItsSavedClip(
  historySource: string,
  hookSource: string,
): boolean {
  const history = maskComments(historySource);
  const hook = maskComments(hookSource);
  if (history.length < 5000) return false;
  if (hook.length < 1200) return false;
  // The control is inside the melody block (a non-melody row has no take).
  if (
    !appearsInOrder(history, [
      'item.capture?.notes?.length ? (',
      'takePlaybackAvailable(item)',
      'styles.playTakeBtn',
    ])
  ) {
    return false;
  }
  // …and it hands the player THAT ROW's own clip.
  if (history.indexOf('takePlayer.toggle({') < 0) return false;
  if (history.indexOf('id: item.id,') < 0) return false;
  if (history.indexOf('personalMelody: item.personalMelody ?? null,') < 0) return false;
  // Labels, accessibility and the honest lines all come from the model.
  if (history.indexOf('takePlaybackLabel({') < 0) return false;
  if (history.indexOf('takePlaybackAccessibilityLabel(') < 0) return false;
  // The RENDERED use, not the import line: a caption that is only imported is
  // not a caption the user can read.
  if (history.indexOf('{TAKE_PLAYBACK_CAPTION}') < 0) return false;
  if (history.indexOf('{TAKE_PLAYBACK_MISSING_LINE}') < 0) return false;
  if (history.indexOf('takePlayer.note?.id === item.id') < 0) return false;
  // A row with no clip says so instead of offering a dead button.
  if (!/\) : \(/.test(history)) return false;
  if (history.indexOf('styles.playTakeMissing') < 0) return false;
  // The player itself: expo-av, the FILE URI, and exactly one audible take.
  if (hook.indexOf('Audio.Sound.createAsync(') < 0) return false;
  if (hook.indexOf('{ uri }') < 0) return false;
  if (hook.indexOf('stopAsync()') < 0) return false;
  if (hook.indexOf('unloadAsync()') < 0) return false;
  if (hook.indexOf('setOnPlaybackStatusUpdate(') < 0) return false;
  for (const rebuilder of AUDIO_REBUILDERS) {
    if (hook.indexOf(rebuilder) >= 0) return false;
  }
  return true;
}

// ────────── F3: the search retries a typo'd query (v33 §F3) ──────────

/**
 * The find-a-piece search is not a dead end on a MISSPELLING (owner 10-04:
 * "toccatta and fugue" for a piece the library holds): when the typed query
 * finds nothing, the screen retries the model's variant ladder and prints which
 * query actually produced the results it shows. The ladder and the notice line
 * come from services/fuzzySearch.ts — the screen may not invent its own.
 *
 * `screenSource` is src/screens/FindPieceScreen.tsx.
 */
export function searchRetriesTyposAndSaysSo(screenSource: string): boolean {
  const masked = maskComments(screenSource);
  if (masked.length < 4000) return false;
  if (masked.indexOf('queryVariants(') < 0) return false;
  if (masked.indexOf('retryNoticeLine(') < 0) return false;
  if (masked.indexOf('rankFuzzyMatches(') < 0) return false;
  // The ladder re-runs the REAL catalog search (same seam, no second search).
  if (countOf(masked, 'searchPieces(') < 2) return false;
  // The user's own words are tried FIRST, and the ladder only runs when they
  // found nothing.
  if (masked.indexOf('sorted.length === 0') < 0) return false;
  // The notice is state, rendered on the surface (never computed and dropped).
  if (masked.indexOf('setRetryNotice(') < 0) return false;
  if (masked.indexOf('{retryNotice}') < 0) return false;
  if (masked.indexOf('styles.retryNotice') < 0) return false;
  // A variant that found nothing leaves the honest empty state alone.
  if (masked.indexOf("setStatus('empty')") < 0) return false;
  return true;
}

// ────────── F4: the practice components are grouped (v33 §F4) ──────────

/**
 * The practice/streak components are ONE group, in both places the owner named
 * (10-04): the Settings section is titled from the shared model (not the
 * hardcoded v32 strings) and sits ABOVE "Your Plan", and the Home streak nudge
 * lives INSIDE band B (today's practice card), not floating between bands.
 *
 * `settingsSource` is src/screens/SettingsScreen.tsx; `homeSource` is
 * src/screens/HomeScreen.tsx.
 */
export function practiceComponentsAreGrouped(
  settingsSource: string,
  homeSource: string,
): boolean {
  const settings = maskComments(settingsSource);
  const home = maskComments(homeSource);
  if (settings.length < 4000) return false;
  if (home.length < 5000) return false;
  // Settings: the section title/subtitle and the streak row copy come from the
  // model — the v32 literals are gone (a retitle that leaves the old string in
  // place proves nothing).
  if (settings.indexOf('PRACTICE_SECTION_TITLE') < 0) return false;
  if (settings.indexOf('PRACTICE_SECTION_SUBTITLE') < 0) return false;
  if (settings.indexOf('PRACTICE_STREAK_ROW_TITLE') < 0) return false;
  if (settings.indexOf('Practice reminders') >= 0) return false;
  if (settings.indexOf('Daily streak nudge') >= 0) return false;
  // …and the group sits ABOVE the plan/billing sections (owner: the reminder
  // read as part of Billing, which is what the retitle is for).
  if (!appearsInOrder(settings, ['PRACTICE_SECTION_TITLE', '>Your Plan<'])) return false;
  // Home: the streak nudge is part of band B (today's practice card).
  const bandB = bandRegion(home, 'today');
  if (!bandB) return false;
  if (bandB.indexOf('<StreakNudgeCard') < 0) return false;
  if (bandB.indexOf('surface="home"') < 0) return false;
  // It is NOT left floating between the listening band and band B.
  const bandA = bandRegion(home, 'identify');
  const discover = bandRegion(home, 'discover');
  if (bandA.indexOf('<StreakNudgeCard') >= 0) return false;
  if (discover.indexOf('<StreakNudgeCard') >= 0) return false;
  return true;
}

// ────────── F5: a transposed copy really re-opens (v33 §F5) ──────────

/**
 * A score the user transposed and saved must be what they SEE when they re-open
 * it (owner 10-04 §F5: "transposed score not visible on re-open").
 *
 * TWO defects produced that report, and both are guarded here:
 *   1. the editor painted the BUNDLED default score first (Für Elise) and then
 *      replaced it with the library copy — so the first frame was somebody
 *      else's piece, not the user's transposed copy;
 *   2. the WebView was keyed on `abc.length` + the first character, so a loaded
 *      copy whose ABC has the same length and leading character as the default
 *      (exactly the case for a transposed copy of that same piece) reused the
 *      stale render — the transposed score never appeared.
 *
 * The fix: the editor holds NO default score when a score was requested (it says
 * "Loading score…" until the requested one resolves), and the score view keys on
 * the whole ABC (a content fingerprint from abcRenderKey), so any change —
 * including the store→read of a transposed copy — repaints.
 *
 * `editorSource` is src/screens/NotationEditorScreen.tsx; `viewSource` is
 * src/components/AbcScoreView.tsx.
 */
export function transposedCopyIsWhatReopens(
  editorSource: string,
  viewSource: string,
): boolean {
  const editor = maskComments(editorSource);
  const view = maskComments(viewSource);
  if (editor.length < 3000) return false;
  if (view.length < 1200) return false;
  // The editor starts with NO score (no bundled default on the first frame)…
  if (!/useState<AbcScore \| null>\(null\)/.test(editor)) return false;
  if (/useState<AbcScore>\(\s*PUBLIC_DOMAIN_ABC_SCORES\[0\]\s*\)/.test(editor)) return false;
  // …says so honestly while the requested one loads, and never renders the
  // staff without a score.
  if (editor.indexOf('if (loading || !selected)') < 0) return false;
  // The requested library copy is loaded through the store's own read seam and
  // becomes the selected score.
  if (editor.indexOf('getLibraryItem(itemId)') < 0) return false;
  if (editor.indexOf('readAbcText(item)') < 0) return false;
  if (editor.indexOf('scoreFromAbc(abc, item.title)') < 0) return false;
  // The staff renders the SELECTED score's abc (never a constant).
  if (editor.indexOf('transposedAbc') < 0) return false;
  if (countOf(editor, '<AbcScoreView abc={') !== 1) return false;
  // The renderer keys on the whole ABC content, not on its length/prefix.
  if (view.indexOf('abcRenderKey(') < 0) return false;
  if (/abc\.length/.test(view)) return false;
  if (/abc\.charCodeAt\(/.test(view)) return false;
  return true;
}

