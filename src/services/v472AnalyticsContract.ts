/**
 * v472AnalyticsContract.ts — THE HOSTING GUARDS FOR THE EVENT LOG (v47.2).
 *
 * THE v46 LESSON, APPLIED TO TELEMETRY: a module that exports `track` and is
 * never called from the surface that renders the thing being measured passes
 * every "wiring" guard and produces a table of zeroes. So these guards do not
 * ask "does analytics.ts export track" — they ask, per event, "does the FILE
 * THAT RENDERS THIS SURFACE call it, is that file itself mounted by something
 * else, and is the call next to the real work it is supposed to describe?"
 *
 * They are pure functions over `{ path, text }` records, so the same code can be
 * run against the real tree (in the test) and against a deliberately broken copy
 * (the mutation probe) — a guard that cannot fail is not evidence.
 *
 * No react-native, no fs, no network: the test reads the files and passes them in.
 */
import {
  ANALYTICS_DENIED_PROP_TOKENS,
  ANALYTICS_ENDPOINT_PATH,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_PROP_KEYS,
  findDeniedAnalyticsKey,
  normalizeAnalyticsKey,
} from './analytics';
import { AFFILIATE_CTA_SURFACES } from './affiliateCtaEvents';

/** One file as the guards see it. */
export interface SourceFile {
  path: string;
  text: string;
}

/** The comment-masked text (a mention in a comment is not a call site). */
export function maskComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead: string) => lead + ' '.repeat(match.length - lead.length));
}

/**
 * ONE EVENT → THE SURFACE THAT MUST CALL IT.
 *
 * `file` is the module that renders the surface, `call` is the literal that must
 * appear in its CODE (not its comments), `evidence` are the literals that prove
 * the call sits on the real path (the recognition request, the checkout, the
 * write) and `host` is the module that must mount the surface — the difference
 * between "this screen tracks it" and "this screen is reachable".
 */
export interface EventCallSite {
  event: string;
  file: string;
  call: string;
  evidence: string[];
  host: string;
  /** What must appear in the host module (defaults to this file's module name). */
  hostLiteral?: string;
  /** The prop keys this call site is expected to carry (each must appear). */
  props: string[];
}

