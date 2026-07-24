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
