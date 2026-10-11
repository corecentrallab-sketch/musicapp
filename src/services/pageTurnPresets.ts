/**
 * pageTurnPresets.ts — the page-turner SPEED PROFILES (owner 10-10, backlog
 * 7f64272f).
 *
 * The owner's words: "the page turner speed should be modifiable/customised
 * easier as someone new to the piece will be slower to turn pages whereas
 * someone that has practised many times the same piece will turn pages much
 * faster." The viewer already had a BPM stepper and a beats-per-page stepper
 * (see hooks/useAutoScroll.ts) — what was missing was a ONE-TAP way to move
 * between skill levels, and a memory per piece.
 *
 * A profile is a PAIR, not a tempo: `{ bpm, beatsPerPage }`. Both numbers feed
 * the existing turn model
 *
 *     secondsPerPage = (60 / bpm) * beatsPerPage
 *
 * so one tap changes the whole turn rate, not just the BPM:
 *
 *     Beginner      40 BPM × 8 beats/page = 12.0 s/page   (first read-throughs)
 *     Intermediate  60 BPM × 4 beats/page =  4.0 s/page   (the app's old default)
 *     Fast         120 BPM × 2 beats/page =  1.0 s/page   (known the piece for a while)
 *
 * Intermediate is deliberately the values the steppers already defaulted to, so
 * a user who never touches the presets sees exactly the behaviour they had.
 *
 * PURE LOGIC: no react, no react-native, no storage, no network — so it compiles
 * and runs under plain Node (see scripts/pageTurnSpeed.test.ts). The device-side
 * persistence lives in ./pageTurnSpeedStore.ts and the React binding in
 * ./hooks/usePageTurnSpeed.ts; this module owns the DECISIONS (what a preset is,
 * what is still a preset after a fine-tune, what a stored map may contain).
 */

export type PageTurnPresetId = 'beginner' | 'intermediate' | 'fast';

/** A turn rate: the two numbers the auto-scroll engine runs on. */
export interface PageTurnSpeedProfile {
  bpm: number;
  beatsPerPage: number;
}

export interface PageTurnPreset extends PageTurnSpeedProfile {
  id: PageTurnPresetId;
  label: string;
  /** Short skill-level cue, e.g. "First read-throughs". */
  cue: string;
  /** One honest sentence for the chip's accessibility label. */
  blurb: string;
}

/**
 * The bounds the steppers enforce (hooks/useAutoScroll.ts). Mirrored here so the
 * PURE module can validate a stored profile without importing a React hook;
 * scripts/pageTurnSpeed.test.ts reads the hook's own source and asserts the two
 * sets of numbers still agree, so a drift is a red test rather than a stale
 * clamp.
 */
export const PAGE_TURN_BPM_MIN = 30;
export const PAGE_TURN_BPM_MAX = 200;
export const PAGE_TURN_BEATS_PER_PAGE_MIN = 1;
export const PAGE_TURN_BEATS_PER_PAGE_MAX = 16;

/** What a piece with no saved profile gets — the pre-existing defaults. */
export const DEFAULT_PAGE_TURN_PROFILE: PageTurnSpeedProfile = {
  bpm: 60,
  beatsPerPage: 4,
};

export const PAGE_TURN_PRESETS: readonly PageTurnPreset[] = [
  {
    id: 'beginner',
    label: 'Beginner',
    cue: 'First read-throughs',
    blurb: 'Beginner — slower pages for a piece you are just starting.',
    bpm: 40,
    beatsPerPage: 8,
  },
  {
    id: 'intermediate',
    label: 'Intermediate',
    cue: 'Getting the notes',
    blurb: 'Intermediate — the default pace while a piece is still settling.',
    bpm: 60,
    beatsPerPage: 4,
  },
  {
    id: 'fast',
    label: 'Fast',
    cue: 'Known for a while',
    blurb: 'Fast — quicker pages for a piece you have practised many times.',
    bpm: 120,
    beatsPerPage: 2,
  },
];