export const EVENT_CALL_SITES: readonly EventCallSite[] = [
  {
    event: 'app_open',
    file: 'App.tsx',
    call: "track('app_open')",
    evidence: ['initAnalytics('],
    host: 'App.tsx',
    hostLiteral: 'export default function App',
    props: [],
  },
  {
    event: 'recognition_start',
    file: 'src/screens/HomeScreen.tsx',
    call: "track('recognition_start'",
    evidence: ['recognizeAudio(', 'humToSearch(', "source: 'audio'", "source: 'hum'"],
    host: 'src/navigation/TabNavigator.tsx',
    props: [],
  },
  {
    event: 'recognition_result',
    file: 'src/screens/HomeScreen.tsx',
    call: "track('recognition_result'",
    evidence: ['recognizeAudio(', 'success: true', 'success: false', 'piece_id:'],
    host: 'src/navigation/TabNavigator.tsx',
    props: ['source', 'success', 'piece_id'],
  },
  {
    event: 'recognition_start',
    file: 'src/screens/HumSearchScreen.tsx',
    call: "track('recognition_start'",
    evidence: ['humToSearch(', "source: 'hum'"],
    host: 'src/screens/HomeScreen.tsx',
    props: [],
  },
  {
    event: 'recognition_result',
    file: 'src/screens/HumSearchScreen.tsx',
    call: "track('recognition_result'",
    evidence: ['humToSearch(', 'success: true', 'success: false', 'piece_id:'],
    host: 'src/screens/HomeScreen.tsx',
    props: ['source', 'success', 'piece_id'],
  },
  {
    event: 'recognition_start',
    file: 'src/screens/ModernSearchScreen.tsx',
    call: "track('recognition_start'",
    evidence: ['recognizeModernSong(', "source: 'modern'"],
    host: 'src/screens/HomeScreen.tsx',
    props: [],
  },
  {
    event: 'recognition_result',
    file: 'src/screens/ModernSearchScreen.tsx',
    call: "track('recognition_result'",
    evidence: ['recognizeModernSong(', 'success:', 'piece_id:'],
    host: 'src/screens/HomeScreen.tsx',
    props: ['source', 'success', 'piece_id'],
  },
  {
    event: 'recognition_start',
    file: 'src/screens/ScanScoreScreen.tsx',
    call: "track('recognition_start'",
    evidence: ['handleClassified', "source: 'scan'"],
    host: 'App.tsx',
    props: [],
  },
  {
    event: 'recognition_result',
    file: 'src/screens/ScanScoreScreen.tsx',
    call: "track('recognition_result'",
    evidence: ['handleClassified', 'autoSearch.fire', "source: 'scan'"],
    host: 'App.tsx',
    props: ['source', 'success'],
  },
  {
    event: 'result_open',
    file: 'src/screens/PieceDetailScreen.tsx',
    call: "track('result_open'",
    evidence: ['piece_id: piece.id', 'hosted: Boolean(piece.sheetMusicUrl)'],
    host: 'src/screens/HistoryScreen.tsx',
    props: ['piece_id', 'hosted'],
  },
  {
    event: 'save_piece',
    file: 'src/components/SaveToLibraryButton.tsx',
    call: "track('save_piece'",
    evidence: ['savePieceScoreToLibrary(', 'piece_id: pieceId'],
    host: 'src/screens/PieceDetailScreen.tsx',
    props: ['piece_id'],
  },
  {
    event: 'plans_view',
    file: 'src/screens/SettingsScreen.tsx',
    call: "track('plans_view'",
    evidence: ['plansOpen', 'checking', 'hosted: proState.isPro'],
    host: 'src/navigation/TabNavigator.tsx',
    props: ['hosted'],
  },
  {
    event: 'upgrade_tap',
    file: 'src/screens/SettingsScreen.tsx',
    call: "track('upgrade_tap'",
    evidence: ['createCheckoutSession(', 'opened: true', 'opened: false', 'LIVE_PRICES', 'tier,'],
    host: 'src/navigation/TabNavigator.tsx',
    props: ['opened'],
  },
  {
    event: 'pro_feature_use',
    file: 'src/screens/CloudSyncScreen.tsx',
    call: "track('pro_feature_use'",
    evidence: [
      'syncCloud(',
      'importFilesIntoLibrary(',
      "feature: 'cloud_sync'",
      "feature: 'pdf_import'",
    ],
    host: 'App.tsx',
    props: ['feature', 'ok'],
  },
  {
    event: 'pro_feature_use',
    file: 'src/screens/HumSearchScreen.tsx',
    call: "track('pro_feature_use'",
    evidence: ['exportCaptureMidiFrom', "feature: 'midi_export'"],
    host: 'src/screens/HomeScreen.tsx',
    props: ['feature', 'ok'],
  },
  {
    event: 'pro_feature_use',
    file: 'src/screens/NotationEditorScreen.tsx',
    call: "track('pro_feature_use'",
    evidence: ['clampSemitones(', "feature: 'transposition'"],
    host: 'App.tsx',
    props: ['feature', 'ok'],
  },
];

/** The events the app genuinely has no surface for, with the reason (honest gaps). */
export const UNUSED_EVENTS: readonly { event: string; reason: string }[] = [
  {
    event: 'wishlist_add',
    reason:
      'no wishlist exists in the app (a repo-wide search finds no wishlist store, screen or control), so no call site is invented — the event stays unused until the v48 wishlist ships',
  },
];

function byPath(files: readonly SourceFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) map.set(file.path, maskComments(file.text));
  return map;
}

/**
 * EVERY EVENT WITH A SURFACE MUST HAVE A CALL SITE THERE — in code, on the real
 * path, in a module that something else mounts. Returns one sentence per
 * violation; an empty array is the only passing answer.
 */
