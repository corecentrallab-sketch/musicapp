/**
 * settingsSpec.ts — DESIGNER SPEC §3 · SETTINGS, REGROUPED (v43 slice 2).
 *
 * The spec turns Settings into FOUR groups with the Pro row on top and NO Account
 * section:
 *
 *     Pro row → Audio & Recording → Playback → Cloud Sync & Storage → Support
 *
 * Everything a surface needs to know lives here, as pure data and pure detectors:
 *
 *   • THE COPY (verbatim from the spec, except the version number, which is read
 *     live from the app config — the frame's "0.1.32" is stale by construction).
 *   • THE GEOMETRY (52 dp rows inset x32, r16 cards, 20 dp apart, 11 dp caps
 *     headers 20 above / 18 below, 38×22 toggle, 13 dp value, 11.5 dp footnote).
 *     v47.1 Part A: the row/pro heights are FLOORS (`minHeight`) plus vertical
 *     padding, never a fixed `height`, and the sub's old right-100 dp cap is gone
 *     — the copy block flexes and the trailing value is measured (see
 *     services/v471SettingsFit.ts, which enforces the shape).
 *   • THE ROLE MAP: the designer's roles (CARD, LINE, CARD_LINE, SUB, TXT, HUM,
 *     LISTEN, SOFTFILL, PILL_ON, DIM) are NOT new colours — each one is an
 *     existing `theme.ts` role, so both themes are a token swap and nothing else.
 *   • THE HONEST VALUES. Three rows have no user-editable state in the app, and
 *     this module says so in the copy rather than inventing a control:
 *       – Microphone access  → the REAL permission state, read live.
 *       – Noise filter       → "Always on": the cleanup is always applied
 *                              (pitchDetection's filters + the backend query
 *                              high/low-pass); there is no stored toggle to flip.
 *       – Auto-scroll speed  → per-piece memory set in the score reader; the row
 *                              reports the profile a piece without a saved speed
 *                              starts from. No global speed setting exists.
 *   • THE DETECTORS the v43 §3 guard suite runs against the REAL screen source
 *     (source scans, so they bite without a recompile — that is how the mutation
 *     probes are executed).
 *
 * PURE: no react, no react-native, no storage — tier1-compiled (see
 * tsconfig.tier1.json) and asserted by scripts/uxr-v43-settings.test.ts.
 */
import { maskSourceComments } from './audioFocusContract';
import type { ThemeMode, ThemeTokens } from './theme';
import { DEFAULT_PAGE_TURN_PROFILE, PAGE_TURN_PRESETS } from './pageTurnPresets';

declare const process: { cwd(): string; exit(code: number): never };

// ═══════════════════════════ §3 · the copy ═══════════════════════════

/** The four group headers, in the spec's order. There is no Account section. */
export const SETTINGS_GROUP_TITLES: readonly string[] = [
  'Audio & Recording',
  'Playback',
  'Cloud Sync & Storage',
  'Support',
];

/** The Pro row — the money path, one quiet row. */
export const SETTINGS_PRO_TITLE = 'NoteSnap Pro';
export const SETTINGS_PRO_SUB = 'Unlimited recognition · full History';
export const SETTINGS_PRO_CTA = 'View plans';

/** The one, once, at the bottom — honest about there being no account at all. */
export const SETTINGS_NO_ACCOUNT_LINE =
  'No account needed — NoteSnap has nothing to sign in to.';

/** The closed row set, in the order the spec draws them. */
export type SettingsRowId =
  | 'microphone'
  | 'noiseFilter'
  | 'theme'
  | 'autoScroll'
  | 'googleDrive'
  | 'dropbox'
  | 'help'
  | 'privacy'
  | 'about';

/** The v45 slice-2 block's row ids (owner call 10-26 — Home's retention chips). */
export type SettingsRetentionRowId = 'streak' | 'medals' | 'week';

export interface SettingsRowCopy {
  id: SettingsRowId | SettingsRetentionRowId;
  title: string;
  /** Empty when the row has no subtitle (the spec then centres the title). */
  sub: string;
  /**
   * The group the row belongs to (index into SETTINGS_GROUP_TITLES). The v45
   * retention rows use 4 — their own card, AFTER the four spec groups.
   */
  group: number;
  /**
   * v45 slice 2 (owner 10-26): when set, the screen renders `title={REF}` and the
   * copy lives in ANOTHER module (`services/frontDoorBands`) — the guard pins the
   * IDENTIFIER, never a second copy of the string, so the door's chip label and
   * this row can never drift apart. `title` then holds the identifier too.
   */
  titleRef?: string;
  subRef?: string;
}

