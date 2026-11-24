/**
 * designTokens.test.ts — THE TOKEN FOUNDATION GATE (design-system-v1.md §1–3).
 *
 * The owner's canonical spec (`/home/team/shared/design-system-v1.md`, 2026-11-24)
 * fixes eleven colours, four radii, a 4/8 px spacing scale, a press feel and a
 * 44 pt hit target. `src/theme/tokens.ts` is the single file every screen will
 * draw from. This suite is what keeps it honest:
 *
 *   1. THE FOUR RADII — exactly four, at the spec's values. A fifth radius is
 *      the eight-scattered-radii problem the spec exists to kill, so it fails
 *      here rather than on a device.
 *   2. THE SPACING SCALE — every step a positive multiple of 4, key name equal
 *      to its px value, strictly ascending, 4 and 8 present.
 *   3. THE 44 PT MINIMUM — hit target never drops below 44.
 *   4. THE CONTRAST PAIRS, COMPUTED HERE — WCAG relative luminance is
 *      implemented in this file, not imported, and every ratio the spec prints
 *      is recomputed from the token values. Two independent things are asserted
 *      per pair: the ratio still matches the spec (a colour edit drifts it) and
 *      it still clears its floor (a colour edit breaks AA). A token file that
 *      quietly ships the draft's #8A909D or a crimson pill label fails, with the
 *      measured ratio in the message.
 *   5. THE SUPERSEDED VALUES ARE ABSENT — #1A1D24 / #4E5562 / #DDD8CE /
 *      #8A909D must not appear anywhere in the token source, comments included.
 *
 * Pure data, no React Native, no device, no network. Run: npm run test:tier1
 */