export function hostingViolations(files: readonly SourceFile[]): string[] {
  const map = byPath(files);
  const violations: string[] = [];
  for (const site of EVENT_CALL_SITES) {
    const text = map.get(site.file);
    if (text === undefined) {
      violations.push(`${site.event}: ${site.file} is missing from the tree`);
      continue;
    }
    if (!text.includes(site.call)) {
      violations.push(`${site.event}: ${site.file} does not call ${site.call}`);
      continue;
    }
    for (const literal of site.evidence) {
      if (!text.includes(literal)) {
        violations.push(
          `${site.event}: ${site.file} calls track but is not on the real path (no ${literal})`,
        );
      }
    }
    for (const prop of site.props) {
      if (!text.includes(`${prop}:`)) {
        violations.push(`${site.event}: ${site.file} never passes the ${prop} prop`);
      }
    }
    // THE HOSTING HALF: the surface must be mounted by something else.
    const host = map.get(site.host);
    if (host === undefined) {
      violations.push(`${site.event}: host ${site.host} is missing from the tree`);
    } else if (!host.includes(site.hostLiteral ?? moduleName(site.file))) {
      violations.push(
        `${site.event}: ${site.file} is never mounted by ${site.host} — the call site is unreachable`,
      );
    }
  }
  return violations;
}

/** `src/screens/HomeScreen.tsx` → `HomeScreen` (what an import line names). */
export function moduleName(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.tsx?$/, '');
}

/**
 * THE ENDPOINT'S ONE HOME. Returns every file whose CODE mentions the events
 * path; the only passing answer is exactly ['src/services/analytics.ts'].
 */
export function endpointPathFiles(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => maskComments(file.text).includes(ANALYTICS_ENDPOINT_PATH))
    .map((file) => file.path)
    .sort();
}

/**
 * THE PURCHASE EVENT IS SERVER-SIDE TRUTH. The app must not mention it at all —
 * not in code, not in a string, not in a comment — so no later change can quietly
 * start sending it from the client.
 */
export function purchaseEventName(): string {
  return 'purchase' + '_complete';
}

/** Every file whose TEXT (comments included) mentions the purchase event. */
export function purchaseEventMentions(files: readonly SourceFile[]): string[] {
  const needle = purchaseEventName();
  return files.filter((file) => file.text.includes(needle)).map((file) => file.path).sort();
}

/** True when no prop key in the vocabulary trips the server's denied-token list. */
export function propVocabularyIsClean(): boolean {
  return findDeniedAnalyticsKey(ANALYTICS_PROP_KEYS) === null;
}

/** The denied tokens, for the guard's own assertions. */
export function deniedTokens(): readonly string[] {
  return ANALYTICS_DENIED_PROP_TOKENS;
}

/** True when the vocabulary contains no key the server would refuse. */
export function vocabularyAvoids(tokens: readonly string[]): boolean {
  for (const key of ANALYTICS_PROP_KEYS) {
    const normalized = normalizeAnalyticsKey(key);
    for (const token of tokens) {
      if (normalized.includes(token)) return false;
    }
  }
  return true;
}

/**
 * THE SETTINGS LINE. Settings → About must say, in plain words, that anonymous
 * usage counts are collected and that no personal data and no audio are. It must
 * also NOT promise an opt-out the app does not implement.
 */
export const ABOUT_USAGE_LINE_MARKER = 'Anonymous usage counts';

export function aboutUsageLineViolations(aboutBody: string, settingsSource: string): string[] {
  const violations: string[] = [];
  if (!aboutBody.includes(ABOUT_USAGE_LINE_MARKER)) {
    violations.push('Settings → About does not state that anonymous usage counts are collected');
  }
  if (!/no personal data/i.test(aboutBody)) {
    violations.push('Settings → About does not say that no personal data is collected');
  }
  if (!/no audio/i.test(aboutBody)) {
    violations.push('Settings → About does not say that no audio is collected');
  }
  // An opt-out the app cannot honour would be a false statement in the About box.
  if (/opt[- ]?out|turn (it|this|tracking|usage) off|disable (tracking|analytics)/i.test(aboutBody)) {
    violations.push('Settings → About promises an opt-out the app does not implement');
  }
  if (!settingsSource.includes('aboutDialogBody')) {
    violations.push('SettingsScreen no longer renders aboutDialogBody — the line is not on screen');
  }
  return violations;
}

