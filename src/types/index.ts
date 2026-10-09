/**
 * Core type definitions for NoteSnap.
 */

import type { SavedCaptureTake } from '../services/midiExport';

/**
 * The personal-melody marker on a History row (melody capture, owner 10-02).
 *
 * A row carrying this is the USER'S OWN tune — hummed, whistled or sung into the
 * capture window and kept on their device — not a recognized piece. That is why
 * it exists as its own block rather than as a flag on `capture`: the row is
 * re-openable as a MELODY (the capture window shows the take again) instead of
 * being sent to the piece page, where a melody id resolves to nothing at all.
 *
 * Honesty rules:
 *   • `audioUri` is the saved recording's own file in the app's documents
 *     directory (`melodyStore.persistMelodyAudio`) — or null when that copy
 *     could not be made, in which case the surface says the sound was not kept
 *     rather than promising a replay it cannot deliver;
 *   • `capturedAt` is the take's own capture time (the same stamp the row's
 *     `savedAt` carries), so the id, the row and the take can never disagree.
 */
export interface PersonalMelodyRef {
  audioUri: string | null;
  capturedAt: string;
}

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
  /**
   * ADDITIVE (MIDI export Batch A): the user's own captured take, when this row
   * came from a hum/whistle/sing capture that was exported as MIDI. Absent on
   * every other row (and on every row saved before Batch A), so the History
   * "Export MIDI" action only ever appears where a real take exists.
   */
  capture?: SavedCaptureTake;
  /**
   * ADDITIVE (History dead-end sprint, owner 10-01): the licensed retailer links
   * a MODERN-song recognition was saved WITH, so the History row can still reach
   * the sheet music that was on offer when the user recognized it.
   *
   * This exists because the row used to carry identity only: the modern-match
   * retailer URLs were dropped at save time (a modern ISRC is not a catalog piece
   * id, so `GET /api/pieces/:id` returns nothing and nothing merged), and tapping
   * the saved row landed on the piece page's honest "🎼 Sheet music coming soon"
   * — a dead end at the exact moment the user wanted to buy (owner: "pressing the
   * sheet-music card must take the user AUTOMATICALLY TO PURCHASE").
   *
   * Honesty rules — the whole reason this is a SAVED value and not a lookup:
   *   • present ONLY on rows whose recognition actually carried a retailer URL,
   *     built by `modernPurchaseUrls()` (never invented, never guessed);
   *   • never filled in from the catalog — `mergeCatalogIntoDetail` cannot supply
   *     one (CatalogPieceInfo has no such field) and never clears one;
   *   • absent/null on public-domain, hum and find-a-piece saves: those rows keep
   *     today's behaviour, and on every row saved before this change.
   */
  purchaseUrls?: PurchaseUrls | null;
  /**
   * ADDITIVE (melody capture, owner 10-02): present ONLY on a row that came from
   * the melody-capture window — one of the user's OWN takes, kept on their device
   * ("stores the sound in history for the user to come back to it"). See
   * PersonalMelodyRef. Absent on every recognition row, so a row's tap routes to
   * the piece page exactly as before, and a melody row can never be mistaken for
   * a catalog piece (a melody id is not a piece id).
   */
  personalMelody?: PersonalMelodyRef | null;
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
  /**
   * The SECONDARY action for a LIBRARY/public-domain result (owner Q2/Q7,
   * ratified 10-02): the affiliate SEARCH link for this work's printed
   * arrangement, when the backend supplied one (the PD cross-check's
   * `affiliate_url`). It is never a primary purchase claim — for a public-domain
   * work `purchase_url` stays null and the FREE hosted score stays the offer; this
   * link is a quieter "get a printed arrangement" line beside it. Absent on every
   * other match, and never built by the app.
   */
  affiliate_url?: string | null;
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
  /**
   * ADDITIVE (bundle A, owner 10-02): which pass produced this success payload,
   * when it was NOT the microphone's ambient pass. The hum/whistle/sing fallback
   * maps its match into this same response shape
   * (`frontDoor.humMatchToResultResponse()`), and the ONE result surface reads the
   * marker to show the honest provenance kicker ("You hummed it — here it is")
   * instead of claiming it heard the music. A client-side marker in the same
   * spirit as `pd_routed_from`: it is set by US, never received from the server,
   * and absent means the ambient library pass.
   */
  result_provenance?: 'hum';
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
  /**
   * THE REAL GENRE from the music-ID provider's own metadata ("Hard Rock",
   * "Modern Jazz", "Ambient"), mapped server-side from AudD's Apple Music /
   * Spotify blocks (owner request 09-25 — the result card used to hardcode
   * "Modern song"). ABSENT when the provider carried no genre; the app then
   * resolves through modernGenreLabel() and shows its honest generic category.
   */
  genre?: string;
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
/**
 * The PD-library cross-check the BACKEND attaches to a modern recognition
 * (build #3, owner 09-25). The licensed provider identifies a RECORDING; when
 * that recording is of a public-domain work our own catalog holds (Lang Lang's
 * Für Elise), its free score is what the user came for — and the work must never
 * be presented as a modern song to buy. The server reaches that verdict by
 * matching the AudD title + composer surname against the pieces table and sends
 * this block ONLY when the mapping is confident (an ambiguous mapping is absent,
 * so the modern card stays honest).
 *
 * Every field is optional and unvalidated on the wire: `pdMatchFromModernResponse`
 * (src/services/pdRouting.ts) is the only reader, and it refuses anything it
 * cannot prove. Fields are snake_case because this is the server's payload.
 */
