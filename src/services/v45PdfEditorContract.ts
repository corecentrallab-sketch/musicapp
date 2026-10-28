/**
 * v45PdfEditorContract.ts — THE SOURCE GUARDS for v45 slice 5 (print / share as
 * PDF from the NOTATION EDITOR, exporting the TRANSPOSED score).
 *
 * WHY THESE EXIST, AND WHY THEY ARE A SIBLING OF v44PrintPdfContract. v44 slice C
 * pinned the READER's export (that file, unchanged and still fully green). The
 * owner's v44 on-device pass found the other half missing: "PDF only in the
 * reader, not the editor" — the surface where the transposing actually happens
 * had no export at all. `test:tier1` compiles pure services, not screens, so the
 * one thing no other gate can see is whether the editor really wired it:
 *   - a control that renders but calls nothing (a dead surface),
 *   - an export fed a SLICE instead of the score,
 *   - an export fed the ORIGINAL/opened ABC instead of the transposed one (the
 *     file would then print the wrong key, which is exactly what the owner asked
 *     this button to get right),
 *   - an export that lost the key label / offset, so the page and the file name
 *     cannot say which key the score is in,
 *   - copy that types an edition/publisher claim, or re-types the builder's words
 *     instead of reusing them.
 *
 * PURE: string in, boolean out. Each predicate is fed a MUTATED copy of the real
 * screen text by `scripts/v45PdfEditor.test.ts` to prove it bites.
 */
import { FORBIDDEN_EDITION_CLAIMS } from './v44PrintPdfContract';

/** Strip comments, so a guard is never satisfied by prose and never fails on one. */
function maskComments(source: string): string {
  return (typeof source === 'string' ? source : '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

/** The editor screen this slice wires (one source of truth for the gate). */
export const EDITOR_SCREEN_PATH = 'src/screens/NotationEditorScreen.tsx';

/**
 * THE EDITOR HAS THE EXPORT CONTROL, and it is a REAL control: a Pressable whose
 * handler is wired, that carries an accessibility label, an honest explanation,
 * and a busy state. A label with no handler is the dead area this exists to stop.
 */
export function editorHasPrintPdfControl(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 6000) return false;
  // The control's words are the builder's own constant, not typed here.
  if (!/export const EDITOR_PDF_CTA = SCORE_PDF_CTA;/.test(src)) return false;
  // …and the Pressable is really wired to the export handler (not an empty arrow).
  if (src.indexOf('onPress={handleExportPdf}') < 0) return false;
  if (src.indexOf('shareScorePdf(') < 0) return false;
  // A screen reader hears the same words the eye sees.
  if (src.indexOf('accessibilityLabel={EDITOR_PDF_CTA}') < 0) return false;
  // It cannot be pressed twice while a file is being built and proved.
  if (src.indexOf('disabled={exportingPdf}') < 0) return false;
  // …and the honest explanation of what the control does rides with it.
  return src.indexOf('{EDITOR_PDF_HINT}') >= 0;
}

/**
 * THE EXPORT HANDS OVER THE WHOLE TRANSPOSED SCORE. The ABC is `transposedAbc` —
 * the editor's own memo, the same text the staff draws and the same text "View
 * full score" navigates with — never a slice, and never the loaded/original ABC
 * (`sourceAbc`, `selected.abc`): the user has been stepping the key, and the file
 * must be the key on screen. The key label and the offset travel with it so the
 * page header and the file name say the key the score is in.
 */
export function editorExportsTheTransposedWholeScore(source: string): boolean {
  const src = maskComments(source);
  const call = src.indexOf('shareScorePdf({');
  if (call < 0) return false;
  const callBody = src.slice(call, call + 400);
  if (!/abc:\s*transposedAbc\s*,/.test(callBody)) return false;
  // No slice of the score may reach the builder, anywhere on this screen.
  if (/\btransposedAbc\s*\.\s*(?:slice|substring|substr)\s*\(/.test(src)) return false;
  // The ORIGINAL/opened ABC must not be what gets printed.
  if (/\b(?:sourceAbc|openedAbc)\s*,/.test(callBody)) return false;
  if (/\bselected\s*\.\s*abc\b/.test(callBody)) return false;
  // The key the file says it is in, and the transposition it is at.
  if (!/keyLabel:\s*keyLabels\.to\s*,/.test(callBody)) return false;
  return /\boffset\s*,/.test(callBody);
}

/**
 * NO EDITION CLAIM, AND NO RE-TYPED COPY. The control and its hint come from the
 * ONE honest builder (`services/scorePdf.ts`, the same constants the reader
 * renders), so the two surfaces cannot describe one file two different ways; and
 * nothing on this screen asserts an edition, a publisher or an arranger.
 */
export function editorPdfCopyMakesNoEditionClaim(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 6000) return false;
  if (!/export const EDITOR_PDF_CTA = SCORE_PDF_CTA;/.test(src)) return false;
  if (!/export const EDITOR_PDF_HINT = SCORE_PDF_HINT;/.test(src)) return false;
  // The label may not be typed again on the surface — reuse, never a second copy.
  if (src.indexOf("'Print / share as PDF'") >= 0) return false;
  const lower = src.toLowerCase();
  for (const claim of FORBIDDEN_EDITION_CLAIMS) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(claim.toLowerCase(), from);
      if (at < 0) break;
      // "not a published edition" is a denial, not a claim — only assertions fail.
      const before = lower.slice(Math.max(0, at - 14), at);
      if (!/(?:\bnot|\bnever|\bno)\b[a-z ]*$/.test(before)) return false;
      from = at + claim.length;
    }
  }
  return true;
}

/**
 * THE EXPORT IS PURE AND LOCAL. A PDF button on an editing surface has no business
 * opening a browser, a retailer or a network route: the file is built from the
 * app's own score data, written to the cache and handed to the system share
 * sheet. Nothing here may carry a link of any kind.
 */
export function editorPdfExportStaysLocal(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 6000) return false;
  if (/https?:\/\//i.test(src)) return false;
  if (/Linking\s*\.\s*(?:openURL|canOpenURL)\s*\(/.test(src)) return false;
  if (/sheet\s*music\s*direct|music\s*notes/i.test(src)) return false;
  // …and the control is really here (this predicate never passes on a bare file).
  return src.indexOf('EDITOR_PDF_CTA') >= 0 && src.indexOf('shareScorePdf(') >= 0;
}