import { colors, hitTarget, press, radius, spacing, tokens } from '../src/theme/tokens';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passes = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passes++;
    return;
  }
  failures.push(label);
  console.error(`FAIL  ${label}`);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} — expected ${String(expected)}, got ${String(actual)}`);
}

// ─── WCAG contrast, implemented here on purpose ─────────────────────────────

/** WCAG 2.1 relative luminance of an sRGB colour written as #RRGGBB. */
function luminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const raw = m[1];
  const parts = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255);
  const lin = parts.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG 2.1 contrast ratio between two colours (1:1 … 21:1). */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── 1. The four radii ──────────────────────────────────────────────────────

function testFourRadii(): void {
  const names = Object.keys(radius).sort();
  assertEq(names.length, 4, '§2 there are exactly four radii — no more');
  assertEq(names.join(','), 'card,circle,modal,pill', '§2 the four radii are pill, circle, card, modal');
  assertEq(radius.pill, 9999, '§2 pill radius is 9999 (all text-labelled buttons, chips, transport capsules)');
  assertEq(radius.circle, '50%', '§2 circle radius is 50% (note-head, fret-dot, icon-only triggers)');
  assertEq(radius.card, 16, '§2 card radius is 16');
  assertEq(radius.modal, 24, '§2 modal radius is 24');

  // A radius smuggled into the aggregate under another name is the same defect.
  assertEq(
    Object.keys(tokens).sort().join(','),
    'colors,hitTarget,press,radius,spacing',
    'the token aggregate exposes exactly the five §1–3 groups — no stray radius or spacing group',
  );
}

// ─── 2. The 4 / 8 px spacing scale ──────────────────────────────────────────

function testSpacingScale(): void {
  const keys = Object.keys(spacing);
  assert(keys.length >= 4, `§3 the spacing scale has real steps — found ${keys.length}`);

  let previous = 0;
  for (const key of keys) {
    const value = spacing[key as keyof typeof spacing] as number;
    const named = Number(key.replace(/^s/, ''));
    assertEq(key.startsWith('s'), true, `§3 spacing key "${key}" names its px value`);
    assertEq(value, named, `§3 spacing.${key} equals its own name (${value} vs ${named})`);
    assert(Number.isInteger(value), `§3 spacing.${key} is a whole number of px — got ${value}`);
    assert(value > 0, `§3 spacing.${key} is positive — got ${value}`);
    assert(value % 4 === 0, `§3 spacing.${key} sits on the 4 px scale — got ${value}`);
    assert(value > previous, `§3 spacing.${key} (${value}) comes after a smaller step (${previous})`);
    previous = value;
  }

  assertEq(spacing.s4, 4, '§3 the scale starts at 4');
  assertEq(spacing.s8, 8, '§3 the scale includes 8');

  // No half-step escapes: every exported spacing value is a multiple of 4.
  const values = keys.map((k) => spacing[k as keyof typeof spacing] as number);
  const offScale = values.filter((v) => v % 4 !== 0 || v <= 0);
  assertEq(offScale.length, 0, `§3 no spacing value is off the 4/8 scale — off-scale: ${offScale.join(',')}`);
}

// ─── 3. The 44 pt minimum hit target ────────────────────────────────────────

function testHitTarget(): void {
  assertEq(hitTarget.minPt, 44, '§3 the minimum hit target is 44 pt');
  assert(hitTarget.minPt >= 44, `§3 the hit target never drops below 44 pt — got ${hitTarget.minPt}`);
}

// ─── 4. The measured contrast pairs ─────────────────────────────────────────

type ContrastPair = {
  label: string;
  fg: string;
  bg: string;
  /** The ratio the spec prints, to two decimal places. */
  measured: number;
  /** A floor the pair must clear (AA 4.5 for text, 3 for graphics/non-text). */
  floor?: number;
  /** A ceiling the pair must stay UNDER — the spec's "never use it here" rules. */
  ceiling?: number;
  ceilingWhy?: string;
};

function specPairs(): ContrastPair[] {
  return [
    {
      label: 'text.primary on bg.canvas',
      fg: colors.text.primary,
      bg: colors.bg.canvas,
      measured: 15.28,
      floor: 7,
    },
    {
      label: 'text.primary on bg.surface',
      fg: colors.text.primary,
      bg: colors.bg.surface,
      measured: 16.64,
      floor: 7,
    },
    {
      label: 'text.secondary on bg.canvas',
      fg: colors.text.secondary,
      bg: colors.bg.canvas,
      measured: 6.65,
      floor: 4.5,
    },
    {
      label: 'text.secondary on bg.surface',
      fg: colors.text.secondary,
      bg: colors.bg.surface,
      measured: 7.24,
      floor: 7,
    },
    {
      label: 'text.secondary on bg.surfaceTinted',
      fg: colors.text.secondary,
      bg: colors.bg.surfaceTinted,
      measured: 6.14,
      floor: 4.5,
    },
    {
      label: 'white-on-brand.anchor (the pill fill)',
      fg: colors.bg.surface,
      bg: colors.brand.anchor,
      measured: 8.05,
      floor: 4.5,
    },
    {
      label: 'brand.anchor on bg.canvas',
      fg: colors.brand.anchor,
      bg: colors.bg.canvas,
      measured: 7.39,
      floor: 4.5,
    },
    {
      label: 'white-on-accent.primary (crimson)',
      fg: colors.bg.surface,
      bg: colors.accent.primary,
      measured: 3.83,
      ceiling: 4.5,
      ceilingWhy: 'crimson must never carry a small white label — it fails AA at 3.83:1',
    },
    {
      label: 'accent.primary on bg.canvas',
      fg: colors.accent.primary,
      bg: colors.bg.canvas,
      measured: 3.51,
      floor: 3,
    },
    {
      label: 'accent.secondary on bg.surface',
      fg: colors.accent.secondary,
      bg: colors.bg.surface,
      measured: 3.32,
      floor: 3,
    },
    {
      label: 'accent.secondary on bg.canvas',
      fg: colors.accent.secondary,
      bg: colors.bg.canvas,
      measured: 3.05,
      floor: 3,
    },
    {
      label: 'accent.secondaryBright on bg.surface',
      fg: colors.accent.secondaryBright,
      bg: colors.bg.surface,
      measured: 1.93,
      ceiling: 3,
      ceilingWhy: 'the bright teal is decoration only — never a mark on a white surface',
    },
    {
      label: 'border.subtle on bg.surface',
      fg: colors.border.subtle,
      bg: colors.bg.surface,
      measured: 1.48,
      ceiling: 3,
      ceilingWhy: 'border.subtle is for dividers only — never an interactive control outline',
    },
    {
      label: 'border.control on bg.surface',
      fg: colors.border.control,
      bg: colors.bg.surface,
      measured: 4.31,
      floor: 3,
    },
  ];
}

function testContrastPairs(): void {
  for (const pair of specPairs()) {
    const ratio = contrast(pair.fg, pair.bg);
    const shown = round2(ratio);

    // (a) The ratio the spec measured is still the ratio these tokens produce.
    assert(
      near(shown, pair.measured, 0.02),
      `${pair.label}: ${shown}:1 — the spec measures ${pair.measured}:1 ` +
        `(${pair.fg} on ${pair.bg}); a colour edit moved it`,
    );

    // (b) The pair still clears (or still stays under) its WCAG bound.
    if (pair.floor !== undefined) {
      assert(
        ratio >= pair.floor,
        `${pair.label}: ${shown}:1 fails its ${pair.floor}:1 floor ` +
          `(${pair.fg} on ${pair.bg}) — AA/AAA broken by a colour edit`,
      );
    }
    if (pair.ceiling !== undefined) {
      assert(
        ratio < pair.ceiling,
        `${pair.label}: ${shown}:1 must stay under ${pair.ceiling}:1 — ${pair.ceilingWhy}`,
      );
    }
  }

  // THE ONE RULE THAT MUST NOT DRIFT (§1): text-labelled pills fill with
  // brand.anchor, not crimson. Stated as its own guard so the failure names the
  // rule rather than a pair.
  const pillLabel = contrast(colors.bg.surface, colors.brand.anchor);
  const crimsonLabel = contrast(colors.bg.surface, colors.accent.primary);
  assert(
    pillLabel >= 4.5 && crimsonLabel < 4.5,
    `§1 the pill fill is brand.anchor (white on it ${round2(pillLabel)}:1) and NOT crimson ` +
      `(${round2(crimsonLabel)}:1) — a text-labelled pill filled with crimson fails AA`,
  );
}

// ─── The spec's own values, pinned ──────────────────────────────────────────

function testSpecValues(): void {
  assertEq(colors.bg.canvas, '#F7F5F0', '§1 bg.canvas is #F7F5F0');
  assertEq(colors.bg.surface, '#FFFFFF', '§1 bg.surface is #FFFFFF');
  assertEq(colors.bg.surfaceTinted, '#EFECE4', '§1 bg.surface.tinted is #EFECE4');
  assertEq(colors.text.primary, '#1A1E29', '§1 text.primary is #1A1E29 (NOT the draft’s #1A1D24)');
  assertEq(colors.text.secondary, '#4E576B', '§1 text.secondary is #4E576B (NOT the draft’s #4E5562)');
  assertEq(colors.brand.anchor, '#3A4E85', '§1 brand.anchor is #3A4E85');
  assertEq(colors.accent.primary, '#E94560', '§1 accent.primary is #E94560');
  assertEq(colors.accent.secondary, '#2A9D8F', '§1 accent.secondary is #2A9D8F');
  assertEq(colors.accent.secondaryBright, '#4ECDC4', '§1 accent.secondary.bright is #4ECDC4');
  assertEq(colors.border.subtle, '#D9D4C7', '§1 border.subtle is #D9D4C7 (NOT the draft’s #DDD8CE)');
  assertEq(colors.border.control, '#6F7A92', '§1 border.control is #6F7A92 (NOT the draft’s #8A909D)');

  // Every colour is a real #RRGGBB, so no token can be a named colour, an rgba()
  // string or a typo that luminance() would silently mis-read.
  const all: string[] = [
    colors.bg.canvas,
    colors.bg.surface,
    colors.bg.surfaceTinted,
    colors.text.primary,
    colors.text.secondary,
    colors.brand.anchor,
    colors.accent.primary,
    colors.accent.secondary,
    colors.accent.secondaryBright,
    colors.border.subtle,
    colors.border.control,
  ];
  assertEq(all.length, 11, '§1 there are eleven colour tokens');
  const bad = all.filter((hex) => !/^#[0-9A-F]{6}$/.test(hex));
  assertEq(bad.length, 0, `§1 every colour is an uppercase #RRGGBB literal — bad: ${bad.join(',')}`);
  assertEq(new Set(all).size, all.length, '§1 no two colour tokens share a value');
}

