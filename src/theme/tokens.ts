/**
 * src/theme/tokens.ts — THE canonical token source for NoteSnap.
 *
 * SOURCE OF TRUTH: `/home/team/shared/design-system-v1.md` §1–3 (owner HLD,
 * 2026-11-24). That file SUPERSEDES the 10-24 draft; where they disagree, the
 * spec wins. The values below are the spec's values, not the draft's:
 *
 *   text.primary   #1A1E29  (draft said #1A1D24)
 *   text.secondary #4E576B  (draft said #4E5562)
 *   border.subtle  #D9D4C7  (draft said #DDD8CE)
 *   border.control #6F7A92  (draft said #8A909D)
 *   brand.anchor   #3A4E85  (did not exist in the draft)
 *
 * THIS FILE REPLACES NOTHING YET. No screen imports it, so nothing on device
 * changes when it lands: it is the single foundation the 21 screens will draw
 * from as they are migrated one at a time.
 *
 * The one rule that must not drift (§1 Brand): text-labelled pills fill with
 * `brand.anchor` (#3A4E85 — white on it is 8.05:1), NOT `accent.primary`
 * (crimson, 3.83:1 on white, which fails WCAG AA for normal text). Crimson
 * stays for the record cue, icon-only fills and ≥18 pt text.
 *
 * `scripts/designTokens.test.ts` computes every contrast ratio in the spec from
 * these values, so a colour edit that breaks AA fails the gate.
 *
 * Pure data, zero dependencies — importable from anywhere, and from the tier1
 * gate without React Native.
 */

// ─── Colour (semantic roles, §1) ────────────────────────────────────────────

/**
 * Light is the default register. Names are the spec's token names, grouped by
 * the segment before the dot: `bg.canvas` is `colors.bg.canvas`.
 */
export const colors = {
  bg: {
    /** Warm ivory-stone app base. */
    canvas: '#F7F5F0',
    /** Score, card and modal containers. */
    surface: '#FFFFFF',
    /** Grouped settings, take-review cards, secondary panels. */
    surfaceTinted: '#EFECE4',
  },
  text: {
    /** 15.28:1 on canvas · 16.64:1 on card. */
    primary: '#1A1E29',
    /** 6.65:1 on canvas · 7.24:1 on card · 6.14:1 on tinted. */
    secondary: '#4E576B',
  },
  brand: {
    /** Mid slate-indigo. THE pill fill; white labels live here (8.05:1). */
    anchor: '#3A4E85',
  },
  accent: {
    /** Crimson. Record cue, high-priority triggers, icon-only fills, ≥18 pt text.
     *  NOT small white labels (3.83:1). */
    primary: '#E94560',
    /** Teal identity. Non-text indicators (dots, bars) at ≥3:1. Not body labels. */
    secondary: '#2A9D8F',
    /** Decoration/highlight only — never a mark on a white surface (1.93:1). */
    secondaryBright: '#4ECDC4',
  },
  border: {
    /** Dividers ONLY — 1.48:1 on card. Never outline an interactive control with it. */
    subtle: '#D9D4C7',
    /** Any outline of something tappable — 4.31:1 on card, clears the 3:1 floor. */
    control: '#6F7A92',
  },
} as const;

// ─── Radius (§2 — four shapes, no more) ─────────────────────────────────────

/**
 * Exactly four radii replace today's eight scattered ones (8 → 999).
 * `circle` is the percentage form React Native needs for a true circle on an
 * arbitrary-size control.
 */
export const radius = {
  /** All text-labelled buttons, mode chips, floating transport capsules. */
  pill: 9999,
  /** Note-head / fret-dot / icon-only triggers: record, play-pause-stop,
   *  tuner & beat dots, streak badges. */
  circle: '50%',
  /** Cards and list containers. */
  card: 16,
  /** Modals and sheets. */
  modal: 24,
} as const;

// ─── Spacing (§3 — a 4 / 8 px scale only) ───────────────────────────────────

/**
 * The whole spacing scale. Key names carry their px value (`spacing.s16 === 16`)
 * so a call site cannot be read wrong, and every step is a positive multiple of
 * 4 — the gate enforces both.
 */
export const spacing = {
  s4: 4,
  s8: 8,
  s12: 12,
  s16: 16,
  s24: 24,
  s32: 32,
  s40: 40,
  s48: 48,
} as const;

// ─── Press (§3) ─────────────────────────────────────────────────────────────

/**
 * Press: scale to ~0.97 over ~90 ms, one-step tint shift, gentle release
 * overshoot. The spec gives the scale and the duration; the tint step and the
 * overshoot are the smallest values that read as "one step" and "gentle" at
 * these timings.
 */
export const press = {
  /** Held scale of the pressed control. */
  scale: 0.97,
  /** Scale-down duration, ms. */
  durationMs: 90,
  /** Opacity of the single tint overlay applied while held (one step). */
  tintStepOpacity: 0.08,
  /** Release springs just past rest before settling. */
  overshootScale: 1.01,
  /** Release duration, ms — slower than the press, so the release feels gentle. */
  releaseDurationMs: 120,
} as const;

// ─── Touch (§3) ─────────────────────────────────────────────────────────────

/** 44 pt minimum hit target on every control. */
export const hitTarget = {
  minPt: 44,
} as const;

// ─── One aggregate, for a future ThemeProvider ──────────────────────────────

export const tokens = {
  colors,
  radius,
  spacing,
  press,
  hitTarget,
} as const;

export type Tokens = typeof tokens;
export type ColorTokens = typeof colors;
export type RadiusTokens = typeof radius;
export type SpacingTokens = typeof spacing;
