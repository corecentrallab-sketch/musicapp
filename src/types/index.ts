/**
 * Core type definitions for NoteSnap.
 */

/** Represents a recognized piece of music saved to History. */
export interface SavedPiece {
  id: string;
  title: string;
  composer: string;
  /** ISO date string when the piece was recognized/saved. */
  savedAt: string;
  /** Optional genre tag (e.g., "Classical", "Baroque", "Romantic"). */
  genre?: string;
  /** Optional difficulty rating 1-10. */
  difficulty?: number;
}

// ─── API types ─────────────────────────────────────────────────

/**
 * Purchase link URLs for a matched piece, keyed by retailer.
 *
 * The backend emits the OWNER-APPROVED retailers only, in priority order:
 * `sheetmusicdirect` (Sheet Music Direct, affiliate ID 67650 — PRIMARY, the
 * money path) and `musicnotes` (the BACKUP). Sheet Music Plus was dropped and JW
 * Pepper is not approved, so neither may appear here.
 *
 * A CTA must resolve through `primaryPurchaseUrl()` (src/services/purchaseCta.ts)
 * rather than naming a key — the app used to read `.musicnotes` by name, which
 * sent every in-app purchase to the backup retailer no matter what the backend
 * emitted. Both keys are optional because the backend omits one when it cannot
 * build it (the primary builder returns nothing for an empty query).
 *
 * A type alias (not an interface) on purpose: it carries an implicit index
 * signature, so the map can be passed straight to `primaryPurchaseUrl()`.
 */
export type PurchaseUrls = {
  sheetmusicdirect?: string;
  musicnotes?: string;
};

/** A single match result from the recognition API. */
export interface RecognitionMatch {
  piece_id: string;
  title: string;
  composer: string;
  catalog: string | null;
  confidence: number;
  album_art_url: string | null;
  sheet_music_url: string | null;
  tab_url: string | null;
  matched_at_s: number;
  /** True for public-domain pieces — these never get a purchase redirect. */
  is_public_domain: boolean;
  /** True only when a quality-gated score is served (PD pieces). */
  sheet_music_available: boolean;
  /** Null for public-domain pieces (we already serve the score). */
  purchase_url: PurchaseUrls | null;
}

/** Successful response from POST /api/recognize. */
export interface RecognitionResponse {
  success: true;
  matches: RecognitionMatch[];
  query_duration_ms: number;
  db_available: boolean;
  /** Fallback purchase link when no matches found. */
  purchase_url?: PurchaseUrls;
  /**
   * Present when the server declined to name a piece (evidence existed but was
   * ambiguous or too weak to present confidently). Empty matches + this reason
   * = honest "no confident match", never a wrong title.
   */
  no_confident_match_reason?: string;
  /**
   * Diagnostic echo from the server describing the audio it actually received
   * and decoded. Lets us compare what the phone uploaded vs what the server got
   * (byte size, decoded duration, decoded sample rate) to localise capture-path
   * defects. Absent on older/error responses.
   */
  received_audio?: {
    bytes: number;
    duration_s: number;
    sample_rate: number;
    format: string | null;
  };
}

/** Error response from POST /api/recognize. */
export interface RecognitionError {
  success: false;
  error: string;
}

export type RecognitionResult = RecognitionResponse | RecognitionError;

// ─── Tier-1: Hum/whistle/sing-to-search (POST /api/hum) ───────

/** A single matched piece from the hum/whistle/sing-to-search API. The backend
 *  gates on "no confident-wrong": an empty matches array is an honest no-match,
 *  never a fabricated title. */
export interface HumMatch {
  piece_id: string;
  title: string;
  composer: string;
  /** 0-1 rounded confidence. */
  confidence: number;
}

/** Diagnostic contour stats echoed by POST /api/hum (how much melody was heard). */
export interface HumContourStats {
  notes: number;
  deltas: number;
  voiced_frames: number;
  total_frames: number;
  extracted_pitches?: number[];
  extracted_deltas?: number[];
}