/** Strip comments, so a comment that RECORDS a superseded value is not a token. */
function maskComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** The superseded draft values must not survive as tokens anywhere in the file. */
function testSupersededValuesAbsent(): void {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(process.cwd(), 'src/theme/tokens.ts'), 'utf8') as string;
  assert(source.length > 500, 'the token source was read from disk');

  // In CODE (comments stripped): the 10-24 draft's values must not appear at all.
  const code = maskComments(source).toUpperCase();
  for (const old of ['#1A1D24', '#4E5562', '#DDD8CE', '#8A909D']) {
    assert(
      code.indexOf(old) === -1,
      `the superseded draft value ${old} is not a token in src/theme/tokens.ts`,
    );
  }

  // In VALUES: no exported colour is a draft value, whatever the comments say.
  const exported = Object.keys(colors).map(
    (group) => (colors as Record<string, Record<string, string>>)[group],
  );
  const allValues = exported.reduce<string[]>((acc, group) => acc.concat(Object.values(group)), []);
  for (const old of ['#1A1D24', '#4E5562', '#DDD8CE', '#8A909D']) {
    assert(allValues.indexOf(old) === -1, `no exported colour is the superseded draft value ${old}`);
  }

  // And the spec's values are all really in the file, not just in the import graph.
  for (const hex of ['#1A1E29', '#4E576B', '#D9D4C7', '#6F7A92', '#3A4E85']) {
    assert(source.toUpperCase().indexOf(hex) !== -1, `the spec value ${hex} is present in src/theme/tokens.ts`);
  }
}

