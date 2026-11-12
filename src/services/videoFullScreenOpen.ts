/**
 * videoFullScreenOpen.ts — WHY THE WINDOW OPENED LATE, AND WHAT IS MEASURED NOW
 * (vc56, the follow-up to vc55's F2).
 *
 * THE OWNER, 2026-11-11: *"it should be ideally immediate from when the video is
 * taken to going to another window to watch it on full screen — not a very
 * paused delay. It looks like the app did nothing from the take to the user."*
 *
 * F2 (vc55) put a spinner and a disabled Play control inside the window. The
 * owner still waited, because the window itself was not the only thing in the
 * way: the tap was landing while the JS thread was busy, and the window's own
 * player was created in the SAME React commit as the window, so the native
 * player had to exist before the first frame of the window could paint.
 *
 * TWO RULES THIS FILE PINS (pure — no react, no expo, no device):
 *
 *  1. THE WINDOW PAINTS BEFORE THE PLAYER EXISTS. `shouldMountFullScreenPlayer`
 *     is the gate the component uses: the `<Video>` is not mounted until the
 *     window has been on screen for `FULL_SCREEN_PAINT_FRAMES_BEFORE_MOUNT`
 *     frames. So the first thing the owner sees is the window with its spinner,
 *     never an empty black rectangle waiting for a decoder.
 *
 *  2. THE WAIT IS MEASURED, IN FOUR PARTS. `createFullScreenOpenTimeline` stamps
 *     the press, the window's first paint, the player's mount, its loaded file
 *     and its first frame, and reports the gaps. `FULL_SCREEN_OPEN_LOG_PREFIX`
 *     is the console tag, so a handset capture says exactly which stage ate the
 *     time — the app cannot measure a decode on someone else's phone any other
 *     way, and it will not guess one.
 */

/** Console tag for the measured split (same convention as `[capture]`). */
export const FULL_SCREEN_OPEN_LOG_PREFIX = '[fullscreen-open]';

/**
 * How many painted frames the window gets before the player is mounted. Two,
 * because the first `requestAnimationFrame` callback of a freshly mounted Modal
 * can still run before the frame reaches the screen — the second one cannot.
 */
export const FULL_SCREEN_PAINT_FRAMES_BEFORE_MOUNT = 2;

/**
 * If the frame callbacks never come (a window opened while the app is
 * backgrounded, an animation blocking the frame loop), the player is mounted
 * anyway after this long. A window that never mounts a player would be a dead
 * end, and a dead end is worse than a late start.
 */
export const FULL_SCREEN_MOUNT_FALLBACK_MS = 400;

/** Every stage the open path stamps. */
export type FullScreenOpenMark =
  | 'tapped'
  | 'windowPainted'
  | 'playerMounted'
  | 'loaded'
  | 'firstFrame';

/** The gaps between those stages, in ms; `null` when a stage never happened. */
export interface FullScreenOpenSplit {
  tapToPaintMs: number | null;
  paintToMountMs: number | null;
  mountToLoadedMs: number | null;
  mountToFirstFrameMs: number | null;
  tapToLoadedMs: number | null;
  tapToFirstFrameMs: number | null;
}

export interface FullScreenOpenTimeline {
  /** Stamp one stage. A stage stamped twice keeps its FIRST time. */
  mark(name: FullScreenOpenMark, atMs?: number): void;
  /** When a stage was stamped, or null. */
  at(name: FullScreenOpenMark): number | null;
  /** The measured gaps between the stages that did happen. */
  split(): FullScreenOpenSplit;
  /** One console line carrying the whole split. */
  line(): string;
}

/**
 * THE WINDOW'S PLAYER MAY ONLY EXIST ONCE THE WINDOW ITSELF IS ON SCREEN.
 * A closed window mounts nothing (there is nothing to prepare), and an open one
 * that has not painted yet still mounts nothing — the spinner is what the user
 * sees first.
 */
export function shouldMountFullScreenPlayer(visible: boolean, windowPainted: boolean): boolean {
  return visible === true && windowPainted === true;
}

function gap(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  const ms = Math.round(to - from);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function ms(value: number | null): string {
  return value === null ? '?' : `${value}ms`;
}

/**
 * Build one opening's timeline. `tapMs` is the press that opened the window
 * (`noteFullScreenTap` below records it on the page), so the first number the
 * split reports is the one the owner actually feels: press → window on screen.
 */
export function createFullScreenOpenTimeline(
  now: () => number = () => Date.now(),
  tapMs: number | null = lastFullScreenTapMs(),
): FullScreenOpenTimeline {
  const marks = new Map<FullScreenOpenMark, number>();
  if (tapMs !== null && Number.isFinite(tapMs)) marks.set('tapped', tapMs);

  return {
    mark(name, atMs) {
      if (marks.has(name)) return;
      const value = typeof atMs === 'number' && Number.isFinite(atMs) ? atMs : now();
      marks.set(name, value);
    },
    at(name) {
      const value = marks.get(name);
      return typeof value === 'number' ? value : null;
    },
    split() {
      const tapped = marks.get('tapped') ?? null;
      const painted = marks.get('windowPainted') ?? null;
      const mounted = marks.get('playerMounted') ?? null;
      const loaded = marks.get('loaded') ?? null;
      const firstFrame = marks.get('firstFrame') ?? null;
      return {
        tapToPaintMs: gap(tapped, painted),
        paintToMountMs: gap(painted, mounted),
        mountToLoadedMs: gap(mounted, loaded),
        mountToFirstFrameMs: gap(mounted, firstFrame),
        tapToLoadedMs: gap(tapped, loaded),
        tapToFirstFrameMs: gap(tapped, firstFrame),
      };
    },
    line() {
      const s = this.split();
      return (
        `${FULL_SCREEN_OPEN_LOG_PREFIX} tap->paint=${ms(s.tapToPaintMs)} ` +
        `paint->mount=${ms(s.paintToMountMs)} ` +
        `mount->loaded=${ms(s.mountToLoadedMs)} ` +
        `mount->frame=${ms(s.mountToFirstFrameMs)} ` +
        `tap->loaded=${ms(s.tapToLoadedMs)}`
      );
    },
  };
}

/**
 * The press that opens the window, stamped by the page. It is module state
 * because the control lives on the page and the window is a sibling component:
 * the alternative would be a prop carrying a timestamp through two surfaces.
 * It is cleared on close, so a window opened from anywhere else reports `?`
 * rather than a number belonging to an older press.
 */
let lastTapAtMs: number | null = null;

/** Record the press that is opening the window. */
export function noteFullScreenTap(atMs: number = Date.now()): void {
  lastTapAtMs = Number.isFinite(atMs) ? atMs : Date.now();
}

/** The last press, or null when no window has been opened from a control. */
export function lastFullScreenTapMs(): number | null {
  return lastTapAtMs;
}

/** Forget the press (the window closed, so the next open starts its own). */
export function clearFullScreenTap(): void {
  lastTapAtMs = null;
}
