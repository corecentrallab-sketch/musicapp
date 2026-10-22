/**
 * scoreExpandContract — THE SOURCE-SCAN GATE for the full-screen score expander
 * (v43 fix batch, slice 3, item E).
 *
 * A text/regex test on the REAL surfaces, for the bug class no unit test can see:
 * a surface that was rebuilt (or a shared card that was refactored) and silently
 * stopped offering the expander at all. The tier1 pure suite
 * (scripts/scoreExpand.test.ts) proves the NUMBERS; this module proves every
 * screen the spec names still WIRES the one affordance, and that the window it
 * opens is still presentation-only.
 *
 * WHAT "WIRED" MEANS, PER SURFACE — three kinds, because the spec's own table
 * does not make every surface render a button:
 *
 *   • `direct`   — the surface renders the shared control itself. It must contain
 *                  `<ExpandScoreButton`. (E1 notation editor, E3/E8 the
 *                  take-correction editor's read-only view, E4 the take staff
 *                  card, E6 the melody capture window, E11 the PDF reader,
 *                  E12 the scanned viewer.)
 *   • `label`    — the surface ALREADY had a full-screen control (the reader's
 *                  immersive toggle) and reuses it; re-labelling it with
 *                  `SCORE_EXPAND_LABEL` is what makes it the same affordance in
 *                  the same words. It must contain `SCORE_EXPAND_LABEL`. (E9.)
 *   • `inherits` — the surface hands the opener down (`onExpand={`) or mounts the
 *                  widget that owns the relabelled control (`<ScoreViewer`), and
 *                  a second button of its own would be a duplicate. (E5 capture
 *                  flow, E7 practice video, E10 the result card, which opens the
 *                  reader.)
 *
 * TakeStaffCard is in the `direct` list on purpose: it is the ONE shared control
 * three surfaces inherit, so deleting the button from it must fail this gate —
 * that is exactly the mutation probe the slice's acceptance requires.
 *
 * PURE: no react, no react-native, no fs. The test reads the files; this module
 * only looks at the strings it is handed, so a source edit fails the guard with
 * NO recompile.
 */

/** How a surface offers the expander. */
export type ScoreExpandSurfaceKind = 'direct' | 'label' | 'inherits';

export interface ScoreExpandSurface {
  /** The spec's item number(s). */
  id: string;
  /** Repo-relative path of the surface. */
  path: string;
  kind: ScoreExpandSurfaceKind;
  /** Text that must be PRESENT (a declaration anchor, so a failure can report a line). */
  anchor: string;
  /** The wiring text that must be present. */
  needle: string;
  /** Why this surface owes the affordance (kept for the failure message). */
  why: string;
}

const CARD = 'src/components/TakeStaffCard.tsx';
const WINDOW = 'src/components/FullScreenScore.tsx';

/**
 * THE SURFACES THE SPEC NAMES. E2 (the reader) and E13 (the camera) are
 * deliberately absent: the spec excludes them (the reader has no notation card,
 * and the camera is a live preview, not a score).
 */
export const SCORE_EXPAND_SURFACES: readonly ScoreExpandSurface[] = [
  {
    id: 'E1',
    path: 'src/screens/NotationEditorScreen.tsx',
    kind: 'direct',
    anchor: 'export const NotationEditorScreen',
    needle: '<ExpandScoreButton',
    why: 'the notation editor\'s own score header offers the full-screen view',
  },
  {
    id: 'E3/E8',
    path: 'src/components/TakeCorrectionEditor.tsx',
    kind: 'direct',
    anchor: 'export const TakeCorrectionEditor',
    needle: '<ExpandScoreButton',
    why: 'both editor views (original and corrected) can be read full screen',
  },
  {
    id: 'E4',
    path: CARD,
    kind: 'direct',
    anchor: 'export const TakeStaffCard',
    needle: '<ExpandScoreButton',
    why: 'the one shared staff card carries the one shared affordance',
  },
  {
    id: 'E5',
    path: 'src/screens/HumSearchScreen.tsx',
    kind: 'inherits',
    anchor: 'export const HumSearchScreen',
    needle: 'onExpand={',
    why: 'the capture flow hands its opener to the window and owns the modal',
  },
  {
    id: 'E6',
    path: 'src/components/MelodyCaptureWindow.tsx',
    kind: 'direct',
    anchor: 'export const MelodyCaptureWindow',
    needle: '<ExpandScoreButton',
    why: 'the capture window\'s header shows the shared control when hosted',
  },
  {
    id: 'E7',
    path: 'src/screens/PracticeVideoScreen.tsx',
    kind: 'inherits',
    anchor: 'export const PracticeVideoScreen',
    needle: 'onExpand={',
    why: 'the practice-video take card gets the opener from this screen',
  },
  {
    id: 'E9',
    path: 'src/components/ScoreViewer.tsx',
    kind: 'label',
    anchor: 'export const ScoreViewer',
    needle: 'SCORE_EXPAND_LABEL',
    why: 'the reader\'s immersive toggle is the full-screen affordance, in the same words',
  },
  {
    id: 'E10',
    path: 'src/components/RecognitionResultView.tsx',
    kind: 'inherits',
    anchor: 'export const RecognitionResultView',
    needle: '<ScoreViewer',
    why: 'the result card opens the reader, which owns the relabelled control',
  },
  {
    id: 'E11',
    path: 'src/screens/PdfViewerScreen.tsx',
    kind: 'direct',
    anchor: 'export const PdfViewerScreen',
    needle: '<ExpandScoreButton',
    why: 'the PDF reader expands IN PLACE (never a second decoder)',
  },
  {
    id: 'E12',
    path: 'src/screens/ScannedViewerScreen.tsx',
    kind: 'direct',
    anchor: 'export const ScannedViewerScreen',
    needle: '<ExpandScoreButton',
    why: 'a photographed page is the case full screen helps most',
  },
];