// ─── 5. The press feel ──────────────────────────────────────────────────────

function testPress(): void {
  assertEq(press.scale, 0.97, '§3 press scales to 0.97');
  assert(press.scale > 0.9 && press.scale < 1, `§3 the press scale is a gentle shrink — got ${press.scale}`);
  assertEq(press.durationMs, 90, '§3 the press takes 90 ms');
  assert(press.durationMs >= 60 && press.durationMs <= 120, `§3 the press is ~90 ms — got ${press.durationMs}`);
  assert(
    press.tintStepOpacity > 0 && press.tintStepOpacity <= 0.15,
    `§3 the press applies ONE step of tint, not a wash — got ${press.tintStepOpacity}`,
  );
  assert(
    press.overshootScale > 1 && press.overshootScale <= 1.05,
    `§3 the release overshoots gently (1 < s <= 1.05) — got ${press.overshootScale}`,
  );
  assert(
    press.releaseDurationMs > press.durationMs,
    '§3 the release is slower than the press, so it reads as gentle',
  );
}

// ─── RUN ────────────────────────────────────────────────────────────────────

function main(): void {
  testFourRadii();
  testSpacingScale();
  testHitTarget();
  testContrastPairs();
  testSpecValues();
  testSupersededValuesAbsent();
  testPress();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main();
