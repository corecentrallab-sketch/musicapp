/**
 * takeNotationReader.ts — THE FULL-SCREEN READER'S RULES (vc61 spec, part 3).
 *
 * THE OWNER (11-17), verbatim: *"I am unable to read the score as the print is so compressed.
 * There needs to be a full screen option to be able to read notation. This really needs a
 * fix."*
 *
 * WHAT THE READER IS. The take's staff, full bleed, scrollable, with the length line always
 * on screen and the zoom the user left it at. It draws the SAME notes the card draws — it
 * never re-reads, re-cleans or re-times a take — so opening it cannot change what the user
 * is looking at. It carries no rehearsal bar, no synth and no share sheet: those belong to
 * the later slice written up in VC61-FULLSCREEN-READER.md, which stays backlog.
 *
 * ── ZOOM, AND WHY IT IS CONTROLS RATHER THAN PINCH ────────────────────────────────
 *
 * The app ships no gesture library and vc61 adds no dependency, so pinch is not available
 * over the score's touch shield. Zoom is therefore two explicit controls (`Bigger`,
 * `Smaller`) with a remembered level, applied by rendering the score into a NARROWER
 * container and scaling that container up — which is what actually makes the print bigger:
 * ABCjs lays the music out to the width it is given, so a narrower box means fewer bars to
 * the line, and the same music drawn larger. Measured on the bundled ABCjs 6.2.3 before this
 * was written: 12 bars at 344 px laid out 344×131, and at a quarter of that width the same
 * music was ~4× taller — the same notes, drawn at a readable size.
 *
 * ── POSITION ─────────────────────────────────────────────────────────────────────
 *
 * The scroll offset is remembered per take in this module's own small map (the reader is
 * given the key by its host), so closing and reopening returns to where the user was. It is
 * a session memory on purpose: it is a view position, not take data, and nothing about a
 * take is ever written by reading it.
 *
 * PURE: no react, no react-native, no fs, no storage, no network. Asserted by
 * scripts/vc61ReadClockAndReader.test.ts.
 */
import { scoreLengthLine } from './scoreLength';

/** The reader's own title when the take has none. */
export const NOTATION_READER_TITLE = 'Your take, full screen';

/** The control that opens it — the same word every other score surface uses. */
export const NOTATION_READER_OPEN_LABEL = 'Read this score full screen';

/** What the reader is, said plainly under the title. */
export const NOTATION_READER_HINT =
  'This is the same notation as the card, at full width. Use Bigger or Smaller to change the size — it opens where you left it.';

/** The zoom controls. Two controls and a reset, never a slider the thumb cannot hit. */
export const NOTATION_ZOOM_IN_LABEL = 'Bigger';
export const NOTATION_ZOOM_OUT_LABEL = 'Smaller';
export const NOTATION_ZOOM_RESET_LABEL = 'Fit';

/** Said when the take has no notation at all (never an empty white screen). */
export const NOTATION_READER_EMPTY_LINE =
  'There is no notation for this take — no notes were heard in it.';

/** The close control's accessibility label. */
export const NOTATION_READER_CLOSE_LABEL = 'Close the full-screen score';

/**
 * THE ZOOM STEPS. 1 is the score laid out at the reader's own width; above it the score is
 * rendered into a narrower box and scaled back up, so the notes get bigger rather than the
 * line simply fitting more of them.
 */
export const NOTATION_ZOOM_LEVELS: readonly number[] = [1, 1.25, 1.5, 2];

/** The narrowest container the score may be rendered into, in points. */
export const NOTATION_MIN_RENDER_WIDTH = 120;

/** Clamp any zoom into the offered band (a stored value from an older build included). */
export function clampNotationZoom(zoom: unknown): number {
  const value = Number(zoom);
  const levels = NOTATION_ZOOM_LEVELS;
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (value <= levels[0]) return levels[0];
  if (value >= levels[levels.length - 1]) return levels[levels.length - 1];
  // Snap to the nearest offered level, so a stored 1.3 cannot render at a size no control
  // can reach or undo.
  let best = levels[0];
  let bestGap = Math.abs(value - best);
  for (const level of levels) {
    const gap = Math.abs(value - level);
    if (gap < bestGap) {
      best = level;
      bestGap = gap;
    }
  }
  return best;
}

