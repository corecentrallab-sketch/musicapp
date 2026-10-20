/**
 * inkContrast.ts — CAN THIS INK BE READ ON THIS PAPER? (v42 fix B1)
 *
 * THE OWNER'S COMPLAINT (v41 on-device pass, 10-20): "Notes: NoteSnap heard your
 * take" draws the detected notes on a BLACK screen — the notes are invisible, the
 * screen needs to be lighter.
 *
 * THE DEFECT IT NAMES. The take's staff had its paper and its ink written as
 * literals of the DARK palette and passed to the renderer as PROPS
 * (`background={DARK_THEME.surface}`). The app's theme remapper
 * (services/themeApply.ts) re-paints StyleSheets only — a colour handed to a
 * component as a prop is never remapped — so in LIGHT mode the card turned white
 * around a staff that stayed #16213e: a black block, exactly what the owner saw.
 * Nothing in the codebase could see that, because "is this pair readable" is a
 * question about two colours, and no test asked it.
 *
 * This module answers that question, so the palette a score surface uses can be
 * asserted instead of eyeballed: WCAG relative luminance and the contrast ratio
 * between two colours. `MIN_LEGIBLE_CONTRAST` is WCAG AA for body text (4.5:1),
 * applied here to notation: a notehead is a small glyph, and the owner's words
 * were "invisible", not "a bit dim".
 *
 * PURE: no react, no react-native, no fs. Compiled by tsconfig.tier1.json and
 * asserted by scripts/uxr-v42-fixes.test.ts.
 */

/** WCAG AA for normal text — the floor every score ink must clear on its paper. */
export const MIN_LEGIBLE_CONTRAST = 4.5;

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/**
 * A `#rgb` / `#rrggbb` colour as channels, or null for anything else (a theme
 * token name, `rgba(...)`, a gradient). Null is NOT an error: a caller that hands
 * over a non-hex colour gets "cannot judge", never a false pass.
 */
export function parseHexColor(value: unknown): RgbColor | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (text.length !== 4 && text.length !== 7) return null;
  if (text.charAt(0) !== '#') return null;
  const hex = text.slice(1);
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((character) => character + character)
          .join('')
      : hex;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG relative luminance (0 = black, 1 = white), or null for a non-hex colour. */
export function relativeLuminance(value: unknown): number | null {
  const rgb = parseHexColor(value);
  if (!rgb) return null;
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

/**
 * The contrast ratio between two colours, 1 (identical) … 21 (black on white).
 * Null when either colour cannot be parsed — the caller decides what that means.
 */
export function contrastRatio(a: unknown, b: unknown): number | null {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  if (first === null || second === null) return null;
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Is `ink` readable on `paper`? A pair we cannot parse is NOT legible (fail closed). */
export function isLegibleOn(ink: unknown, paper: unknown): boolean {
  const ratio = contrastRatio(ink, paper);
  return ratio !== null && ratio >= MIN_LEGIBLE_CONTRAST;
}
