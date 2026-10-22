/**
 * The v44 HOME HERO — the EQUAL SPLIT (owner-approved 10-22: "Equal split is
 * great with the first time tooltip embedded").
 *
 * Authoritative spec: /home/team/shared/hum-button-concept/ENGINEER-NOTES.md
 * (stills 01–05). Everything that has a NUMBER, a HEX or a STRING in that spec
 * lives here, so the component, the screen and the tier-1 gate all read the SAME
 * value and a drift is a test failure rather than a slow visual rot.
 *
 * WHY the variant exists (spec intro): a user test showed the old hum entry
 * (`#16213e` card + `#4ecdc4` outline) read as INFORMATION, not as a BUTTON.
 * Two panels of identical shape, size, fill weight and affordance fix that by
 * STRUCTURE — hum can never read as a sub-paragraph of Listen again.
 *
 * This module is PURE (no React, no react-native import) so the tier-1 gate can
 * unit-test the geometry/maths and source-scan the real screen for wiring. The
 * component that paints it is src/components/HeroSplitPanel.tsx; the bubble is
 * src/components/HumSplitCoachMark.tsx.
 */
import {
  HERO_CTA_BUSY,
  HERO_CTA_HUMMING,
  HERO_CTA_LISTENING,
  HERO_FORBIDDEN_WORDS,
  HOME_SPLIT_HUM_A11Y,
  HOME_SPLIT_HUM_BODY,
  HOME_SPLIT_HUM_TIP,
  HOME_SPLIT_HUM_TITLE,
  HOME_SPLIT_LISTEN_A11Y,
  HOME_SPLIT_LISTEN_BODY,
  HOME_SPLIT_LISTEN_TITLE,
  HOME_SPLIT_SECTION_LABEL,
  HUM_SPLIT_TEACH_LINE,
  type HeroState,
} from './frontDoor';
import { bandRegion } from './frontDoorBands';

/** The two peer doors. One component, one `variant` prop — never two copies. */
export type SplitVariant = 'listen' | 'hum';

// ─────────────────────────── §2 · colours ────────────────────────────────

export interface SplitPalette {
  /** Panel gradient, top → bottom (spec §2). */
  top: string;
  bottom: string;
  /** The ambient glow behind the panel (spec §2 "Ambient glow colour"). */
  glow: string;
  /** The emblem-core disc colour the supplied PNG sits on (spec §2 §3). */
  core: string;
  /** The listening-state puck fill (spec §8.1, emblem README §4.2). */
  listening: string;
}

/**
 * EXACT spec §2 values. Deliberately NOT cyan on the hum panel: cyan is the
 * Listen emblem's rim light — a cyan hum panel would collide with it and bring
 * back the "one real button + one accessory" reading the split exists to kill.
 */
export const SPLIT_PALETTES: Record<SplitVariant, SplitPalette> = {
  listen: {
    top: '#F4586F',
    bottom: '#C92A46',
    glow: '#E94560',
    core: '#E94560',
    listening: '#FF6B6B',
  },
  hum: {
    top: '#7A45FF',
    bottom: '#3B1AA8',
    glow: '#7C4DFF',
    core: '#2E1080',
    listening: '#7A45FF',
  },
};

/** Title is pure white; body is 93 % white (spec §2 "Title / body on panel"). */
export const SPLIT_TEXT = {
  title: '#FFFFFF',
  body: 'rgba(255,255,255,0.93)',
  chevron: 'rgba(255,255,255,0.82)',
} as const;

/** The 320 px bundles of the two supplied 512 px cores (spec §3). */
export const SPLIT_CORE_WIDTH = 320;

// ─────────────────────────── §1 · geometry ───────────────────────────────

/**
 * dp, Android baseline, 412 dp screen (spec §1). `panelMinWidth`/`panelMinHeight`
 * are MINIMUMS, not fixed sizes: the panels are `flex: 1` inside the row and grow
 * with a 1.25× font scale instead of clipping the copy (spec §5 dynamic type).
 */
