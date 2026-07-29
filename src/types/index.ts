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

export interface RecognitionResponse {
  success: true;
  matches: Match[];
  query_duration_ms: number;
  db_available: boolean;
  purchase_url?: {
    musicnotes: string;
    sheetmusicplus: string;
  };
}

export interface RecognitionError {
  success: false;
  error: string;
}

export interface Match {
  piece_id: string;
  title: string;
  composer: string;
  catalog?: string;
  confidence: number;
  album_art_url?: string;
  sheet_music_url?: string;
  tab_url?: string;
  matched_at_s?: number;
  purchase_url?: {
    musicnotes: string;
    sheetmusicplus: string;
  } | null;
}

export interface CheckoutSessionResponse {
  url?: string;
  error?: string;
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
}