/** AsyncStorage key for the per-piece speed memory (one JSON object). */
export const PAGE_TURN_SPEED_KEY = 'notesnap:pageturner:speed:v1';

/** The preset with this id, or null when the id is unknown (never a guess). */
export function pageTurnPreset(id: string | null | undefined): PageTurnPreset | null {
  if (typeof id !== 'string' || id.length === 0) return null;
  for (const preset of PAGE_TURN_PRESETS) {
    if (preset.id === id) return preset;
  }
  return null;
}

/** Clamp one number into the inclusive stepper bounds (NaN → the default). */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * A profile the engine can actually run: both numbers rounded and clamped into
 * the stepper bounds, with the default used for anything unusable. This is the
 * ONLY gate a stored profile passes through, so a corrupt/hand-edited map key
 * can never put the engine outside its own range.
 */
export function clampPageTurnProfile(
  profile: Partial<PageTurnSpeedProfile> | null | undefined,
): PageTurnSpeedProfile {
  return {
    bpm: clampNumber(
      profile?.bpm,
      PAGE_TURN_BPM_MIN,
      PAGE_TURN_BPM_MAX,
      DEFAULT_PAGE_TURN_PROFILE.bpm,
    ),
    beatsPerPage: clampNumber(
      profile?.beatsPerPage,
      PAGE_TURN_BEATS_PER_PAGE_MIN,
      PAGE_TURN_BEATS_PER_PAGE_MAX,
      DEFAULT_PAGE_TURN_PROFILE.beatsPerPage,
    ),
  };
}

/** True when both numbers are inside the bounds (no rounding needed). */
export function isPageTurnProfileInRange(profile: PageTurnSpeedProfile): boolean {
  return (
    Number.isInteger(profile?.bpm) &&
    profile.bpm >= PAGE_TURN_BPM_MIN &&
    profile.bpm <= PAGE_TURN_BPM_MAX &&
    Number.isInteger(profile?.beatsPerPage) &&
    profile.beatsPerPage >= PAGE_TURN_BEATS_PER_PAGE_MIN &&
    profile.beatsPerPage <= PAGE_TURN_BEATS_PER_PAGE_MAX
  );
}

/**
 * Seconds per page from a profile — the SAME formula hooks/useAutoScroll.ts
 * runs, so the number on the chip is the number the page turner will use.
 */
export function pageTurnSecondsPerPage(profile: PageTurnSpeedProfile): number {
  const safe = clampPageTurnProfile(profile);
  return (60 / safe.bpm) * safe.beatsPerPage;
}