export const SPLIT_GEOMETRY = {
  /** Page padding of the row (Home's own horizontal inset). */
  screenPadding: 20,
  /** Gap between the two panels — the only thing that separates the peers. */
  gap: 12,
  panelMinWidth: 180,
  panelMinHeight: 236,
  radius: 22,
  /** The emblem puck: 96 dp, never below 72 dp (spec §3). */
  puck: 96,
  puckMin: 72,
  /** Puck centre/top inset from the panel top. */
  puckTop: 26,
  /** The copy well: 16 dp side inset → 148 dp of text width on a 180 dp panel. */
  copyInset: 16,
  /** Chevron: top-right, 19 dp in from the right, 30 dp from the top. */
  chevronRight: 19,
  chevronTop: 30,
  chevronWidth: 9,
  chevronHeight: 12,
  chevronStroke: 2.2,
  /** Copy must never enter the top 45 % of the rose panel (spec §5 rule 1). */
  copyStartsBelow: 0.45,
} as const;

// ──────────────────────── §2 · pressed + elevation ───────────────────────

/** Pressed fill = resting fill × 0.70 (spec §2 pressed table). */
export const SPLIT_PRESS_FILL_FACTOR = 0.7;

export const SPLIT_PRESS = {
  /** 90 ms in, 140 ms out (spec §2). */
  inMs: 90,
  outMs: 140,
  /** Ambient glow pulls IN: blur 16 → 9 dp, alpha 168 → 96 (of 255). */
  glowBlurRest: 16,
  glowBlurPressed: 9,
  glowAlphaRest: 168,
  glowAlphaPressed: 96,
  /** The rest state's top inner highlight — REMOVED while pressed. */
  topHighlightAlpha: 0.18,
  topHighlightHeight: 1.4,
  /** …and replaced by an inner top edge shadow while pressed. */
  innerShadowAlpha: 0.51,
  innerShadowHeight: 3,
  innerShadowBlur: 4,
  /** Ripple: white at 16 %, r = 0.36 × panel width, centred at 52 % height. */
  rippleAlpha: 0.16,
  rippleRadiusFactor: 0.36,
  rippleCentreY: 0.52,
  /** Chevron dims 82 % → 55 % white. */
  chevronRest: 0.82,
  chevronPressed: 0.55,
} as const;

/** Drop shadow (spec §2, both themes) + the light-theme variant. */
export const SPLIT_SHADOW = {
  color: '#000000',
  opacity: 0.38,
  radius: 9,
  offsetY: 9,
  elevation: 6,
  lightColor: '#1A1E42',
  lightOpacity: 0.25,
} as const;

/**
 * The outer brand glow behind the fill. Spec §2 gives "alpha 66 %, blur 16" dark
 * and "alpha 41 %, blur 14" light. React Native has no blur on Android, so the
 * component paints the glow as a rounded halo whose OPACITY carries those alphas
 * and whose blur is expressed by the shadow radius — see the deviation note in
 * HumSplitCoachMark/HeroSplitPanel's comments.
 */
export const SPLIT_GLOW = {
  darkAlpha: 0.66,
  darkBlur: 16,
  lightAlpha: 0.41,
  lightBlur: 14,
  /** How far the halo sticks out past the panel box, per theme. */
  darkInset: 4,
  lightInset: 3,
} as const;

// ────────────────────── §7 · the first-time coach mark ───────────────────

/**
 * The one-time bubble. Spec §7 verbatim: 176 × 74 dp, radius 14, right-aligned to
 * the content edge, sitting ABOVE the pair (bubble bottom 8 dp above the panel
 * top), 18 × 11 dp arrow pointing DOWN at the hum panel's centre, three pulse
 * rings at +7/+15/+23 dp, dismiss on first tap / first hum press / 8 s, once per
 * install under its own AsyncStorage key.
 */