/** The allowlist must be exactly the server's eleven, in the same order. */
export function allowlistViolations(serverNames: readonly string[]): string[] {
  const violations: string[] = [];
  if (ANALYTICS_EVENT_NAMES.length !== serverNames.length) {
    violations.push(
      `allowlist has ${ANALYTICS_EVENT_NAMES.length} names, the server accepts ${serverNames.length}`,
    );
  }
  for (let i = 0; i < serverNames.length; i++) {
    if (ANALYTICS_EVENT_NAMES[i] !== serverNames[i]) {
      violations.push(
        `allowlist position ${i} is ${String(ANALYTICS_EVENT_NAMES[i])}, the server expects ${serverNames[i]}`,
      );
    }
  }
  return violations;
}

// ─── THE AFFILIATE CTR PAIR: shown, and tapped ─────────────────────────────
//
// WHY THESE GUARDS EXIST. Affiliate CTR (>8%) is a Tier-2 KPI and Sheet Music
// Direct (ID 67650) is the PRIMARY retailer, so "was the CTA shown, and was it
// tapped" is a number the business is asked to report. The failure mode is the
// v46 one exactly: a module that can emit the event, and a surface that never
// calls it, produces a table of zeroes that reads like "nobody taps the
// affiliate CTA" rather than "nothing was instrumented". So, per SURFACE: the
// file that renders the CTA must call the funnel for BOTH moments, in code (not
// in a comment), beside the real work (the URL hand-off), and be mounted by
// something else. And because three doors render the same card, the door
// literals are pinned too — otherwise every affiliate view on Home would be
// reported as a plain search.

/** One surface's call sites, evidence and host. */
export interface AffiliateCtaCallSite {
  surface: string;
  file: string;
  /** The literals that must appear in the file's CODE (both moments). */
  calls: string[];
  /** Proof the call sits on the real money path, not beside a dead button. */
  evidence: string[];
  /** The module that mounts this surface. */
  host: string;
  hostLiteral?: string;
}

export const AFFILIATE_CTA_CALL_SITES: readonly AffiliateCtaCallSite[] = [
  {
    surface: 'recognition_result',
    file: 'src/components/RecognitionResultView.tsx',
    calls: [
      "trackAffiliateCta('recognition_result', 'viewed')",
      "trackAffiliateCta('recognition_result', 'clicked')",
    ],
    evidence: ['recognitionPurchaseUrl(', 'setPurchaseWebUrl(purchaseUrl)', 'AFFILIATE_DISCLOSURE'],
    host: 'src/screens/HomeScreen.tsx',
    hostLiteral: '<RecognitionResultView',
  },
  {
    surface: 'search_external',
    file: 'src/components/SearchExternalSection.tsx',
    calls: ["trackAffiliateCta(surface, 'viewed')", "trackAffiliateCta(surface, 'clicked')"],
    evidence: ['onOpen(smdUrl)', 'AFFILIATE_DISCLOSURE'],
    host: 'src/screens/FindPieceScreen.tsx',
    hostLiteral: '<SearchExternalSection',
  },
  {
    surface: 'find_piece',
    file: 'src/screens/FindPieceScreen.tsx',
    calls: [
      "trackAffiliateCta('find_piece', 'viewed')",
      "trackAffiliateCta('find_piece', 'clicked')",
    ],
    evidence: ['noMatch.retailerUrl', 'handleOpenRetailer(', 'AFFILIATE_DISCLOSURE'],
    host: 'src/screens/HomeScreen.tsx',
    hostLiteral: '<FindPieceScreen',
  },
];

