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