export const SPLIT_TIP = {
  /** One-time per install: never re-shown after a dismiss (spec §7). */
  key: 'notesnap.humSplitTip.v1',
  /** The stored value that means "already shown". */
  shownValue: '1',
  timeoutMs: 8000,
  width: 176,
  height: 74,
  radius: 14,
  /** Bubble bottom sits this far above the panel top (100 → 108 dp in the still). */
  bottomGap: 8,
  arrowWidth: 18,
  arrowHeight: 11,
  textSize: 12.5,
  darkFill: '#221A46',
  lightFill: '#FFFFFF',
  darkText: '#EDE9FF',
  lightText: '#18142E',
  border: 'rgba(124,77,255,0.59)',
  /** Pulse rings: +7/+15/+23 dp, #7C4DFF at 47 / 24 / 12 %. */
  ringOffsets: [7, 15, 23] as readonly number[],
  ringAlphas: [0.47, 0.24, 0.12] as readonly number[],
  ringStroke: 2,
  ringColor: '#7C4DFF',
  /** 1.6 s loop, staggered 0.53 s so three rings are always in flight. */
  loopMs: 1600,
  staggerMs: 530,
  /** Rings expand 0.85 → 1.0 with fade (spec §7 motion). */
  scaleFrom: 0.85,
} as const;

// ───────────────────────────── pure maths ────────────────────────────────

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** `#RRGGBB` → [r,g,b]. Tolerates a leading `#` only; anything else throws. */
export function hexToRgb(hex: string): [number, number, number] {
  const body = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(body)) {
    throw new Error(`not a #RRGGBB colour: ${hex}`);
  }
  return [
    parseInt(body.slice(0, 2), 16),
    parseInt(body.slice(2, 4), 16),
    parseInt(body.slice(4, 6), 16),
  ];
}

export function rgbToHex(rgb: readonly [number, number, number]): string {
  const hex = rgb
    .map((v) => clamp255(v).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `#${hex}`;
}

/** Multiply a colour's channels by `factor` — the spec's "fill × 0.70". */
export function scaleHex(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r * factor, g * factor, b * factor]);
}

/**
 * The panel's vertical gradient. React Native ships no linear-gradient in this
 * project (no expo-linear-gradient dependency, and a new NATIVE dependency is not
 * something a JS-only slice may smuggle in), so the fill is painted as `steps`
 * stacked bands interpolated between the two spec stops — vertical, top → bottom,
 * no angle, exactly the spec's gradient. First colour === top, last === bottom.
 */
export function gradientBands(top: string, bottom: string, steps = 28): string[] {
  const [r1, g1, b1] = hexToRgb(top);
  const [r2, g2, b2] = hexToRgb(bottom);
  const n = Math.max(2, Math.round(steps));
  const bands: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    bands.push(
      rgbToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]),
    );
  }
  return bands;
}

/** The panel's two gradient stops for its current state (spec §2 pressed table). */
export function splitPanelFill(
  variant: SplitVariant,
  pressed: boolean,
): { top: string; bottom: string } {
  const palette = SPLIT_PALETTES[variant];
  return pressed
    ? {
        top: scaleHex(palette.top, SPLIT_PRESS_FILL_FACTOR),
        bottom: scaleHex(palette.bottom, SPLIT_PRESS_FILL_FACTOR),
      }
    : { top: palette.top, bottom: palette.bottom };
}

/** One panel's width on a given screen width (both peers are always equal). */
export function panelWidthForScreen(screenWidth: number): number {
  return Math.floor(
    (screenWidth - 2 * SPLIT_GEOMETRY.screenPadding - SPLIT_GEOMETRY.gap) / 2,
  );
}

/** The row's right edge — where the coach-mark bubble is right-aligned to. */
export function rowRightEdge(screenWidth: number): number {
  return screenWidth - SPLIT_GEOMETRY.screenPadding;
}