/** "12.0 s/page" / "4 s/page" — the viewer's existing formatting. */
export function formatSecondsPerPage(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '— s/page';
  const rounded = Math.round(seconds * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} s/page` : `${rounded.toFixed(1)} s/page`;
}

/**
 * Which preset the CURRENT numbers are, or null when they are a fine-tuned
 * custom rate. Derived, never stored: the moment a stepper moves the numbers off
 * a preset, no chip is highlighted — which is exactly the truth.
 */
export function activePageTurnPresetId(
  profile: PageTurnSpeedProfile | null | undefined,
): PageTurnPresetId | null {
  if (!profile) return null;
  for (const preset of PAGE_TURN_PRESETS) {
    if (preset.bpm === profile.bpm && preset.beatsPerPage === profile.beatsPerPage) {
      return preset.id;
    }
  }
  return null;
}

/** A chip's own one-line label: "Beginner · 12 s/page". */
export function pageTurnPresetChipLabel(preset: PageTurnPreset): string {
  return `${preset.label} · ${formatSecondsPerPage(pageTurnSecondsPerPage(preset))}`;
}

/** The full-resolution status line for the current numbers. */
export function describePageTurnSpeed(profile: PageTurnSpeedProfile): string {
  const safe = clampPageTurnProfile(profile);
  const presetId = activePageTurnPresetId(safe);
  const preset = pageTurnPreset(presetId);
  const rate = formatSecondsPerPage(pageTurnSecondsPerPage(safe));
  const base = `${safe.bpm} BPM · ${safe.beatsPerPage} beats/page · ${rate}`;
  return preset ? `${base} (${preset.label})` : `${base} (custom)`;
}

// ─────────────────────── the stored map (per piece) ───────────────────────

/** piece id → the speed profile last used on it. */
export type PageTurnSpeedMap = Record<string, PageTurnSpeedProfile>;

/**
 * Decode the stored JSON into a clean map. Anything unusable (bad JSON, not an
 * object, an entry without numbers, an out-of-range value that clamping would
 * silently change) is DROPPED rather than guessed at — the caller then falls
 * back to the defaults, which is honest: an unknown piece opens at the default
 * speed, never at some other piece's speed.
 */
export function decodePageTurnSpeedMap(raw: string | null | undefined): PageTurnSpeedMap {
  const map: PageTurnSpeedMap = {};
  if (typeof raw !== 'string' || raw.length === 0) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return map;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return map;
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    if (key.length === 0) continue;
    const entry = (parsed as Record<string, unknown>)[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const candidate = entry as Partial<PageTurnSpeedProfile>;
    if (typeof candidate.bpm !== 'number' || typeof candidate.beatsPerPage !== 'number') continue;
    const profile = clampPageTurnProfile(candidate);
    if (!isPageTurnProfileInRange(profile)) continue;
    map[key] = profile;
  }
  return map;
}

/** Encode a map for storage. Keys with no usable profile are left out. */
export function encodePageTurnSpeedMap(map: PageTurnSpeedMap | null | undefined): string {
  const clean: PageTurnSpeedMap = {};
  if (map && typeof map === 'object') {
    for (const key of Object.keys(map)) {
      if (key.length === 0) continue;
      const profile = clampPageTurnProfile(map[key]);
      if (!isPageTurnProfileInRange(profile)) continue;
      clean[key] = profile;
    }
  }
  return JSON.stringify(clean);
}

/** The profile stored for one piece, or null when the piece has none yet. */
export function pageTurnSpeedForPiece(
  map: PageTurnSpeedMap | null | undefined,
  pieceId: string | null | undefined,
): PageTurnSpeedProfile | null {
  if (!map || typeof pieceId !== 'string' || pieceId.length === 0) return null;
  const stored = map[pieceId];
  return stored ? clampPageTurnProfile(stored) : null;
}

/**
 * The map with one piece's speed set. Returns a NEW map (never mutates the one
 * handed in) so a caller can write the result straight back to storage.
 */
export function withPageTurnSpeedForPiece(
  map: PageTurnSpeedMap | null | undefined,
  pieceId: string,
  profile: PageTurnSpeedProfile,
): PageTurnSpeedMap {
  const next: PageTurnSpeedMap = { ...decodePageTurnSpeedMap(encodePageTurnSpeedMap(map)) };
  if (typeof pieceId !== 'string' || pieceId.length === 0) return next;
  const clean = clampPageTurnProfile(profile);
  // `clean` has been clamped, so what is stored is always a value the steppers
  // and the engine can show; nothing a user typed is remembered as another number.
  if (!isPageTurnProfileInRange(clean)) return next;
  next[pieceId] = clean;
  return next;
}

// ─────────────────────────── user-facing copy ───────────────────────────

/** Label above the preset row. */
export const PAGE_TURN_PRESETS_LABEL = 'Turn speed';
/** The one-line explanation under the preset row. */
export const PAGE_TURN_PRESETS_HINT =
  'One tap sets a whole turn speed — the steppers still fine-tune it.';
/** Shown once a profile has been chosen on this piece. */
export const PAGE_TURN_REMEMBERED_LINE = 'Saved for this piece.';
