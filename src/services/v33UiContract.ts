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