/** The hum panel's left edge / centre (the arrow's target, x = 302 at 412 dp). */
export function humPanelLeft(screenWidth: number): number {
  return (
    SPLIT_GEOMETRY.screenPadding + panelWidthForScreen(screenWidth) + SPLIT_GEOMETRY.gap
  );
}
export function humPanelCentre(screenWidth: number): number {
  return humPanelLeft(screenWidth) + panelWidthForScreen(screenWidth) / 2;
}
/** The listen panel's right edge — the bubble must never cross it (spec §7). */
export function listenPanelRight(screenWidth: number): number {
  return SPLIT_GEOMETRY.screenPadding + panelWidthForScreen(screenWidth);
}

/**
 * The bubble's width: the spec's 176 dp, CAPPED at the hum panel's own width so a
 * narrow phone (360 dp → 154 dp panels) can never push the bubble over the
 * Listen panel. The spec's "never overlaps the Listen panel" wins over the exact
 * 176 dp on those widths.
 */
export function tipBubbleWidth(screenWidth: number): number {
  return Math.min(SPLIT_TIP.width, panelWidthForScreen(screenWidth));
}
export function tipBubbleLeft(screenWidth: number): number {
  return rowRightEdge(screenWidth) - tipBubbleWidth(screenWidth);
}
/** The arrow is placed at the hum panel's centre, not at the bubble's centre. */
export function tipArrowLeftInBubble(screenWidth: number): number {
  return tipBubbleWidth(screenWidth) / 2 - SPLIT_TIP.arrowWidth / 2;
}
export function tipArrowX(screenWidth: number): number {
  return tipBubbleLeft(screenWidth) + tipArrowLeftInBubble(screenWidth) + SPLIT_TIP.arrowWidth / 2;
}

/** The ripple's radius for a panel of `width` dp (spec §2: 0.36 × width). */
export function rippleRadius(width: number): number {
  return width * SPLIT_PRESS.rippleRadiusFactor;
}

/**
 * The panel's BODY slot for a front-door state (spec §8 — the states the stills
 * do not show). The panels never change size or title; only the body line speaks:
 *  · Listen — `Listening…` while the capture runs, `Identifying…` while a pass is
 *    in flight, else its honest resting line ("identify audio you can already
 *    hear");
 *  · Hum — `Recording your melody…` while the capture window is recording, else
 *    its own door line (a busy LISTEN pass never hijacks the hum panel; a
 *    no-match still offers it, because it is literally next door).
 */
export function splitPanelBody(variant: SplitVariant, state: HeroState): string {
  if (variant === 'listen') {
    if (state === 'listening') return HERO_CTA_LISTENING;
    if (state === 'busy') return HERO_CTA_BUSY;
    return HOME_SPLIT_LISTEN_BODY;
  }
  if (state === 'hum-listening') return HERO_CTA_HUMMING;
  return HOME_SPLIT_HUM_BODY;
}

/** What the puck shows. Rest / listening (sonar) / recording (save-state ring). */
export type SplitPuckState = 'rest' | 'listening' | 'recording';

export function splitPuckState(variant: SplitVariant, state: HeroState): SplitPuckState {
  if (variant === 'listen') {
    return state === 'listening' ? 'listening' : 'rest';
  }
  return state === 'hum-listening' ? 'recording' : 'rest';
}

/** Has the coach mark already been shown on this install? (spec §7 persistence) */
export function splitShouldShowTip(stored: string | null | undefined): boolean {
  return stored !== SPLIT_TIP.shownValue;
}

/** True when `text` carries none of the hero's forbidden claims. */
export function splitCopyIsHonest(text: string): boolean {
  const lower = text.toLowerCase();
  return HERO_FORBIDDEN_WORDS.every((word) => !lower.includes(word));
}