/**
 * THE CLOSED SET. Anything not named here has no home on this surface — the
 * surfacing guard in the delivery report lists what that leaves out and where it
 * still lives.
 */
export const SETTINGS_ROWS: readonly SettingsRowCopy[] = [
  {
    id: 'microphone',
    title: 'Microphone access',
    sub: 'Allowed while using the app',
    group: 0,
  },
  {
    id: 'noiseFilter',
    title: 'Noise filter',
    sub: 'Clean the room before matching',
    group: 0,
  },
  { id: 'theme', title: 'Theme', sub: 'Dark, light or follow system', group: 1 },
  {
    id: 'autoScroll',
    title: 'Auto-scroll speed',
    sub: 'Page turns while you play',
    group: 1,
  },
  {
    id: 'googleDrive',
    title: 'Google Drive',
    sub: 'Back up scores and takes',
    group: 2,
  },
  { id: 'dropbox', title: 'Dropbox', sub: 'Back up scores and takes', group: 2 },
  { id: 'help', title: 'Help & FAQ', sub: '', group: 3 },
  { id: 'privacy', title: 'Privacy policy', sub: '', group: 3 },
  { id: 'about', title: 'About NoteSnap', sub: '', group: 3 },
];

/**
 * v45 SLICE 2 (OWNER CALL 10-26) — "YOUR PRACTICE", the block that took over the
 * retention that used to close Home's retired "Browse & keep going" band:
 *
 *     Current streak (a VALUE) · 🏅 Achievements · 📋 This Week
 *
 * It is deliberately NOT a §3 spec group: it keeps its own v45 card
 * (`styles.retentionCard`) and is APPENDED after Support, so the whole surface =
 * the §3 closed set FOLLOWED BY these three rows. Two of the three titles are
 * rendered from the identifiers `services/frontDoorBands` owns (`titleRef`), which
 * is why the guard compares `{MEDALS_CHIP_LABEL}` rather than a copy of the label.
 */
export const SETTINGS_RETENTION_HEADER = 'Your practice';
export const SETTINGS_RETENTION_SUB = 'Your streak, your medals and this week.';

export const SETTINGS_RETENTION_ROWS: readonly SettingsRowCopy[] = [
  {
    id: 'streak',
    title: 'Current streak',
    sub: 'Days in a row you have practised',
    group: 4,
  },
  {
    id: 'medals',
    title: 'MEDALS_CHIP_LABEL',
    sub: 'ACHIEVEMENTS_ENTRY_HINT',
    group: 4,
    titleRef: 'MEDALS_CHIP_LABEL',
    subRef: 'ACHIEVEMENTS_ENTRY_HINT',
  },
  {
    id: 'week',
    title: 'WEEK_CHIP_LABEL',
    sub: 'The days you practised this week',
    group: 4,
    titleRef: 'WEEK_CHIP_LABEL',
  },
];

/** Every row the surface renders, in source order: §3 groups, then the v45 block. */
export function allSettingsRows(): SettingsRowCopy[] {
  return [...SETTINGS_ROWS, ...SETTINGS_RETENTION_ROWS];
}

/**
 * The key a rendered row must carry: its literal title, or `{IDENT}` when the copy
 * is an identifier another module owns (a `titleRef` row).
 */
export function settingsRowKey(row: SettingsRowCopy): string {
  return row.titleRef ? `{${row.titleRef}}` : row.title;
}

/** The closed set as the guard compares it — literals and `{IDENT}` keys, in order. */
export function settingsClosedSetKeys(): string[] {
  return allSettingsRows().map(settingsRowKey);
}

/** The rows the spec promises are an HONEST VALUE, not a control. */
export const SETTINGS_VALUE_ONLY_ROWS: readonly (SettingsRowId | SettingsRetentionRowId)[] = [
  'noiseFilter',
  'autoScroll',
  // v45 slice 2: the streak is STATE — visible, but nothing to press.
  'streak',
];

/**
 * The privacy page the Play listing already points at (app.json →
 * `privacyPolicyUrl`). One URL, one owner: the guard suite asserts the two agree.
 */
export const SETTINGS_PRIVACY_URL = 'https://site-notesnap.vercel.app/privacy';

