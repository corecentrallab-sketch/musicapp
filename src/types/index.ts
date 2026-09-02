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

/** Purchase link URLs for a matched piece. */
export interface PurchaseUrls {
  musicnotes: string;
  sheetmusicplus: string;
}

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
  /** Capture-quality guard: true when the recording was degraded (unstable
   *  pitch, wide pitch range, over-driven, etc.) and the server returned
   *  coaching guidance instead of a bare miss. */
  input_unclear?: boolean;
  /** Machine-readable reasons for the input-unclear flag, e.g.
   *  ["unstable-pitch", "wide-pitch-range"]. */
  input_unclear_reasons?: string[];
  /** Human-facing coaching message (same as hint) telling the user how to
   *  record a better take. */
  message?: string;
  /** Short human-facing hint for the input-unclear case. */
  hint?: string;
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
  retailerUrl?: string;
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
};

// ─── Library (Phase 4a: import + local sheet music library) ──

/** Supported kinds of items in the local library. */
export type LibraryKind =
  | 'pdf'
  | 'musicxml'
  | 'midi'
  | 'guitarpro'
  | 'scanned';

/** A persistent entry in the local sheet music library. */
export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  /** Display title (derived from filename, or user-supplied). */
  title: string;
  /** Single file (pdf/musicxml/midi/guitarpro), stored in app documents. */
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