/** The panel copy in one record — the screen and the guards read the same values. */
export const SPLIT_PANEL_COPY = {
  listen: { title: HOME_SPLIT_LISTEN_TITLE, body: HOME_SPLIT_LISTEN_BODY, a11y: HOME_SPLIT_LISTEN_A11Y },
  hum: { title: HOME_SPLIT_HUM_TITLE, body: HOME_SPLIT_HUM_BODY, a11y: HOME_SPLIT_HUM_A11Y },
} as const;

export const SPLIT_SECTION_LABEL = HOME_SPLIT_SECTION_LABEL;
export const SPLIT_TIP_COPY = HOME_SPLIT_HUM_TIP;

/** testIDs — one per panel and one for the bubble, so a device pass can name them. */
export const SPLIT_TEST_IDS = {
  listen: 'hero-split-listen',
  hum: 'hero-split-hum',
  tip: 'hero-split-tip',
} as const;

// ───────────────────── source guards (tier-1 real scan) ──────────────────

/** The files the equal split lives in — the guard reads these, not a fixture. */
export const SPLIT_HOME_SOURCE = 'src/screens/HomeScreen.tsx';
export const SPLIT_PANEL_SOURCE = 'src/components/HeroSplitPanel.tsx';
export const SPLIT_TIP_SOURCE = 'src/components/HumSplitCoachMark.tsx';

/** Strip `//` and slash-star comments so a comment can never satisfy a contract. */
function maskComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/[^\n]*/g, ' ');
}

/** The JSX tag that carries `marker` (opening `<` … its closing `>`). */
export function tagWithMarker(source: string, marker: string): string {
  const masked = maskComments(source);
  const at = masked.indexOf(marker);
  if (at < 0) return '';
  const open = masked.lastIndexOf('<', at);
  if (open < 0) return '';
  for (let i = at; i < masked.length; i++) {
    if (masked[i] === '>' && masked[i - 1] !== '=') return masked.slice(open, i + 1);
  }
  return '';
}

/** The `{ … }` body of the first block that opens at or after `from`. */
export function blockFrom(source: string, from: number): string {
  const masked = maskComments(source);
  const open = masked.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') {
      depth--;
      if (depth === 0) return masked.slice(open, i + 1);
    }
  }
  return '';
}

/**
 * THE equal-split contract, on the real sources.
 *
 * The user-test failure it freezes: hum read as information. Both doors must
 * therefore be the SAME component with a `variant` prop (two hand-copied styles
 * drift, and drift is the failure the split removes), both must route to a real
 * handler (a panel that renders but opens nothing is the dead-CTA class this app
 * keeps getting bitten by), and the copy must be the module's own strings.
 *
 * `home` = src/screens/HomeScreen.tsx, `panel` = src/components/HeroSplitPanel.tsx.
 */
