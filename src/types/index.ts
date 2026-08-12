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
}

/** Error response from POST /api/recognize. */
export interface RecognitionError {
  success: false;
  error: string;
}

export type RecognitionResult = RecognitionResponse | RecognitionError;

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
  description: string;
  /** Optional URL to sheet music PDF/MusicXML. */
  sheetMusicUrl?: string;
}