/** The honest Help & FAQ content — every line is something this build can back. */
export const SETTINGS_FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'What can NoteSnap recognise?',
    a: 'Audio that matches our public-domain sheet-music library, and a melody you hum, whistle or sing.',
  },
  {
    q: 'What does a modern song give me?',
    a: 'Song ID for modern recordings, plus a link to the official sheet music or tab at a licensed retailer. We never host or copy copyrighted scores.',
  },
  {
    q: 'What is free?',
    a: 'Recognition, the editor, the practice tools and your History. The free plan is 5 recognitions a month; Pro removes the cap.',
  },
  {
    q: 'Where is my data?',
    a: 'History and settings stay on this device. Google Drive and Dropbox are optional, and only hold what you send them.',
  },
];

// ═══════════════════════════ §3 · the geometry (dp) ═══════════════════════════

/** Every number in the spec's §3 layout, named once. The style block reads these. */
export const SETTINGS_SPEC = {
  /** The screen's side inset — the cards are 358 of 390 wide. */
  screenInset: 16,
  /** Cards: r16, CARD fill + 1 dp CARD_LINE, 20 dp apart. */
  cardRadius: 16,
  cardBorderWidth: 1,
  cardGap: 20,
  /** Section header: 11 dp caps bold SUB, 20 above / 18 below, indent x16. */
  headerSize: 11,
  headerAbove: 20,
  headerBelow: 18,
  /**
   * The Pro row: a 62 dp FLOOR (never a fixed height — the row grows with the OS
   * font scale), r16, CARD + 1 dp LISTEN border.
   */
  proMinHeight: 62,
  proPadY: 12,
  proRadius: 16,
  proBorderWidth: 1,
  proTitleSize: 16,
  proSubSize: 12,
  /** One row style everywhere: a 52 dp FLOOR, inset x32, title 15, sub 11, value 13. */
  rowMinHeight: 52,
  rowPadY: 10,
  rowInset: 32,
  rowTitleSize: 15,
  rowSubSize: 11,
  rowValueSize: 13,
  /**
   * The gap between the flexing copy block and the trailing value. The v47 defect
   * reserved a HARD 100 dp here (`paddingRight: 100`) instead of measuring the
   * value, which clipped the copy the moment the text scaled up.
   */
  rowValueGap: 12,
  /** The toggle: 38 × 22 (r11). */
  toggleWidth: 38,
  toggleHeight: 22,
  toggleRadius: 11,
  /** The footnote. */
  footnoteSize: 11.5,
} as const;

// ═══════════════════════════ §3 · the role map ═══════════════════════════

/**
 * The designer's role names. Each maps onto an EXISTING theme.ts token — no new
 * hex anywhere, so the light theme is the token swap and nothing else.
 *
 *   CARD      → surface    (the card fill)
 *   CARD_LINE → border     (the card's 1 dp border)
 *   LINE      → border     (the hairline between rows inside a card)
 *   SUB       → subtext    (headers, subtitles)
 *   DIM       → subtext    (the footnote — the app's dimmest text role)
 *   TXT       → text       (row titles)
 *   HUM       → positive   (values, the ON toggle, the pill's text)
 *   LISTEN    → accent     (the Pro row's 1 dp border — the app's signature edge)
 *   SOFTFILL  → chipBg     (the "View plans" pill fill)
 *   PILL_ON   → chipText   (the toggle knob)
 */
export type SettingsRole =
  | 'CARD'
  | 'CARD_LINE'
  | 'LINE'
  | 'SUB'
  | 'DIM'
  | 'TXT'
  | 'HUM'
  | 'LISTEN'
  | 'SOFTFILL'
  | 'PILL_ON';

export const SETTINGS_ROLES: readonly SettingsRole[] = [
  'CARD',
  'CARD_LINE',
  'LINE',
  'SUB',
  'DIM',
  'TXT',
  'HUM',
  'LISTEN',
  'SOFTFILL',
  'PILL_ON',
];

/**
 * THE ROLES THIS SURFACE RENDERS TODAY. PILL_ON is the toggle's knob, and no row
 * owns a toggle yet: the one switch the spec draws (Noise filter) would flip
 * nothing today (see NOISE_FILTER_VALUE), so the shape is defined and reserved
 * rather than shipped as a control that lies.
 */
export const SETTINGS_RENDERED_ROLES: readonly SettingsRole[] = [
  'CARD',
  'CARD_LINE',
  'LINE',
  'SUB',
  'DIM',
  'TXT',
  'HUM',
  'LISTEN',
  'SOFTFILL',
];

export type SettingsPalette = Record<SettingsRole, string>;