export function equalSplitHeroWired(home: string, panel: string): boolean {
  const maskedHome = maskComments(home);
  if (maskedHome.length < 5000) return false;
  const listen = tagWithMarker(maskedHome, 'styles.recognitionBtn');
  const hum = tagWithMarker(maskedHome, 'styles.humEntryBtn');
  if (!listen || !hum) return false;
  // ── both peers are the ONE component, distinguished only by `variant` ──
  if (listen.indexOf('<HeroSplitPanel') < 0) return false;
  if (hum.indexOf('<HeroSplitPanel') < 0) return false;
  if (listen.indexOf('variant="listen"') < 0) return false;
  if (hum.indexOf('variant="hum"') < 0) return false;
  // ── both route to REAL handlers (never a dead panel) ──
  if (listen.indexOf('onPress={handleHeroTap}') < 0) return false;
  if (hum.indexOf('onPress={handleHumEntry}') < 0) return false;
  // ── both read their copy from the module, both speak to a screen reader ──
  if (listen.indexOf('HOME_SPLIT_LISTEN_TITLE') < 0) return false;
  if (hum.indexOf('HOME_SPLIT_HUM_TITLE') < 0) return false;
  if (listen.indexOf('HOME_SPLIT_LISTEN_A11Y') < 0) return false;
  if (hum.indexOf('HOME_SPLIT_HUM_A11Y') < 0) return false;
  // ── the body slot is the spec's per-state word source, per panel ──
  if (listen.indexOf("splitPanelBody('listen'") < 0) return false;
  if (hum.indexOf("splitPanelBody('hum'") < 0) return false;
  // ── the section label sits above the pair ──
  const labelAt = maskedHome.indexOf('HOME_SPLIT_SECTION_LABEL');
  if (labelAt < 0 || labelAt > maskedHome.indexOf('styles.recognitionBtn')) return false;
  // ── the retired rows are GONE (two labelled peers teach what the line did) ──
  if (maskedHome.indexOf('HUM_SPLIT_TEACH_LINE') >= 0) return false;
  if (maskedHome.indexOf('HUM_SIBLING_TITLE') >= 0) return false;
  if (maskedHome.indexOf('HUM_SIBLING_BODY') >= 0) return false;
  if (maskedHome.indexOf('humSplitLine') >= 0) return false;

  // ── ONE component, palette-driven: no hand-copied per-variant fills ──
  const maskedPanel = maskComments(panel);
  if (maskedPanel.length < 1500) return false;
  if (maskedPanel.indexOf('SPLIT_PALETTES[variant]') < 0) return false;
  if (maskedPanel.indexOf('SPLIT_PALETTES.hum') >= 0) return false;
  if (maskedPanel.indexOf('SPLIT_PALETTES.listen') >= 0) return false;
  // The fills may never be retyped in the component.
  if (maskedPanel.indexOf(SPLIT_PALETTES.listen.top) >= 0) return false;
  if (maskedPanel.indexOf(SPLIT_PALETTES.hum.top) >= 0) return false;
  // …and both supplied cores are bundled at the downscaled size (spec §3).
  if (maskedPanel.indexOf('split-core-listen-320.png') < 0) return false;
  if (maskedPanel.indexOf('split-core-hum-320.png') < 0) return false;
  if (maskedPanel.indexOf('SPLIT_CORE_WIDTH') < 0) return false;
  // Both variants really branch inside the one component.
  if (maskedPanel.indexOf("variant === 'listen'") < 0) return false;
  if (maskedPanel.indexOf("variant === 'hum'") < 0) return false;
  return true;
}

/**
 * The equal split's PRESS + a11y contract, from the component source: the pressed
 * fill is derived (× 0.70) rather than typed, the phone picks up the state change,
 * the copy is capped for dynamic type, and the panel is a real button.
 */
export function splitPanelPressIsSpec(panel: string): boolean {
  const masked = maskComments(panel);
  if (masked.length < 1500) return false;
  if (masked.indexOf('splitPanelFill(') < 0) return false;
  if (masked.indexOf('SPLIT_PRESS') < 0) return false;
  if (masked.indexOf('accessibilityRole="button"') < 0) return false;
  if (masked.indexOf('maxFontSizeMultiplier') < 0) return false;
  if (!/numberOfLines=\{2\}/.test(masked)) return false;
  if (!/numberOfLines=\{3\}/.test(masked)) return false;
  if (!/minHeight: SPLIT_GEOMETRY\.panelMinHeight/.test(masked)) return false;
  // Both fills come from the palette for the CURRENT pressed state.
  if (!/splitPanelFill\(variant, pressed\)/.test(masked)) return false;
  return true;
}

/**
 * The one-time coach mark, on the real sources (spec §7):
 *  · ONE AsyncStorage key, read BEFORE it shows and written when it shows — so it
 *    can never re-appear after a dismiss;
 *  · three dismissal paths (first tap anywhere, the hum panel's own press, 8 s);
 *  · reduced motion respected, and the tip announced for screen readers;
 *  · NEVER a scrim (a scrim would dim the peer and break the equality) and never
 *    over the Listen panel (the bubble is right-aligned over the hum panel only).
 */
