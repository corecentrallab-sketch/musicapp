/**
 * v43 item B3 — THE SOURCE GUARDS FOR ITEM B (build stamp + the honest PDF control).
 * v45 (owner 10-26): the HTML stamp half now guards its RETIREMENT from Home —
 * the stamp lives on Settings → About only (`homeCarriesNoBuildStamp`).
 *
 * These read REAL source text, so they run in tier1 without an emulator. Each one
 * has a failure mode that is invisible in a screenshot: a stamp that renders a
 * literal, an auto-scroll control that is mounted for a one-page PDF (a dead play
 * button), and a scanned viewer that loses its honest line while "fixing" the PDF
 * one.
 */
/**
 * Strip comments before scanning, so a guard is never satisfied by prose (and a
 * commented-out line never fails one). The same rule the other UI contracts use.
 */
function maskComments(source: string): string {
  return (typeof source === 'string' ? source : '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

/** The accessibility tag the rendered stamp carries (shared with services/buildStamp). */
export const BUILD_STAMP_TAG = 'build-stamp';

/**
 * THE STAMP IS RENDERED, FROM THE LIVE VALUES (Settings → About).
 * A literal version string here would be the "Version 0.1.32" problem again.
 */
export function settingsShowsTheBuildStamp(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 8000) return false;
  if (!/\{buildStampLine\(/.test(src)) return false;
  if (src.indexOf('BUILD_STAMP_TAG') < 0) return false;
  // …from the build's OWN constants, never a hard-coded version.
  if (src.indexOf('version: appVersion') < 0) return false;
  if (src.indexOf('versionCode: appVersionCode') < 0) return false;
  if (src.indexOf('sha: BUILD_SHA') < 0) return false;
  // …and the About row it sits under keeps its live version line.
  return src.indexOf('aboutVersionLine(appVersion)') >= 0;
}

/**
 * THE STAMP IS OFF HOME — v45 (owner 10-26, designer notes §3 row 4).
 *
 * v43 item B1 put the same stamp on Home so a tester "did not have to open
 * anything"; v45 retires it there. The front door is now the smallest content
 * area in the app and a version string in its footer was part of what the owner
 * read as clutter. Settings → About keeps the line (guarded above by
 * `settingsShowsTheBuildStamp`), and it is step 0 of every device pass.
 *
 * This guard is the RETIREMENT'S other half, which is why it is asserted instead
 * of merely deleted: a stamp that sneaks back onto Home fails here. Comments are
 * masked first, so prose ABOUT the stamp is not an offence — only a real render.
 */
export function homeCarriesNoBuildStamp(source: string): boolean {
  const src = maskComments(source);
  // The real Home screen, not a fixture: a stub that renders nothing must never
  // pass a "carries no stamp" check.
  if (src.length < 8000) return false;
  if (src.indexOf('BUILD_STAMP_TAG') >= 0) return false;
  if (/\{buildStampLine\(/.test(src)) return false;
  if (src.indexOf('sha: BUILD_SHA') >= 0) return false;
  return src.indexOf('buildStampLine(') < 0;
}

/**
 * THE PDF AUTO-SCROLL CONTROL EXISTS ONLY WHEN THERE IS MORE THAN ONE PAGE, and a
 * one-page document gets an honest line instead of a dead play button.
 */
export function pdfAutoScrollIsGatedOnPageCount(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 4000) return false;
  const tag = src.indexOf('<AutoScrollControl');
  if (tag < 0) return false;
  // The control sits inside the `pageCount >= 2` branch, not above it.
  const gate = src.lastIndexOf('pageCount >= 2 ?', tag);
  if (gate < 0) return false;
  if (tag - gate > 200) return false;
  // …the one-page branch says why, in words, from a named constant.
  if (src.indexOf('pageCount === 1 ?') < 0) return false;
  if (src.indexOf('{PDF_NO_AUTOSCROLL_LINE}') < 0) return false;
  return src.indexOf('export const PDF_NO_AUTOSCROLL_LINE') >= 0;
}

/** THE SCANNED VIEWER KEEPS ITS OWN HONEST LINE (the v42 bite survives). */
export function scannedViewerKeepsItsHonestLine(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 2000) return false;
  if (src.indexOf('SCANNED_NO_AUTOSCROLL_LINE') < 0) return false;
  return src.indexOf('{SCANNED_NO_AUTOSCROLL_LINE}') >= 0;
}

/**
 * NO SURFACE MOUNTS THE CONTROL UNCONDITIONALLY: in every source that contains an
 * `<AutoScrollControl`, the tag must sit inside a page-count branch.
 */
export function noScreenMountsAutoScrollUnconditionally(
  sources: ReadonlyArray<{ path: string; source: string }>,
): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  return sources.every(({ source }) => {
    const src = maskComments(typeof source === 'string' ? source : '');
    const tag = src.indexOf('<AutoScrollControl');
    if (tag < 0) return true; // a surface without the control cannot mount it badly
    const gate = src.lastIndexOf('pageCount >= 2 ?', tag);
    return gate >= 0 && tag - gate <= 200;
  });
}