/** The role → token table (the ONE place a role becomes a colour). */
export function settingsPalette(tokens: ThemeTokens): SettingsPalette {
  return {
    CARD: tokens.surface,
    CARD_LINE: tokens.border,
    LINE: tokens.border,
    SUB: tokens.subtext,
    DIM: tokens.subtext,
    TXT: tokens.text,
    HUM: tokens.positive,
    LISTEN: tokens.accent,
    SOFTFILL: tokens.chipBg,
    PILL_ON: tokens.chipText,
  };
}

/** Every role resolves to a token the app already ships (never a literal). */
export function settingsPaletteIsTokenValuesOnly(tokens: ThemeTokens): boolean {
  const palette = settingsPalette(tokens) as unknown as Record<string, string>;
  const allowed = Object.keys(tokens)
    .map((key) => (tokens as unknown as Record<string, string>)[key].toLowerCase())
    .concat(['transparent']);
  return SETTINGS_ROLES.every((role) => allowed.indexOf(palette[role].toLowerCase()) >= 0);
}

// ═══════════════════════ §3 · the honest values ═══════════════════════

/** What the app can actually read about the microphone. Never an invented state. */
export type MicrophoneAccessState = 'granted' | 'denied' | 'undetermined' | 'unknown';

/** The row's trailing value — the truth about the live permission, never "Allowed" by default. */
export function microphoneAccessLabel(state: MicrophoneAccessState): string {
  if (state === 'granted') return 'Allowed';
  if (state === 'undetermined') return 'Not asked yet';
  if (state === 'denied') return 'Not allowed';
  return 'Not checked';
}

/** The Theme row's value: the mode the app is really in right now. */
export function themeValueLabel(mode: ThemeMode | string | null | undefined): string {
  return mode === 'light' ? 'Light' : 'Dark';
}

/** The cloud rows' value: the real connection state of that provider. */
export function cloudValueLabel(connected: boolean): string {
  return connected ? 'Connected' : 'Not connected';
}

/**
 * THE NOISE FILTER (honest by construction). Nothing in the app stores a
 * "noise filter" preference: the pitch extractor always filters breath and room
 * tone (services/pitchDetection) and the backend always runs its query-side
 * high/low-pass. So the row reports what is true — it is on, always — instead of
 * offering a switch that would change nothing.
 */
export const NOISE_FILTER_VALUE = 'Always on';

export function noiseFilterValueLabel(): string {
  return NOISE_FILTER_VALUE;
}

/**
 * THE AUTO-SCROLL SPEED (honest by construction). The page-turner speed is a
 * PER-PIECE memory (services/pageTurnPresets + pageTurnSpeedStore), set in the
 * score reader; there is no app-wide speed setting to change from Settings. The
 * row therefore names the profile a piece with no saved speed starts from.
 */
export function autoScrollValueLabel(): string {
  const match = PAGE_TURN_PRESETS.find(
    (preset) =>
      preset.bpm === DEFAULT_PAGE_TURN_PROFILE.bpm &&
      preset.beatsPerPage === DEFAULT_PAGE_TURN_PROFILE.beatsPerPage
  );
  return match ? match.label : 'Default';
}

/** The sub copy explains WHERE that speed is set (so the row is not a dead end). */
export const AUTO_SCROLL_HONEST_SUB = 'Per piece — set it in the score reader';

/**
 * THE VERSION (spec §3 says "Version 0.1.32"; that number is stale by
 * construction). The live value is the app config's own version, and a config
 * that cannot be read says so instead of showing a number we do not know.
 */
export function aboutVersionLine(version: unknown): string {
  if (typeof version === 'string' && version.trim().length > 0) {
    return `Version ${version.trim()}`;
  }
  return 'Version unavailable';
}

/** What the About row says when tapped: only facts this build can back. */
export function aboutDialogBody(version: unknown): string {
  return [
    aboutVersionLine(version),
    '',
    'Sheet-music recognition: audio that matches our public-domain library, or a melody you hum, whistle or sing.',
    'Modern songs: song ID plus the official sheet music or tab from a licensed retailer.',
    'No account needed — your History and settings stay on this device.',
  ].join('\n');
}

/** The Help & FAQ dialog body, from SETTINGS_FAQ (one source for the words). */
export function faqDialogBody(): string {
  return SETTINGS_FAQ.map((entry) => `${entry.q}\n${entry.a}`).join('\n\n');
}

// ═══════════════════════ §3 · the detectors (source scans) ═══════════════════════

/**
 * A row's title INSIDE its own block: a literal (`title="Theme"`) or an identifier
 * (`title={MEDALS_CHIP_LABEL}`, v45 slice 2 — the copy lives in frontDoorBands).
 * Group 1 = literal, group 2 = identifier.
 */
