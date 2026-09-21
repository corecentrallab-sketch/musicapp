/**
 * modalBackContract.ts — the Android hardware-BACK contract for every <Modal>.
 *
 * Why this exists (owner-reported white screen, 09-18): the sheet-music viewer
 * rendered `<Modal visible={true} animationType="slide" presentationStyle="fullScreen">`
 * with NO `onRequestClose`. On Android that prop is what lets the BACK key reach
 * JS at all — React Native's modal window consumes the key press and hands it to
 * the JS `onRequestClose` handler (ReactModalHostView.kt: "onRequestClose callback
 * must be set if back key is expected to close the modal"). With no handler:
 *
 *   1. the BACK press can never close the viewer through JS, so the host screen's
 *      `showScoreViewer` state stays true —
 *   2. every host of a full-screen flow replaces its ENTIRE body with that flow
 *      (`return <ScoreViewer …/>` in HomeScreen / PieceDetailScreen /
 *      RecognitionResultView), so the tab renders an empty body under its own
 *      header title ("Discover" on the Home tab) — the white screen —
 *   3. and the next BACK press reaches React Navigation with no route to pop,
 *      which finishes the activity (the app "exits").
 *
 * The fix is one prop per modal; this module is the guard that keeps the class of
 * bug from coming back, because it needs no emulator to catch: it reads the app's
 * own source and reports every `<Modal>` that cannot be closed by BACK.
 *
 * Pure by design — no react / react-native / fs imports — so the tier1 gate can
 * compile and run it with node_modules absent (see tsconfig.tier1.json). The disk
 * walk lives in the test script; this file only reasons about source text.
 */

/** One source file to audit, in the shape the scan produces. */
export interface SourceFile {
  /** Repo-relative path, used only for reporting. */
  path: string;
  source: string;
}

/** A modal tag that the Android BACK button cannot close through JS. */
export interface ModalContractViolation {
  path: string;
  /** 1-based line number of the `<Modal` tag. */
  line: number;
  /** The opening tag, whitespace-collapsed, for the failure message. */
  tag: string;
}

/**
 * Blank out `//` line comments and slash-star block comments while keeping the
 * source's length and newlines identical, so offsets and line numbers stay valid.
 *
 * Strings are respected first: a URL like 'https://…' must not be mistaken for a
 * line comment (that would blank the rest of the line — including an
 * `onRequestClose` — and turn a real violation into a silent pass).
 */
export function maskComments(source: string): string {
  const out = source.split('');
  let quote = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (quote) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) quote = '';
      i++;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      i++;
      continue;
    }

    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }

    if (c === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < source.length) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }

    i++;
  }
  return out.join('');
}

/**
 * The opening tag of the modal that starts at `start` (the index of its `<`),
 * up to and including the closing `>`. Braces are tracked so a `>` inside an
 * expression (`visible={a > b}`) cannot end the tag early, and strings are
 * skipped for the same reason. Returns null when the tag is never closed.
 */
export function readModalTag(source: string, start: number): string | null {
  let depth = 0;
  let quote = '';
  for (let i = start; i < source.length; i++) {
    const c = source[i];

    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = '';
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }

    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

/** Which line (1-based) `offset` sits on. */
export function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/** Every `<Modal …>` opening tag in one file. */
export function modalTags(source: string): { start: number; tag: string }[] {
  const masked = maskComments(source);
  const found: { start: number; tag: string }[] = [];
  // The lookahead keeps this honest: a real tag is followed by whitespace, `>`
  // or `/`. Without it, this module's OWN regex literal (which contains the text
  // <Modal) would be scanned as a modal and flagged — the detector must not
  // report itself.
  const pattern = /<Modal(?=\s|>|\/)/g;
  let match = pattern.exec(masked);
  while (match) {
    const tag = readModalTag(masked, match.index);
    if (tag !== null) found.push({ start: match.index, tag });
    match = pattern.exec(masked);
  }
  return found;
}

/** How many `<Modal>` tags the given sources contain (a scan sanity floor). */
export function countModals(files: readonly SourceFile[]): number {
  let total = 0;
  for (const file of files) total += modalTags(file.source).length;
  return total;
}

/**
 * Every modal in `files` that does not set `onRequestClose` — i.e. every modal
 * whose Android BACK behaviour is undefined, which is the defect this module
 * exists to prevent. An empty result means the contract holds.
 */
export function findModalsMissingBackHandler(
  files: readonly SourceFile[],
): ModalContractViolation[] {
  const violations: ModalContractViolation[] = [];
  for (const file of files) {
    for (const { start, tag } of modalTags(file.source)) {
      if (!/onRequestClose\s*=/.test(tag)) {
        violations.push({
          path: file.path,
          line: lineAt(file.source, start),
          tag: tag.replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
  return violations;
}

/** One-line report per violation, ready to print in a test failure. */
export function formatViolations(
  violations: readonly ModalContractViolation[],
): string[] {
  return violations.map(
    (v) => `${v.path}:${v.line} — BACK cannot close this modal: ${v.tag}`,
  );
}
