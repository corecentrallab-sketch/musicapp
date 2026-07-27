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

/** Navigation param list for the tab navigator. */
export type RootTabParamList = {
  Home: undefined;
  History: undefined;
  Editor: undefined;
  Settings: undefined;
};

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

// ---------------------------------------------------------------------------
// Recognition API types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Retention / gamification types
// ---------------------------------------------------------------------------

/** A piece in the daily challenge pool. */
export interface DailyChallengePiece {
  id: string;
  title: string;
  composer: string;
  genre: string;
  difficulty: string;
  description: string;
}

/** Streak tracking data persisted in AsyncStorage. */
export interface StreakData {
  currentStreak: number;
  lastPracticeDate: string | null;
  bestStreak: number;
}

/** Onboarding wizard answers. */
export interface OnboardingAnswers {
  instrument: string;
  level: string;
  genres: string[];
}

/** An achievement badge that can be earned. */
export interface Badge {
  id: string;
  name: string;
  description: string;
  emoji: string;
  earnedAt?: string;
}

/** Weekly practice goal tracking. */
export interface WeeklyGoal {
  target: number;
  current: number;
  weekStart: string;
}