/**
 * THE DOORS. The retailer card in SearchExternalSection is one component reached
 * three ways, so the surface name is the caller's: these literals are what make
 * `home_front_door` and `cover_scan` real rather than declared.
 */
export const AFFILIATE_CTA_DOORS: readonly { surface: string; file: string; literal: string }[] = [
  {
    surface: 'search_external',
    file: 'src/screens/FindPieceScreen.tsx',
    literal: "entrySurface = 'search_external'",
  },
  {
    surface: 'home_front_door',
    file: 'src/screens/HomeScreen.tsx',
    literal: 'entrySurface="home_front_door"',
  },
  {
    surface: 'cover_scan',
    file: 'src/screens/ScanScoreScreen.tsx',
    literal: 'entrySurface="cover_scan"',
  },
  {
    surface: 'cover_scan',
    file: 'src/screens/ScannedViewerScreen.tsx',
    literal: 'entrySurface="cover_scan"',
  },
];

/**
 * EVERY SURFACE THAT SHOWS AN SMD CTA MUST RECORD BOTH MOMENTS. Returns one
 * sentence per violation; an empty array is the only passing answer.
 */
export function affiliateCtaViolations(files: readonly SourceFile[]): string[] {
  const map = byPath(files);
  const violations: string[] = [];

  for (const site of AFFILIATE_CTA_CALL_SITES) {
    const text = map.get(site.file);
    if (text === undefined) {
      violations.push(`${site.surface}: ${site.file} is missing from the tree`);
      continue;
    }
    for (const call of site.calls) {
      if (!text.includes(call)) {
        violations.push(`${site.surface}: ${site.file} does not call ${call}`);
      }
    }
    for (const literal of site.evidence) {
      if (!text.includes(literal)) {
        violations.push(
          `${site.surface}: ${site.file} records the event but is not on the real money path (no ${literal})`,
        );
      }
    }
    const host = map.get(site.host);
    if (host === undefined) {
      violations.push(`${site.surface}: host ${site.host} is missing from the tree`);
    } else if (!host.includes(site.hostLiteral ?? moduleName(site.file))) {
      violations.push(
        `${site.surface}: ${site.file} is never mounted by ${site.host} — the call site is unreachable`,
      );
    }
  }

  for (const door of AFFILIATE_CTA_DOORS) {
    const text = map.get(door.file);
    if (text === undefined) {
      violations.push(`${door.surface}: door file ${door.file} is missing from the tree`);
      continue;
    }
    if (!text.includes(door.literal)) {
      violations.push(`${door.surface}: ${door.file} does not pass ${door.literal}`);
    }
  }

  // A surface on the list with no call site and no door is a name nobody sends.
  for (const surface of AFFILIATE_CTA_SURFACES) {
    const hosted = AFFILIATE_CTA_CALL_SITES.some((site) => site.surface === surface);
    const doored = AFFILIATE_CTA_DOORS.some((door) => door.surface === surface);
    if (!hosted && !doored) {
      violations.push(`${surface}: declared as a surface but nothing records or passes it`);
    }
    if (surface === 'search_external' && !hosted) {
      violations.push(`${surface}: the section's own call sites are missing`);
    }
  }
  return violations;
}

/**
 * THE OTHER DIRECTION: an id used at a call site but not on the enumerated list
 * would arrive at the database as a surface nobody can group by. Only LITERALS
 * are read (`trackAffiliateCta('find_piece', …)`); the parameterised form
 * `trackAffiliateCta(surface, …)` is checked by the door assertions above.
 */
export function affiliateSurfaceIdViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  const literal = /trackAffiliateCta\('([^']+)'/g;
  for (const file of files) {
    const text = maskComments(file.text);
    let match = literal.exec(text);
    while (match !== null) {
      const id = match[1];
      if (!(AFFILIATE_CTA_SURFACES as readonly string[]).includes(id)) {
        violations.push(`${file.path} records an unknown affiliate surface "${id}"`);
      }
      match = literal.exec(text);
    }
    literal.lastIndex = 0;
  }
  return violations;
}