const SPEC_ROW_TITLE = /title=(?:"([^"]*)"|\{\s*([A-Za-z_$][\w$]*)\s*\})/;

/** Every `<SpecRow>` block in the screen source (comments masked). */
export function specRowBlocks(settingsSource: string): string[] {
  const text = maskSourceComments(settingsSource);
  // A rendered row starts a line: `<SpecRow` + newline (the component's OWN
  // `<SpecRowProps>` type parameter must never count as a row).
  const starts: number[] = [];
  const marker = /<SpecRow\s*\n/g;
  let found = marker.exec(text);
  while (found) {
    starts.push(found.index);
    found = marker.exec(text);
  }
  // A row ends at its own `/>` — never at the next row, so one row's wiring can
  // never make its neighbour look wired.
  return starts.map((at) => {
    const close = text.indexOf('/>', at);
    return text.slice(at, close < 0 ? text.length : close + 2);
  });
}

/**
 * The titles of the rows the screen renders, in order — each row's OWN title, read
 * from its own `<SpecRow>` block so one row can never inherit its neighbour's: a
 * literal as-is, or `{IDENT}` when the row renders another module's identifier.
 */
export function specRowTitles(settingsSource: string): string[] {
  return specRowBlocks(settingsSource).map((block) => {
    const match = SPEC_ROW_TITLE.exec(block);
    if (match === null) return '';
    return match[1] !== undefined ? match[1] : `{${match[2]}}`;
  });
}

/** The four headers appear as rendered section headers, IN THE SPEC'S ORDER. */
export function settingsHasGroupsInOrder(settingsSource: string): boolean {
  const text = maskSourceComments(settingsSource);
  let cursor = -1;
  for (const title of SETTINGS_GROUP_TITLES) {
    // A header is its own rendered line — `<Text …>Title</Text>`, not a comment.
    const at = text.indexOf(`>${title}</Text>`);
    if (at < 0) return false;
    if (at < cursor) return false;
    cursor = at;
  }
  return true;
}

/** Each header sits ABOVE the rows of its own group (the grouping is visible). */
export function settingsHeadersPrecedeTheirRows(settingsSource: string): boolean {
  const text = maskSourceComments(settingsSource);
  for (let group = 0; group < SETTINGS_GROUP_TITLES.length; group += 1) {
    const headerAt = text.indexOf(`>${SETTINGS_GROUP_TITLES[group]}</Text>`);
    if (headerAt < 0) return false;
    for (const row of SETTINGS_ROWS.filter((entry) => entry.group === group)) {
      const rowAt = text.indexOf(`title="${row.title}"`);
      if (rowAt < 0) return false;
      if (rowAt < headerAt) return false;
    }
  }
  return true;
}

/** NO Account section and no sign-in / profile row — stated once, at the bottom. */
export function settingsHasNoAccountSection(settingsSource: string): boolean {
  const text = maskSourceComments(settingsSource);
  if (/(?:title="|>)\s*Account\s*(?:<|")/.test(text)) return false;
  if (/(?:title="|>)\s*(?:Sign in|Sign In|Log in|Log In|Create account|Profile|My profile)\s*(?:<|")/i.test(text)) {
    return false;
  }
  // …and the honest statement is there instead.
  return text.indexOf('{SETTINGS_NO_ACCOUNT_LINE}') >= 0;
}

/** The Pro row exists (CARD + LISTEN edge, its copy) and its pill opens the plans flow. */
export function settingsProRowIsWired(settingsSource: string): boolean {
  const text = maskSourceComments(settingsSource);
  if (text.indexOf(`styles.proRow`) < 0) return false;
  if (text.indexOf(`styles.proTitle`) < 0) return false;
  if (text.indexOf(`styles.proSub`) < 0) return false;
  if (text.indexOf('{SETTINGS_PRO_TITLE}') < 0) return false;
  if (text.indexOf('{SETTINGS_PRO_SUB}') < 0) return false;
  if (text.indexOf('{SETTINGS_PRO_CTA}') < 0) return false;
  // The pill is a real pressable wired to the plans handler…
  if (!/styles\.proCta[\s\S]{0,400}?onPress=\{openPlans\}/.test(text)) return false;
  // …and the handler really opens the EXISTING plans flow (the checkout cards).
  if (text.indexOf('openPlans') < 0) return false;
  if (text.indexOf('onPress={() => handleUpgrade(plan.id)}') < 0) return false;
  return text.indexOf('handleUpgrade') >= 0;
}

