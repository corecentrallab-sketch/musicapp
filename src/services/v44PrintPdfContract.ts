/**
 * v44PrintPdfContract.ts — THE SOURCE GUARDS for v44 slice C (transposed
 * full-score print / share-as-PDF, owner 10-24 checklist 4.1).
 *
 * WHY SOURCE GUARDS. `test:tier1` compiles pure services, not screens, so the
 * one thing the gate can never see is whether the READER actually wired the
 * export: a button that calls nothing, an export that hands over a slice of the
 * score instead of the score, or a file name that claims to be an edition are all
 * invisible to every other gate. These predicates read REAL source text (the same
 * rule v43UiContract follows), and `scripts/scorePdf.test.ts` feeds each of them a
 * mutated copy of that source to prove it bites.
 *
 * PURE: string in, boolean out.
 */

/** Strip comments, so a guard is never satisfied by prose and never fails on one. */
function maskComments(source: string): string {
  return (typeof source === 'string' ? source : '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

/** The reader screen this slice wires (one source of truth for the gate). */
export const READER_SCREEN_PATH = 'src/screens/TransposedScoreReaderScreen.tsx';
/** The device half of the export. */
export const PDF_DEVICE_PATH = 'src/services/scorePdfDevice.ts';
/** The pure PDF builder. */
export const PDF_SERVICE_PATH = 'src/services/scorePdf.ts';

/**
 * THE READER HAS THE EXPORT CONTROL, and it is a real control: a Pressable whose
 * handler calls the device export. A label alone is a dead area.
 */
export function readerHasPrintPdfControl(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 6000) return false;
  if (src.indexOf('READER_PDF_CTA') < 0) return false;
  if (!/export const READER_PDF_CTA = ('[^']+'|[A-Z][A-Z0-9_]*)/.test(src)) return false;
  if (src.indexOf('onPress={handleExportPdf}') < 0) return false;
  if (src.indexOf('shareScorePdf(') < 0) return false;
  if (src.indexOf('accessibilityLabel={READER_PDF_CTA}') < 0) return false;
  // …and the honest explanation of what the control does rides with it.
  return src.indexOf('{READER_PDF_HINT}') >= 0;
}

/**
 * THE EXPORT HANDS OVER THE WHOLE SCORE. The ABC is the reader's own state (`abc`
 * — the score on screen in the key the user chose), never a slice and never a
 * re-render from the params the window was opened with.
 */
export function readerExportsTheWholeScore(source: string): boolean {
  const src = maskComments(source);
  const call = src.indexOf('shareScorePdf({');
  if (call < 0) return false;
  const callBody = src.slice(call, call + 400);
  if (!/\babc,/.test(callBody)) return false;
  if (/\babc\s*\.\s*slice\s*\(/.test(src)) return false;
  if (/\babc\s*\.\s*substring\s*\(/.test(src)) return false;
  if (/\bopenedAbc\s*,/.test(callBody)) return false;
  // The key label and offset travel with it, so the PDF says the key it is in.
  if (!/\bkeyLabel,/.test(callBody)) return false;
  return /\boffset,/.test(callBody);
}

/** THE PDF BUILDER CAPS NOTHING: no bar budget, no excerpt constant, no slice. */
export function scorePdfBuilderHasNoBarCap(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 8000) return false;
  if (src.indexOf('export function buildScorePdf(') < 0) return false;
  if (/SAMPLE_EXCERPT_MAX_BARS|MAX_BARS|BARS_PER_PAGE|MAX_MEASURES|firstNBars/i.test(src)) return false;
  if (/measures\s*\.\s*slice\s*\(/.test(src)) return false;
  if (/systems\s*\.\s*slice\s*\(/.test(src)) return false;
  // Every measure parsed is drawn: the systems come straight from the parse.
  return /layOutSystems\(parsed\.measures/.test(src);
}

/**
 * THE FILE IS PROVEN AND SHARED THROUGH THE SYSTEM SHEET. A PDF built but never
 * checked, or written but never read back, is the v40 "won't open" class.
 */
export function pdfIsValidatedAndShared(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 3000) return false;
  if (src.indexOf('validateScorePdf(') < 0) return false;
  if (src.indexOf('takePdfReadBackProblem(') < 0) return false;
  if (src.indexOf('Sharing.shareAsync(') < 0) return false;
  if (src.indexOf('mimeType: SCORE_PDF_MIME_TYPE') < 0) return false;
  // The name comes from the ONE honest builder, never a typed string.
  if (src.indexOf('scorePdfFileName(') < 0) return false;
  return true;
}

/** Strings a score PDF and its file name may never carry. */
export const FORBIDDEN_EDITION_CLAIMS: readonly string[] = [
  'official edition',
  'official sheet music',
  'published edition',
  'publisher edition',
  'Urtext',
  'arranged by',
];

/** NO EDITION CLAIMS anywhere in the builder's own copy. */
export function pdfCopyMakesNoEditionClaim(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 8000) return false;
  // The builder's OWN block-list names these words on purpose — it is the defence,
  // not the offence, so it is removed before the scan.
  const scan = src.replace(/SCORE_PDF_FORBIDDEN_CLAIMS[\s\S]*?\];/, ' ');
  const lower = scan.toLowerCase();
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
  // …and the honest footer that IS allowed is present.
  return scan.indexOf('SCORE_PDF_FOOTER') >= 0;
}

/** The file name pattern the owner asked for, pinned as a predicate. */
export function pdfFileNameIsHonest(source: string): boolean {
  const src = maskComments(source);
  if (src.indexOf('export function scorePdfFileName(') < 0) return false;
  if (src.indexOf('transposed ${key}') < 0) return false;
  if (src.indexOf('original key ${key}') < 0) return false;
  return src.indexOf(' - NoteSnap.pdf') >= 0;
}