export interface ScoreExpandSurfaceFailure {
  id: string;
  path: string;
  /** 1-based line of the surface's declaration anchor — where the wiring belongs. */
  line: number;
  kind: ScoreExpandSurfaceKind;
  needle: string;
  why: string;
}

/**
 * THE DETECTOR MUST NOT REPORT ITSELF (the repo's standing rule): a guard that
 * looks for `<ExpandScoreButton` would happily be satisfied by a COMMENT that
 * discusses it. Block comments and `//` line comments are blanked out first, byte
 * positions preserved so line numbers stay true.
 */
export function maskSourceComments(source: string): string {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === '/*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
      continue;
    }
    if (two === '//') {
      const end = source.indexOf('\n', index);
      const stop = end < 0 ? source.length : end;
      out += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
      continue;
    }
    out += source[index];
    index += 1;
  }
  return out;
}

/** 1-based line number of a character offset. */
export function lineOf(source: string, offset: number): number {
  let line = 1;
  const limit = Math.max(0, Math.min(offset, source.length));
  for (let i = 0; i < limit; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

/**
 * EVERY SURFACE THAT LOST ITS EXPANDER, as `path:line` plus what is missing.
 * `sources` is keyed by the repo-relative path in `SCORE_EXPAND_SURFACES`; a null
 * or missing entry counts as a failure (a deleted surface is worse than an
 * unwired one). Empty array = the whole set is wired.
 */
export function expandableSurfaces(
  sources: Readonly<Record<string, string | null | undefined>>,
  surfaces: readonly ScoreExpandSurface[] = SCORE_EXPAND_SURFACES,
): ScoreExpandSurfaceFailure[] {
  const failures: ScoreExpandSurfaceFailure[] = [];
  for (const surface of surfaces) {
    const raw = sources[surface.path];
    if (typeof raw !== 'string' || raw.length === 0) {
      failures.push({
        id: surface.id,
        path: surface.path,
        line: 0,
        kind: surface.kind,
        needle: surface.needle,
        why: surface.why,
      });
      continue;
    }
    const masked = maskSourceComments(raw);
    if (masked.indexOf(surface.needle) >= 0) continue;
    const anchorAt = masked.indexOf(surface.anchor);
    failures.push({
      id: surface.id,
      path: surface.path,
      line: anchorAt < 0 ? 0 : lineOf(masked, anchorAt),
      kind: surface.kind,
      needle: surface.needle,
      why: surface.why,
    });
  }
  return failures;
}

/** One line per failure, in the `path:line` form the report quotes. */
export function formatScoreExpandFailures(failures: readonly ScoreExpandSurfaceFailure[]): string {
  return failures
    .map((f) => `${f.path}:${f.line}: ${f.id} is missing "${f.needle}" — ${f.why}`)
    .join('\n');
}

/**
 * THE WINDOW MUST BE DISMISSIBLE BY THE PLATFORM BACK GESTURE. A fullScreen
 * `<Modal>` that does not pass `onRequestClose` traps an Android user inside it
 * (the same bug class backExitContract.ts exists for), so the contract is the
 * pair: a fullScreen modal AND a request-close handler wired to the close prop.
 */
export function fullScreenScoreHandlesBack(source: string): boolean {
  const text = maskSourceComments(source);
  if (!/<Modal\b/.test(text)) return false;
  if (!/presentationStyle="fullScreen"/.test(text)) return false;
  if (!/onRequestClose=\{onClose\}/.test(text)) return false;
  return /visible=\{visible\}/.test(text);
}

/**
 * THE WINDOW ONLY PRESENTS. It must not own the score: no `useState` (its
 * open/closed state belongs to the surface, which also owns the renderer) and no
 * score/notation prop — a prop would tempt the next author into a second layout
 * system living inside the modal, which is the drift this slice exists to stop.
 */
export function expanderIsPresentationOnly(source: string): boolean {
  const text = maskSourceComments(source);
  if (/\buseState\s*[<(]/.test(text)) return false;
  if (/\babc\b/.test(text)) return false;
  if (/\bviewportHeight\b/.test(text)) return false;
  return /children/.test(text);
}

/** The window's own path, for the test to read. */
export const SCORE_EXPAND_WINDOW_PATH = WINDOW;