/**
 * The closed set: exactly these rows, in this order, each rendered once — the §3
 * groups FOLLOWED BY the v45 slice-2 "Your practice" block.
 */
export function settingsRowsAreTheClosedSet(settingsSource: string): boolean {
  const rendered = specRowTitles(settingsSource);
  const expected = settingsClosedSetKeys();
  if (JSON.stringify(rendered) !== JSON.stringify(expected)) return false;
  // …and the copy in the screen is the copy in this module (no drift). A `titleRef`
  // / `subRef` row proves the IDENTIFIER is rendered; the value is pinned by the
  // module that owns it, which is the point of never retyping it here.
  const text = maskSourceComments(settingsSource);
  return allSettingsRows().every((row) => {
    if (text.indexOf(row.titleRef ? `title={${row.titleRef}}` : `title="${row.title}"`) < 0) {
      return false;
    }
    if (row.subRef) return text.indexOf(`sub={${row.subRef}}`) >= 0;
    return row.sub === '' || text.indexOf(`sub="${row.sub}"`) >= 0;
  });
}

/**
 * NO DEAD ROWS. Every row either has a real `onPress` (a destination the app
 * already has) or is one of the declared honest VALUE rows, which must carry NO
 * pressable affordance (no onPress, no chevron) — a value that cannot be changed
 * must not look like something you can press.
 */
export function settingsHasNoDeadRows(settingsSource: string): boolean {
  const blocks = specRowBlocks(settingsSource);
  if (blocks.length === 0) return false;
  const valueOnly = allSettingsRows()
    .filter((row) => SETTINGS_VALUE_ONLY_ROWS.indexOf(row.id) >= 0)
    .map(settingsRowKey);
  for (const block of blocks) {
    const title = SPEC_ROW_TITLE.exec(block);
    if (title === null) return false;
    const key = title[1] !== undefined ? title[1] : `{${title[2]}}`;
    const isValueOnly = valueOnly.indexOf(key) >= 0;
    const hasOnPress = /onPress=\{(?!\s*(?:undefined|null)\s*\})/.test(block);
    if (isValueOnly && hasOnPress) return false;
    if (!isValueOnly && !hasOnPress) return false;
  }
  return true;
}

/** Every wired row reaches a destination that EXISTS (greped by the guard suite). */
export function settingsRowsReachRealDestinations(settingsSource: string): boolean {
  const text = maskSourceComments(settingsSource);
  const destinations = [
    // Pro row → the existing checkout/plans flow in this screen.
    'onPress={() => handleUpgrade(plan.id)}',
    // Microphone → the system settings page (the app's existing permission path).
    'Linking.openSettings()',
    // Theme → the existing Dark/Light choice, through the shared store.
    "setThemeMode('light')",
    "setThemeMode('dark')",
    // Cloud rows → the existing Cloud Sync screen.
    "navigate('CloudSync')",
    // Privacy → the policy page the Play listing already points at.
    'WebBrowser.openBrowserAsync(SETTINGS_PRIVACY_URL)',
    // About → the live version from the app config.
    'Constants.expoConfig?.version',
  ];
  return destinations.every((needle) => text.indexOf(needle) >= 0);
}

/**
 * One row style everywhere: the spec's geometry, read out of the StyleSheet.
 *
 * v47.1 Part A — the FIT half of the geometry. The rows that hold text carry a
 * `minHeight` FLOOR plus vertical padding and NO fixed `height`, and the copy
 * block flexes with no hard `paddingRight`. `settingsRowGeometry` asserts that
 * shape; services/v471SettingsFit.ts asserts it as a class over every text row.
 */
