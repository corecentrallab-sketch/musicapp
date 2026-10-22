/**
 * v43Slice2Contract.ts — source-scan guards for the v43 slice-2 fix batch.
 *
 * Two fixes that a user has to be able to SEE, and that no pure-logic test can
 * see on its own:
 *
 *   A. The notation surfaces must print the score's honest LENGTH, and the score
 *      renderer must be BUNDLED (a WebView that fetches abcjs from a CDN draws
 *      nothing offline — the owner's "empty staff").
 *   D. The "Choose a piece" picker must show all eight pieces: a wrapping grid
 *      under a label whose count is derived from the list.
 *
 * Each predicate takes SOURCE TEXT (plain strings), so the suite can read the
 * real files and mutate them (see the repo's source-scan technique: mutate +
 * re-run with no recompile proves the guard actually bites).
 *
 * Pure logic, no react-native / expo imports (plain Node tests).
 */

/**
 * Hostnames that mean "the app is fetching its renderer at runtime".
 * Assembled from parts ON PURPOSE: this module is itself scanned by the suite
 * below (no file under src/ may name a renderer CDN), so the guard's own list
 * must not read as a fetch site.
 */
export const RENDERER_CDN_HOSTS: string[] = [
  'cdn.' + 'jsdelivr' + '.net',
  'unpkg' + '.com',
  'cdnjs' + '.cloudflare.com',
];

/** The picker's label must come from the shared builder, not a typed string. */
export function pickerLabelIsDerived(editorSource: string): boolean {
  const src = typeof editorSource === 'string' ? editorSource : '';
  return (
    src.includes('choosePieceLabel(PUBLIC_DOMAIN_ABC_SCORES.length)') &&
    // The count is never typed into the label.
    !/>\s*Choose a piece\s*</.test(src)
  );
}

/** The picker lays all eight out at once: a wrapping row, not a scroller. */
export function pickerWraps(editorSource: string): boolean {
  const src = typeof editorSource === 'string' ? editorSource : '';
  const grid = /pickerGrid:\s*\{([\s\S]*?)\}/.exec(src);
  if (!grid) return false;
  const body = grid[1];
  const wraps = /flexDirection:\s*'row'/.test(body) && /flexWrap:\s*'wrap'/.test(body);
  // A horizontal scroller around the chips is the bug this fixes.
  const scrollerAroundChips = /<ScrollView[\s\S]{0,200}?contentContainerStyle=\{styles\.pickerRow\}/.test(
    src,
  );
  return wraps && !scrollerAroundChips;
}

/** Both notation surfaces render the shared honest length line. */
export function surfacesShowScoreLength(input: {
  editorSource: string;
  readerSource: string;
  componentSource: string;
}): boolean {
  const editor = typeof input?.editorSource === 'string' ? input.editorSource : '';
  const reader = typeof input?.readerSource === 'string' ? input.readerSource : '';
  const component = typeof input?.componentSource === 'string' ? input.componentSource : '';
  return (
    editor.includes('<ScoreLengthLine') &&
    editor.includes("from '../components/ScoreLengthLine'") &&
    reader.includes('<ScoreLengthLine') &&
    reader.includes("from '../components/ScoreLengthLine'") &&
    // The component takes the SCORE, never a pre-built label.
    component.includes('abc') &&
    !/\blabel\s*[:?]/.test(component) &&
    !/<Text[^>]*>\s*\{?\s*(text|label|copy)\s*\}?\s*<\/Text>/.test(component)
  );
}

/** The viewer's HTML carries no remote renderer: abcjs is bundled and inlined. */
export function rendererIsBundled(input: {
  viewSource: string;
  assetSource: string;
}): boolean {
  const view = typeof input?.viewSource === 'string' ? input.viewSource : '';
  const asset = typeof input?.assetSource === 'string' ? input.assetSource : '';
  const hasCdn = RENDERER_CDN_HOSTS.some((host) => view.includes(host));
  const loadsRemoteScript = /<script\s+src=/.test(view);
  return (
    !hasCdn &&
    !loadsRemoteScript &&
    view.includes("from '../assets/abcjsBasic'") &&
    view.includes('ABCJS_BASIC_MIN_JS') &&
    // The bundle itself is a real abcjs: it defines window.ABCJS and exposes renderAbc.
    asset.includes('ABCJS_BASIC_MIN_JS') &&
    asset.includes('renderAbc') &&
    asset.length > 100000
  );
}
