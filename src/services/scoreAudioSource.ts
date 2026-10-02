/**
 * scoreAudioSource.ts — which practice audio a piece page may play
 * (RC-v28 fix acfb6a57).
 *
 * THE BUG THIS MODULE EXISTS TO MAKE IMPOSSIBLE. PieceDetailScreen used to fall
 * back to ONE bundled preview for ANY public-domain piece that had no curated
 * `audioUrl`:
 *
 *   const scoreAudioSource = hasCuratedScoreAudio
 *     ? piece.audioUrl
 *     : piece.isPublicDomain !== false
 *     ? bundledScoreAudio            // assets/audio/preview-fur-elise.wav
 *     : null;
 *
 * The owner opened Air on the G String (RC v28, Tests 7a + 7b), tapped the
 * ScoreViewer's Preview button — and heard FÜR ELISE. A piece page must NEVER
 * play a different piece's recording, so the fallback is GONE: a piece with no
 * curated audio gets no player at all. The viewer used to fill that slot with an
 * honest "🎧 Practice audio coming soon" hint; bundle E (owner 10-02, Q5) removed
 * the hint too — with no audio the chrome is not rendered, so nothing mid-piece
 * promises audio the app does not have (ScoreViewer's own
 * `!immersive && audioSource ? <ScorePlayer/> : null` branch).
 *
 * The decision is pure, so the tier1 gate can assert it with no emulator
 * (scripts/scoreAudioSource.test.ts), and the source contracts below fail if the
 * bundled fallback ever comes back.
 *
 * SCOPE NOTE — the owner's audio-QUALITY note is folded into acfb6a57 but is
 * deliberately NOT here: quality is the playback engine's job (launch+1), not
 * this fix. This module only decides WHAT may play, never how it sounds.
 *
 * Pure by design — no react / react-native / fs / path imports.
 */
import { maskComments } from './modalBackContract';

/** The honest descriptor for a piece's OWN curated score audio. */
export const SCORE_AUDIO_LABEL = 'Score audio';

/**
 * The RETIRED no-audio hint. It used to fill the viewer's audio slot with
 * "🎧 Practice audio coming soon" whenever a piece had no curated audio — a
 * promise in the middle of the sheet, and a D13 site (audit 10-01). Owner Q5
 * (10-02, bundle E): the label is ABSENT, not muted — with no curated audio the
 * audio chrome is simply not rendered. The string survives here only as the
 * marker the source contract rejects.
 */
export const RETIRED_NO_SCORE_AUDIO_HINT = '🎧 Practice audio coming soon';

/**
 * The RETIRED universal fallback asset — a different piece's recording (Für
 * Elise) that used to play under every public-domain score. Any reference to it
 * from a piece page is the RC-v28 defect coming back.
 */
export const RETIRED_BUNDLED_PREVIEW = 'preview-fur-elise.wav';

/** The only field the decision reads (a DailyChallengePiece fits). */
export interface ScoreAudioPieceLike {
  /** The piece's own curated score audio, supplied by the backend. */
  audioUrl?: string | null;
}

/**
 * The piece's OWN curated score audio, or `null`. Never another piece's audio,
 * never a bundled placeholder: a missing/blank/non-string `audioUrl` is `null`.
 */
export function curatedScoreAudioUrl(
  piece: ScoreAudioPieceLike | null | undefined,
): string | null {
  const url = piece?.audioUrl;
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** True when the piece has its own curated score audio. */
export function hasCuratedScoreAudio(
  piece: ScoreAudioPieceLike | null | undefined,
): boolean {
  return curatedScoreAudioUrl(piece) !== null;
}

/** What the piece page passes to the viewer, and whether a player may render. */
export interface ScoreAudioDecision {
  /** The curated URL, or `null` — in which case NOTHING may play. */
  source: string | null;
  /** The honest descriptor for curated audio (`undefined` when there is none). */
  label: string | undefined;
  /** The viewer renders a practice player ONLY when this is true. */
  showPlayer: boolean;
}

/**
 * The whole decision, in one pure call: a piece's own curated audio or nothing.
 * There is deliberately no other branch — the pre-fix public-domain fallback is
 * exactly what played Für Elise under Air on the G String.
 */
export function scoreAudioDecision(
  piece: ScoreAudioPieceLike | null | undefined,
): ScoreAudioDecision {
  const source = curatedScoreAudioUrl(piece);
  return {
    source,
    label: source === null ? undefined : SCORE_AUDIO_LABEL,
    showPlayer: source !== null,
  };
}

// ─────────────────────── source contracts (live scan) ───────────────────

/** A `require('…assets/audio…')` of any kind — the shape the fallback took. */
const BUNDLED_AUDIO_REQUIRE = /require\(\s*['"][^'"]*assets\/audio[^'"]*['"]\s*\)/;

/**
 * True when the piece page takes its practice audio from the curated decision
 * and carries NO bundled fallback of any kind.
 *
 * Three independent ways the defect can return, each rejected:
 *   1. the retired asset is named at all;
 *   2. any `assets/audio` require sneaks back in;
 *   3. the old `isPublicDomain !== false ? … : …` branch (the one that decided a
 *      DIFFERENT piece's audio was acceptable) is back;
 * and it must actually route the decision's own fields into the viewer.
 */
export function pieceDetailPlaysOnlyCuratedAudio(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(RETIRED_BUNDLED_PREVIEW) >= 0) return false;
  if (BUNDLED_AUDIO_REQUIRE.test(masked)) return false;
  if (/isPublicDomain\s*!==?\s*false\s*\?/.test(masked)) return false;
  if (masked.indexOf('scoreAudioDecision(') < 0) return false;
  return (
    /audioSource=\{scoreAudio\.source\}/.test(masked) &&
    /audioLabel=\{scoreAudio\.label\}/.test(masked)
  );
}

/**
 * True when the sheet viewer renders the practice player ONLY behind an existing
 * `audioSource`, and renders NOTHING in its place when there is none.
 *
 * This is the bundle-E / Q5 form of the contract (owner 10-02): the retired
 * "🎧 Practice audio coming soon" hint must not come back, and the viewer must not
 * grow any other placeholder in its place. Two facts are required together, so
 * neither half can satisfy it alone:
 *   • the player is gated on the audio source (`!immersive && audioSource ? … : null`);
 *   • the retired hint string is gone.
 * A viewer that dropped the hint but left the player ungated is a fake control; a
 * viewer that dropped the player entirely is a dead block. Both fail here.
 */
export function viewerRendersNoAudioChrome(source: string): boolean {
  const masked = maskComments(source);
  if (masked.indexOf(RETIRED_NO_SCORE_AUDIO_HINT) >= 0) return false;
  if (/\bPractice audio coming soon\b/i.test(masked)) return false;
  // The gated form: `{!immersive && audioSource ? (<ScorePlayer …/>) : null}`.
  const gated = /audioSource\s*\?\s*\(\s*[\s\S]{0,200}?<ScorePlayer\b/.test(masked);
  if (!gated) return false;
  return /:\s*null\s*\}/.test(masked);
}