export function settingsRowGeometry(settingsSource: string): boolean {
  const spec = SETTINGS_SPEC;
  const need = (style: string, prop: string, value: string): boolean =>
    settingsStyleValue(settingsSource, style, prop) === value;
  return [
    // ── the floors (no fixed heights on text rows) ──
    need('specRow', 'minHeight', String(spec.rowMinHeight)),
    need('specRow', 'paddingVertical', String(spec.rowPadY)),
    settingsStyleValue(settingsSource, 'specRow', 'height') === null,
    need('proRow', 'minHeight', String(spec.proMinHeight)),
    need('proRow', 'paddingVertical', String(spec.proPadY)),
    settingsStyleValue(settingsSource, 'proRow', 'height') === null,
    // ── the flexing copy block, and a MEASURED trailing value ──
    need('specRowCopy', 'flex', '1'),
    need('specRowCopy', 'minWidth', '0'),
    settingsStyleValue(settingsSource, 'specRowCopy', 'paddingRight') === null,
    need('specRowValue', 'marginLeft', String(spec.rowValueGap)),
    need('specRowValue', 'flexShrink', '1'),
    // ── the type and the surrounding chrome ──
    need('specRow', 'paddingLeft', String(spec.rowInset - spec.screenInset)),
    need('specRowTitle', 'fontSize', String(spec.rowTitleSize)),
    need('specRowSub', 'fontSize', String(spec.rowSubSize)),
    need('specRowValue', 'fontSize', String(spec.rowValueSize)),
    need('specHeader', 'fontSize', String(spec.headerSize)),
    need('specHeader', 'marginTop', String(spec.headerAbove)),
    need('specHeader', 'marginBottom', String(spec.headerBelow)),
    need('specGroup', 'borderRadius', String(spec.cardRadius)),
    need('specGroup', 'marginBottom', String(spec.cardGap)),
    need('proRow', 'borderRadius', String(spec.proRadius)),
    need('proTitle', 'fontSize', String(spec.proTitleSize)),
    need('proSub', 'fontSize', String(spec.proSubSize)),
    need('specFootnote', 'fontSize', String(spec.footnoteSize)),
  ].every(Boolean);
}

/**
 * The grouping is carried by the card bounds: FOUR cards (r16, CARD + CARD_LINE),
 * one per header — and the only thing separating their rows is the hairline.
 */
export function settingsGroupsAreCards(settingsSource: string): boolean {
  const text = maskSourceComments(settingsSource);
  const cards = (text.match(/\[styles\.specGroup, \{ backgroundColor: palette\.CARD, borderColor: palette\.CARD_LINE \}\]/g) ?? []).length;
  if (cards !== SETTINGS_GROUP_TITLES.length) return false;
  // A hairline LINE runs between rows inside a card…
  if (text.indexOf('backgroundColor: palette.LINE') < 0) return false;
  // …and the card is bounded by its own 1 dp CARD_LINE border, at r16.
  return (
    settingsStyleValue(settingsSource, 'specGroup', 'borderWidth') ===
      String(SETTINGS_SPEC.cardBorderWidth) &&
    settingsStyleValue(settingsSource, 'specGroup', 'borderRadius') ===
      String(SETTINGS_SPEC.cardRadius)
  );
}

/** Every style the §3 layout adds, by name — the set the colour rule covers. */
export const SETTINGS_SPEC_STYLES: readonly string[] = [
  'specGroup',
  'specHeader',
  'specDivider',
  'specRow',
  'specRowCopy',
  'specRowTitle',
  'specRowSub',
  'specRowValue',
  'proRow',
  'proTitle',
  'proSub',
  'proCta',
  'proCtaText',
  'specFootnote',
  'specThemePanel',
  'specPanelTitle',
];

/**
 * THE §3 LAYOUT CARRIES NO COLOUR OF ITS OWN. None of the spec's styles holds a
 * hex — every colour arrives from the palette (settingsPalette) at render time,
 * which is what makes the light theme a token swap and nothing else.
 */
export function settingsSpecHasNoHexColors(settingsSource: string): boolean {
  const text = settingsSource;
  const stylesAreClean = SETTINGS_SPEC_STYLES.every((name) => {
    const body = settingsStyleBody(text, name);
    if (body === null) return false;
    return !/#[0-9a-fA-F]{3,8}\b/.test(body);
  });
  if (!stylesAreClean) return false;
  // …and every role the render needs really is read from the palette.
  const masked = maskSourceComments(text);
  return SETTINGS_RENDERED_ROLES.every((role) => masked.indexOf(`palette.${role}`) >= 0);
}

/** The About row shows the LIVE version, never a hard-coded one. */
export function settingsVersionIsLive(settingsSource: string): boolean {
  const text = maskSourceComments(settingsSource);
  if (text.indexOf('Constants.expoConfig?.version') < 0) return false;
  if (text.indexOf('aboutVersionLine(') < 0) return false;
  // A literal "Version 0.1.x" in the screen is the stale frame number returning.
  return !/Version\s+0\.1\.\d+/.test(text);
}

/** The bottom line appears exactly once. */
export function settingsFootnoteIsOnce(settingsSource: string): boolean {
  const text = maskSourceComments(settingsSource);
  const marker = '{SETTINGS_NO_ACCOUNT_LINE}';
  const at = text.indexOf(marker);
  if (at < 0) return false;
  return text.indexOf(marker, at + marker.length) < 0;
}