/** One step up (+1) or down (−1), clamped to the band. */
export function stepNotationZoom(zoom: unknown, direction: number): number {
  const current = clampNotationZoom(zoom);
  const index = NOTATION_ZOOM_LEVELS.indexOf(current);
  const step = Number(direction) >= 0 ? 1 : -1;
  const next = Math.min(NOTATION_ZOOM_LEVELS.length - 1, Math.max(0, index + step));
  return NOTATION_ZOOM_LEVELS[next];
}

/** `150%` — the level as the reader prints it beside the controls. */
export function notationZoomLabel(zoom: unknown): string {
  return `${Math.round(clampNotationZoom(zoom) * 100)}%`;
}

/** The width the score is rendered into for a given zoom, inside a body of `bodyWidth`. */
export function notationRenderWidth(bodyWidth: unknown, zoom: unknown): number {
  const width = Number(bodyWidth);
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 320;
  return Math.max(NOTATION_MIN_RENDER_WIDTH, Math.round(safeWidth / clampNotationZoom(zoom)));
}

/**
 * THE LENGTH LINE, ALWAYS VISIBLE — "Bars 1–12 of 12", straight from `scoreLength.ts`, which
 * computes it from the take's own ABC. It is what tells a genuinely short take apart from a
 * clipped render, which is the whole reason the line exists (v43 slice 2).
 */
export function notationReaderLengthLine(abc: unknown): string | null {
  return scoreLengthLine(abc);
}

/** Where the reader was, per take. */
export interface NotationReaderPosition {
  /** The zoom level the user left it at. */
  zoom: number;
  /** The vertical scroll offset, in points. */
  scrollY: number;
}

/** How many takes' positions are remembered (the oldest is dropped first). */
export const NOTATION_READER_POSITION_MAX = 24;

const remembered = new Map<string, NotationReaderPosition>();

/** The key a take's position is remembered under. */
export function notationReaderPositionKey(input: {
  rowId?: string | null;
  abc?: string | null;
}): string {
  const rowId = typeof input?.rowId === 'string' ? input.rowId.trim() : '';
  if (rowId.length > 0) return `row:${rowId}`;
  const abc = typeof input?.abc === 'string' ? input.abc : '';
  // No row id (a take shown before it is stored): key on the notation itself, so two takes
  // can never share a scroll position.
  let hash = 2166136261;
  for (const character of abc) {
    hash ^= character.charCodeAt(0);
    hash = (hash * 16777619) >>> 0;
  }
  return `abc:${abc.length}-${hash.toString(36)}`;
}

/** What the reader was last left at for this key (zoom 1, top of the page, when new). */
export function rememberedReaderPosition(key: string): NotationReaderPosition {
  const entry = remembered.get(typeof key === 'string' ? key : '');
  if (!entry) return { zoom: 1, scrollY: 0 };
  return { zoom: clampNotationZoom(entry.zoom), scrollY: Math.max(0, Number(entry.scrollY) || 0) };
}

/** Remember where the reader is now. */
export function rememberReaderPosition(key: string, position: NotationReaderPosition): void {
  if (typeof key !== 'string' || key.length === 0) return;
  remembered.set(key, {
    zoom: clampNotationZoom(position?.zoom),
    scrollY: Math.max(0, Math.round(Number(position?.scrollY) || 0)),
  });
  while (remembered.size > NOTATION_READER_POSITION_MAX) {
    const oldest = remembered.keys().next();
    if (oldest.done) break;
    remembered.delete(oldest.value);
  }
}

/** Forget every remembered position (the gate's own reset; nothing in the app calls it). */
export function resetReaderPositions(): void {
  remembered.clear();
}