/** Successful response from POST /api/hum. */
export interface HumResponse {
  success: true;
  matches: HumMatch[];
  query_duration_ms: number;
  db_available: boolean;
  contour_stats?: HumContourStats;
  /** Present when the server declined to name a piece (too weak/short) — the
   *  honest "hum a longer/clearer phrase" reason. */
  no_confident_match_reason?: string;
  /** On a NO-MATCH ONLY: the single best pre-gate similarity (0..1) against
   *  any skeleton, so the UI can band its feedback ("we were close" vs "we're
   *  not sure") WITHOUT a raw percentage. A bare score, never a title — the
   *  server never names a candidate it wouldn't confidently match. Absent on
   *  a successful match. */
  closestMatchConfidence?: number;
}

// ─── Tier-1: Modern-song recognition (POST /api/recognize-modern) ──

/** A recognized copyrighted song, with a retailer purchase URL for the
 *  official sheet music. We never host/provide a copyrighted file — only
 *  identity + metadata + a licensed-retailer link. */
export interface ModernMatch {
  song: string;
  artist: string;
  album?: string;
  isrc?: string;
  albumArtUrl?: string;
  composer?: string;
  matchConfidence: number;
  source: string;
  /**
   * The PRIMARY retailer page for this song (Sheet Music Direct, affiliate ID
   * 67650) — built by the backend, never by the app. Opened in our own in-app
   * shell on an explicit tap; a modern-song match NEVER auto-redirects.
   */
  retailerUrl?: string;
  /**
   * The SECONDARY retailer page (Musicnotes), also built by the backend — the
   * "Try Musicnotes" button on the interstitial. Attribution belongs to
   * `retailerUrl`; this is a backup path, not the money path.
   */
  musicnotesUrl?: string;
}

/** Successful response from POST /api/recognize-modern.
 *  `modern` is null and `recognized` is "none" when no song was matched. */
export interface ModernResponse {
  success: true;
  modern: ModernMatch | null;
  recognized: "modern" | "none";
  source: string;
  query_duration_ms: number;
}

/** The states a recognition session can be in. */
export type RecognitionState =
  | "idle"
  | "recording"
  | "uploading"
  | "processing"
  | "success"
  | "no_match"
  | "error";

export interface CheckoutSessionResponse {
  url?: string;
  error?: string;
}

/** Navigation param list for the tab navigator. */
export type RootTabParamList = {
  Home: undefined;
  History: undefined;
  Library: undefined;
  Editor: undefined;
  Settings: undefined;
};

/** Navigation param list for the root stack (tabs + full-screen readers). */
export type RootStackParamList = {
  Tabs: undefined;
  PdfViewer: { itemId: string };
  ScannedViewer: { itemId: string };
  ScanScore: undefined;
  CloudSync: undefined;
  Metronome: undefined;
  /**
   * Notation editor (transpose v1). Reachable from the Editor tab card and from
   * an `abc` row in the Library; both params are optional so either entry point
   * can pass only what it has:
   * - `sourcePieceId` — a bundled public-domain piece (src/data/abcScores.ts).
   * - `itemId` — a saved ABC library item, loaded as the piece to transpose.
   */
  NotationEditor: { sourcePieceId?: string; itemId?: string } | undefined;
};

// ─── Library (Phase 4a: import + local sheet music library) ──

/** Supported kinds of items in the local library. */
export type LibraryKind =
  | 'pdf'
  | 'musicxml'
  | 'midi'
  | 'guitarpro'
  | 'scanned'
  /**
   * ABC notation text (`.abc`) — the notation editor's save format. The score
   * text lives in the item's `fileUri` (like every other single-file kind), so
   * abc copies rename/share/sync/delete through the same paths as the rest.
   */
  | 'abc';

/** A persistent entry in the local sheet music library. */
export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  /** Display title (derived from filename, or user-supplied). */
  title: string;
  /** Single file (pdf/musicxml/midi/guitarpro/abc), stored in app documents. */
  fileUri?: string;
  /** Ordered page images for a scanned score. */
  pageUris?: string[];
  /** PDF page count or scanned page count. 0 until known (pdf). */
  pageCount: number;
  /** First page thumbnail (scanned scores). */
  thumbnailUri?: string;
  /** Total file size in bytes. */
  sizeBytes: number;
  /** ISO date string when the item was imported. */
  createdAt: string;
}