/**
 * v45 SLICE 2 — the "Your practice" block really is ON this surface, BELOW the §3
 * groups, and both of its rows open screens this screen mounts itself:
 *
 *   • the header + its one subtitle line render (their own card, styles.retentionCard);
 *   • the three rows are the LAST three the surface renders (appended, never woven
 *     into a §3 group, so the four spec cards stay exactly four);
 *   • the chip labels come from `services/frontDoorBands` and the medals subtitle
 *     from `services/medals` — both imported, never retyped;
 *   • `handleOpenAchievements` / `handleOpenPracticeWeek` really arm their screens
 *     (a row that opens nothing is the dead end this block could have been).
 */
export function settingsHasRetentionSection(settingsSource: string): boolean {
  const text = maskSourceComments(settingsSource);
  if (text.indexOf(`>${SETTINGS_RETENTION_HEADER}</Text>`) < 0) return false;
  if (text.indexOf(SETTINGS_RETENTION_SUB) < 0) return false;
  if (text.indexOf('styles.retentionCard') < 0) return false;
  if (text.indexOf(`from '../services/frontDoorBands'`) < 0) return false;
  if (text.indexOf(`from '../services/medals'`) < 0) return false;
  // Appended: the header sits BELOW the last §3 group's header.
  const headerAt = text.indexOf(`>${SETTINGS_RETENTION_HEADER}</Text>`);
  const supportAt = text.indexOf('>Support</Text>');
  if (supportAt < 0 || headerAt < supportAt) return false;
  // …and its three rows are the tail of the rendered order.
  const mine = SETTINGS_RETENTION_ROWS.map(settingsRowKey);
  const rendered = specRowTitles(settingsSource);
  if (JSON.stringify(rendered.slice(-mine.length)) !== JSON.stringify(mine)) return false;
  // Both rows land on a screen this surface owns — the ROW really taps it…
  if (text.indexOf('onPress={handleOpenAchievements}') < 0) return false;
  if (text.indexOf('onPress={handleOpenPracticeWeek}') < 0) return false;
  // …through handlers that actually arm those screens.
  const opens = (name: string, setter: string): boolean => {
    const declaration = text.indexOf(`const ${name}`);
    if (declaration < 0) return false;
    return new RegExp(`${setter}\\(\\s*true\\s*\\)`).test(
      text.slice(declaration, declaration + 300),
    );
  };
  return (
    opens('handleOpenAchievements', 'setShowAchievements') &&
    opens('handleOpenPracticeWeek', 'setShowPracticeWeek')
  );
}

/** Everything the §3 surface must satisfy, in one call. */
export function settingsSurfaceContracts(settingsSource: string): boolean {
  return (
    settingsHasGroupsInOrder(settingsSource) &&
    settingsHeadersPrecedeTheirRows(settingsSource) &&
    settingsHasNoAccountSection(settingsSource) &&
    settingsProRowIsWired(settingsSource) &&
    settingsRowsAreTheClosedSet(settingsSource) &&
    settingsHasNoDeadRows(settingsSource) &&
    settingsRowsReachRealDestinations(settingsSource) &&
    settingsRowGeometry(settingsSource) &&
    settingsGroupsAreCards(settingsSource) &&
    settingsHasRetentionSection(settingsSource) &&
    settingsSpecHasNoHexColors(settingsSource) &&
    settingsVersionIsLive(settingsSource) &&
    settingsFootnoteIsOnce(settingsSource)
  );
}

/** The `}` that closes the `{` at `open` (quotes skipped) — nested styles included. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    const ch = text.charAt(at);
    if (ch === '"' || ch === "'" || ch === '`') {
      const mark = ch;
      at += 1;
      while (at < text.length && text.charAt(at) !== mark) {
        if (text.charAt(at) === '\\') at += 1;
        at += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

/** The body text of one named style (null when the style is absent). */
export function settingsStyleBody(settingsSource: string, styleName: string): string | null {
  const text = maskSourceComments(settingsSource);
  const key = `${styleName}: {`;
  const at = text.indexOf(key);
  if (at < 0) return null;
  const open = text.indexOf('{', at);
  const close = matchingBrace(text, open);
  if (close < 0) return null;
  return text.slice(open, close);
}

/** One property of one named style, as source text (null when absent). */
export function settingsStyleValue(
  settingsSource: string,
  styleName: string,
  prop: string
): string | null {
  const body = settingsStyleBody(settingsSource, styleName);
  if (body === null) return null;
  const match = new RegExp(
    `(?:^|[\\s,{])${prop}\\s*:\\s*(?:'([^']*)'|"([^"]*)"|([-0-9.]+))`
  ).exec(body);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}