export interface PdMatchWire {
  id?: string;
  title?: string;
  composer?: string;
  catalog?: string;
  genre?: string;
  difficulty_label?: string;
  sheet_music_available?: boolean;
  sheet_music_url?: string;
  album_art_url?: string;
  affiliate_url?: string;
  confidence?: number;
  match_confidence?: number;
  /** Explicit PD flag; `false` vetoes the route (a future server veto). */
  is_public_domain?: boolean;
}

export interface ModernResponse {
  success: true;
  modern: ModernMatch | null;
  recognized: "modern" | "none";
  source: string;
  query_duration_ms: number;
  /**
   * The PD-library mapping for this recording, when the backend's cross-check
   * was confident. Present ⇒ the app renders OUR library card (free score) for
   * the work instead of the modern interstitial. ABSENT ⇒ an honest modern
   * match (never a guess).
   */
  pd_match?: PdMatchWire;
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
  /**
   * ADDITIVE (v37 item 4, backlog d9d458bb): the CATALOG PIECE this row is a copy
   * of, when the row was written by "Save to library" on a public-domain result
   * card or piece page (services/pieceLibrarySave.ts) rather than picked, scanned
   * or synced.
   *
   * It exists so the save action can be idempotent and honest: the surface reads
   * the registry for this id and shows its real "Saved to library" state, and a
   * second tap can never write a duplicate row. Absent on every imported, scanned
   * and synced item, which keep exactly the behaviour they had.
   */
  sourcePieceId?: string;
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
  /**
   * ADDITIVE (History dead-end sprint, owner 10-01): the licensed retailer links
   * the piece was saved with, when it came from a MODERN-song recognition.
   *
   * The piece page needs them for two surfaces that would otherwise be dead ends:
   * the sheet-music card (a modern song has no curated score we may host, so the
   * card becomes the purchase link — owner: "pressing the sheet-music card must
   * take the user AUTOMATICALLY TO PURCHASE") and the coached-practice card's
   * reference-melody state (we never host a copyrighted melody; the official page
   * plays it). Absent on every public-domain / catalog / daily-challenge piece
   * and on rows saved before this change, which keep their honest states.
   */
  purchaseUrls?: PurchaseUrls | null;
}