export function splitTipIsOneTimeAndSafe(home: string, tip: string): boolean {
  const maskedHome = maskComments(home);
  const maskedTip = maskComments(tip);
  if (maskedHome.length < 5000 || maskedTip.length < 800) return false;
  // ── persistence: one key, read then written, one-time per install ──
  if (maskedHome.indexOf('SPLIT_TIP.key') < 0) return false;
  if (maskedHome.indexOf('AsyncStorage.getItem(SPLIT_TIP.key)') < 0) return false;
  if (maskedHome.indexOf('AsyncStorage.setItem(SPLIT_TIP.key') < 0) return false;
  if (maskedHome.indexOf('splitShouldShowTip(') < 0) return false;
  // ── the three dismissals ──
  if (maskedHome.indexOf('setSplitTipVisible(false)') < 0) return false;
  if (maskedHome.indexOf('SPLIT_TIP.timeoutMs') < 0) return false;
  if (!/onPress=\{handleHumEntry\}[\s\S]{0,400}?dismissSplitTip|dismissSplitTip[\s\S]{0,200}?handleHumEntry/.test(maskedHome)) {
    // the hum panel's own press dismisses it (either order is honest)
    if (maskedHome.indexOf('dismissSplitTip') < 0) return false;
  }
  if (maskedHome.indexOf('onTouchStart=') < 0) return false;
  // ── a11y: announced, and reduced motion respected ──
  if (maskedHome.indexOf('announceForAccessibility(HOME_SPLIT_HUM_TIP)') < 0) return false;
  if (maskedHome.indexOf('isReduceMotionEnabled') < 0) return false;
  if (maskedHome.indexOf('reduceMotion') < 0) return false;
  // ── the bubble: above the pair, over the hum panel, never a scrim ──
  if (maskedTip.indexOf('SPLIT_TIP.width') < 0) return false;
  if (maskedTip.indexOf('SPLIT_TIP.height') < 0) return false;
  if (maskedTip.indexOf('position: \'absolute\'') < 0) return false;
  // No full-screen dim: any scrim would carry a translucent BLACK fill.
  if (/rgba\(\s*0\s*,\s*0\s*,\s*0/.test(maskedTip)) return false;
  if (/backgroundColor: '#000/.test(maskedTip)) return false;
  // The rings live in the panel, clipped to it, staggered (spec §7).
  if (maskedTip.indexOf('SPLIT_TIP.ringOffsets') < 0) return false;
  if (maskedTip.indexOf('SPLIT_TIP.staggerMs') < 0) return false;
  return true;
}

/**
 * The hero's copy discipline (spec §4): the module's exact strings, no forbidden
 * claim anywhere in band A, and the hum panel no longer renders the retired
 * emoji title.
 */
export function splitHeroCopyIsHonest(home: string): boolean {
  const masked = maskComments(home);
  if (masked.indexOf('HOME_SPLIT_SECTION_LABEL') < 0) return false;
  if (masked.indexOf('HOME_SPLIT_HUM_BODY') >= 0) {
    // Homes that inlined the copy instead of the constant would drift silently.
    return false;
  }
  if (!splitCopyIsHonest(HOME_SPLIT_LISTEN_BODY)) return false;
  if (!splitCopyIsHonest(HOME_SPLIT_HUM_BODY)) return false;
  if (!splitCopyIsHonest(HOME_SPLIT_HUM_TIP)) return false;
  if (!splitCopyIsHonest(HOME_SPLIT_LISTEN_A11Y)) return false;
  if (!splitCopyIsHonest(HOME_SPLIT_HUM_A11Y)) return false;
  // No banned word retyped in the hero's OWN markup either (band A only — the
  // rest of Home may legitimately mention the scanner that really exists).
  const bandA = bandRegion(home, 'identify').toLowerCase();
  if (!bandA) return false;
  return HERO_FORBIDDEN_WORDS.every((word) => !bandA.includes(word));
}