// ─── Catalog search ("Find a piece", GET /api/pieces?q=) ──────

/**
 * One catalog row from `GET /api/pieces?q=` — the live public-domain/classical
 * catalog search behind the "Find a piece" screen. This is a browse/search
 * shape, not a recognition result: it carries no confidence (nothing was
 * heard), only what the catalog knows about the piece.
 *
 * All fields mirror the API's own JSON one-to-one (raw snake_case is mapped in
 * services/catalogSearch.ts). `sheetMusicUrl` is null whenever the catalog has
 * no curated, quality-gated score — the UI must say "Coming soon" rather than
 * offer a link.
 */
export interface CatalogPiece {
  id: string;
  title: string;
  composer: string;
  /** Catalog number (e.g. "WoO 59", "BWV 971"), or null when unknown. */
  catalog: string | null;
  /** Raw catalog grade 1-10, or null when the catalog has none. */
  difficulty: number | null;
  /** Human label ("Beginner" | "Intermediate" | "Advanced"), or null. */
  difficultyLabel: string | null;
  isPublicDomain: boolean;
  sheetMusicAvailable: boolean;
  sheetMusicUrl: string | null;
  albumArtUrl: string | null;
}

/** Represents a music recommendation shown in the Home feed. */
export interface Recommendation {
  id: string;
  title: string;
  composer: string;
  /** Plain-language reason this was recommended. */
  reason: string;
  /** Cover art URL (freely licensed). */
  coverArtUrl?: string;
}

// ─── Onboarding ───────────────────────────────────────────────

export type Instrument = 'piano' | 'guitar' | 'both';
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';
export type Genre = 'classical' | 'jazz-ragtime' | 'folk-traditional';

export interface OnboardingAnswers {
  instrument: Instrument;
  level: SkillLevel;
  genres: Genre[];
  completedAt: string; // ISO date string
}

// ─── Streaks ──────────────────────────────────────────────────

export interface StreakData {
  currentStreak: number;
  lastPracticeDate: string | null; // ISO date string (YYYY-MM-DD)
  bestStreak: number;
}

// ─── Achievements ─────────────────────────────────────────────

export interface Badge {
  id: string;
  name: string;
  description: string;
  emoji: string;
  earnedAt?: string; // ISO date string, set when earned
}

// ─── Weekly Goals ─────────────────────────────────────────────

export interface WeeklyGoal {
  target: number;
  current: number;
  weekStart: string; // ISO date string (Monday)
}

// ─── Daily Challenge ──────────────────────────────────────────

export interface DailyChallengePiece {
  id: string;
  title: string;
  composer: string;
  genre: string;
  difficulty: string; // "Beginner" | "Intermediate" | "Advanced"
  description?: string;
  /** Optional URL to sheet music PDF (served via the api/sheets proxy). */
  sheetMusicUrl?: string;
  /**
   * Optional ABC reference melody for the practice coach (slice 3). Populated
   * by the backend when the catalog has note-level data for the piece
   * (`melody_skeletons.abc`); when absent the coach falls back to the bundled
   * public-domain seeds and, failing that, says so honestly.
   */
  abc?: string | null;
  /**
   * Optional URL to a public-domain score audio preview for the practice
   * player (loop + time-stretch). Populated by the backend when available;
   * null/absent means "no curated audio yet".
   */
  audioUrl?: string;
  /** Honest availability signals from the catalog (never invented client-side). */
  isPublicDomain?: boolean;
  sheetMusicAvailable?: boolean;
  /** Raw catalog grade (1-10) when the catalog has one. */
  difficultyGrade?: number | null;
  /** Catalog number, e.g. BWV 846. */
  catalog?: string | null;
  /** The date this piece was featured for (YYYY-MM-DD). */
  challengeDate?: string;
}
