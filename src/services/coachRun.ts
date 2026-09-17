/**
 * coachRun.ts — the practice-coach UI's PURE brain (slice 3).
 *
 * Two things live here, both free of react / react-native / expo imports so
 * they compile and run under plain Node (scripts/coachRun.test.ts):
 *
 *  1. `coachRunReducer` — the record → decode → score state machine the card on
 *     the piece screen renders. It mirrors the existing Home/hum phases
 *     (idle → recording → processing → result) so the coach never invents a new
 *     interaction language, and it rejects illegal transitions instead of
 *     painting a half-updated card.
 *
 *  2. `scoreCoachRun` / `coachUnavailableOutcome` — turning one captured take
 *     into the exact copy the user sees. It is the ONLY place that decides
 *     whether a take is scorable, and it never produces a number that was not
 *     measured: a take we could not score (too short, nothing heard, capture
 *     unavailable) leaves `accuracyPct` null, so the UI cannot show — and the
 *     history cannot store — a fabricated score.
 *
 * Ownership: the screen owns the microphone (see hooks/useCoachRun.ts), this
 * module owns the state and the copy, and the numbers come from slice 1/2
 * (practiceCoach.ts, coachRecording.ts).
 */

import { coachFromRecording } from './coachRecording';
import { DEFAULT_ABC_TEMPO_BPM, abcTempoBpm } from './abcToReference';
import { buildFeedback, type CoachingFeedback } from './practiceCoach';
import type { PracticeSession } from './practiceHistory';

// ─── Outcomes ──────────────────────────────────────────────────

/**
 * 'scored'      — we heard notes and scored them (accuracyPct is real).
 * 'too-short'   — the take was shorter than a phrase; nothing to measure.
 * 'empty'       — the take was long enough but we heard no notes in it.
 * 'unavailable' — this build cannot turn a recording into samples yet.
 */
export type CoachRunKind = 'scored' | 'too-short' | 'empty' | 'unavailable';

export interface CoachRunOutcome {
  kind: CoachRunKind;
  /** Only non-null for kind 'scored' — never a placeholder number. */
  accuracyPct: number | null;
  headline: string;
  /** At most MAX_FEEDBACK_LINES specific lines (slice 1 enforces the cap). */
  lines: string[];
  /** Tempo the reference was read at (caller override → ABC Q: → 100). */
  tempoBpm: number;
  durationSec: number;
  /** Written notes in the reference melody behind this run. */
  notesWritten: number;
  /** Notes we actually heard in the take. */
  notesHeard: number;
  /** False when the piece has no reference melody (nothing to score against). */
  hasReference: boolean;
}

/** A take shorter than this cannot hold a phrase worth coaching. */
export const MIN_COACH_RUN_SECONDS = 1;

/** Honest copy for "this build cannot hear you yet" — never a fake result. */
export const CAPTURE_UNAVAILABLE_HEADLINE = 'Coaching needs one more piece.';
export const CAPTURE_UNAVAILABLE_LINE =
  'This build can record practice audio but cannot decode it on-device yet, so there is nothing honest to score. ' +
  'Your recording is never uploaded without a working decoder — no score has been shown or saved.';

/** True when an outcome carries a measured score worth saving. */
export function isScorableOutcome(outcome: CoachRunOutcome | null | undefined): boolean {
  return !!outcome && outcome.kind === 'scored' && typeof outcome.accuracyPct === 'number';
}

function tempoFor(abc: string, override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.round(override);
  }
  const fromAbc = abcTempoBpm(abc);
  return Number.isFinite(fromAbc) && fromAbc > 0 ? fromAbc : DEFAULT_ABC_TEMPO_BPM;
}

export interface CoachRunInput {
  /** Mono samples from whichever capture path produced them (null = none). */
  samples: Float32Array | null | undefined;
  sampleRate: number;
  /** The piece's ABC reference melody ('' when the piece has none). */
  abc: string;
  /** Piece title, woven into the positive band's copy (slice 1). */
  pieceTitle?: string;
  /** How long the take was, in seconds (from the recorder). */
  durationSec: number;
  /** Optional tempo override; otherwise the ABC's Q: then 100. */
  tempoBpm?: number;
}

/**
 * Score one captured take. Never throws, never invents a number.
 *
 * Order of honesty: an unusable take is reported as such BEFORE any scoring, so
 * a short/empty recording can never be dressed up as a 0% performance.
 */
export function scoreCoachRun(input: CoachRunInput): CoachRunOutcome {
  const abc = typeof input?.abc === 'string' ? input.abc : '';
  const tempoBpm = tempoFor(abc, input?.tempoBpm);
  const rawDuration = input?.durationSec;
  const durationSec =
    typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : 0;

  const base = {
    accuracyPct: null,
    tempoBpm,
    durationSec,
    notesWritten: 0,
    notesHeard: 0,
    hasReference: false,
  } as const;

  if (durationSec < MIN_COACH_RUN_SECONDS) {
    return {
      ...base,
      kind: 'too-short',
      headline: 'That take was too short to score.',
      lines: [
        'Record at least a bar or two — a couple of seconds is enough for us to hear where you are.',
      ],
    };
  }

  const result = coachFromRecording({
    samples: input?.samples as Float32Array,
    sampleRate: input?.sampleRate,
    tempoBpm,
    abc,
    pieceTitle: input?.pieceTitle,
  });

  const notesWritten = result.reference.length;
  const notesHeard = result.played.length;
  const hasReference = notesWritten > 0;

  if (!hasReference) {
    // No written melody behind this piece: there is nothing to be accurate
    // AGAINST, so this can never be a scored run (and is never saved).
    return {
      ...base,
      kind: 'empty',
      tempoBpm: result.tempoBpm,
      notesHeard,
      headline: 'Reference melody coming soon.',
      lines: [
        'We are still preparing this piece\u2019s melody, so there is no reference to score your take against.',
        'Nothing was scored, so this run is not going in your history.',
      ],
    };
  }

  if (notesHeard === 0) {
    return {
      ...base,
      kind: 'empty',
      tempoBpm: result.tempoBpm,
      notesWritten,
      hasReference,
      headline: 'We could not hear any notes in that take.',
      lines: hasReference
        ? [
            'Nothing was scored, so this run is not going in your history.',
            'Get closer to the microphone (or play a little louder) and try again.',
          ]
        : [
            'Nothing was scored, so this run is not going in your history.',
            'We are still preparing a reference melody for this piece.',
          ],
    };
  }

  const feedback: CoachingFeedback = result.feedback;
  return {
    kind: 'scored',
    accuracyPct: result.score.accuracyPct,
    headline: feedback.headline,
    lines: Array.isArray(feedback.lines) ? feedback.lines.slice(0, 3) : [],
    tempoBpm: result.tempoBpm,
    durationSec,
    notesWritten,
    notesHeard,
    hasReference,
  };
}

/**
 * The honest outcome for "this build cannot decode practice audio yet". The
 * caller (hook) catches the capture failure and builds the card copy here so it
 * stays testable and in one place.
 */
export function coachUnavailableOutcome(input: {
  abc: string;
  tempoBpm?: number;
  durationSec?: number;
}): CoachRunOutcome {
  const durationSec = typeof input?.durationSec === 'number' && input.durationSec > 0
    ? input.durationSec
    : 0;
  return {
    kind: 'unavailable',
    accuracyPct: null,
    headline: CAPTURE_UNAVAILABLE_HEADLINE,
    lines: [CAPTURE_UNAVAILABLE_LINE],
    tempoBpm: tempoFor(typeof input?.abc === 'string' ? input.abc : '', input?.tempoBpm),
    durationSec,
    notesWritten: 0,
    notesHeard: 0,
    hasReference: false,
  };
}

/** The "no reference melody for this piece yet" state (nothing to record for). */
export function coachNoReferenceOutcome(input: {
  abc: string;
  tempoBpm?: number;
}): CoachRunOutcome {
  return {
    kind: 'empty',
    accuracyPct: null,
    headline: 'Reference melody coming soon.',
    lines: [
      'We are still typesetting this piece into the coach, so there is no melody to compare you against yet.',
      'Recognition and sheet music work as usual in the meantime.',
    ],
    tempoBpm: tempoFor(typeof input?.abc === 'string' ? input.abc : '', input?.tempoBpm),
    durationSec: 0,
    notesWritten: 0,
    notesHeard: 0,
    hasReference: false,
  };
}

// ─── History view ──────────────────────────────────────────────

export interface CoachHistoryView {
  /** Most recent measured accuracy for this piece, or null. */
  lastAccuracyPct: number | null;
  /** Best measured accuracy for this piece, or null. */
  bestAccuracyPct: number | null;
  /** How many scored runs are stored for this piece. */
  runCount: number;
}

export const EMPTY_COACH_HISTORY: CoachHistoryView = {
  lastAccuracyPct: null,
  bestAccuracyPct: null,
  runCount: 0,
};

/**
 * Summarise the stored runs for one piece. `sessions` is the newest-first list
 * straight from getPracticeHistoryLocal(pieceId).
 */
export function summarizeHistory(
  sessions: PracticeSession[] | null | undefined,
  pieceId: string,
): CoachHistoryView {
  const list = (Array.isArray(sessions) ? sessions : []).filter(
    (s) => s && s.pieceId === pieceId && typeof s.accuracyPct === 'number',
  );
  if (list.length === 0) return { ...EMPTY_COACH_HISTORY };
  const best = list.reduce(
    (acc, s) => (s.accuracyPct > acc ? s.accuracyPct : acc),
    list[0].accuracyPct,
  );
  return {
    lastAccuracyPct: list[0].accuracyPct,
    bestAccuracyPct: best,
    runCount: list.length,
  };
}

// ─── State machine ─────────────────────────────────────────────

export type CoachRunPhase = 'idle' | 'recording' | 'processing' | 'result' | 'error';

export interface CoachRunState {
  phase: CoachRunPhase;
  /** User-facing failure text for phase 'error' (null otherwise). */
  error: string | null;
  /** The last outcome, kept across 'reset' so the card does not blink empty. */
  outcome: CoachRunOutcome | null;
  /** ms epoch when the current take started (null when not recording). */
  startedAtMs: number | null;
  history: CoachHistoryView;
}

export const initialCoachRunState: CoachRunState = {
  phase: 'idle',
  error: null,
  outcome: null,
  startedAtMs: null,
  history: { ...EMPTY_COACH_HISTORY },
};

export type CoachRunAction =
  | { type: 'record-started'; at: number }
  | { type: 'captured' }
  /**
   * A take finished. Carries whatever honest outcome resulted: 'scored',
   * 'too-short', 'empty' or 'unavailable' — all four end in the same UI phase
   * ('result') so the card has exactly one place to render feedback.
   */
  | { type: 'finished'; outcome: CoachRunOutcome }
  | { type: 'failed'; message?: string }
  | { type: 'history'; history: CoachHistoryView }
  | { type: 'reset' };

export const DEFAULT_RUN_ERROR =
  'Something went wrong while recording. Please try again.';

/**
 * Legal transitions only:
 *   idle/result/error → recording → processing → result
 *   recording/processing → error
 * Anything else is ignored, so a late promise (e.g. a stop tap arriving after
 * an error) can never move the card backwards into a lie.
 */
export function coachRunReducer(
  state: CoachRunState,
  action: CoachRunAction,
): CoachRunState {
  const current = state ?? initialCoachRunState;

  switch (action?.type) {
    case 'record-started': {
      if (current.phase === 'recording' || current.phase === 'processing') return current;
      return {
        ...current,
        phase: 'recording',
        error: null,
        outcome: null,
        startedAtMs: Number.isFinite(action.at) ? action.at : Date.now(),
      };
    }
    case 'captured': {
      if (current.phase !== 'recording') return current;
      return { ...current, phase: 'processing' };
    }
    case 'finished': {
      if (current.phase !== 'recording' && current.phase !== 'processing') return current;
      const outcome = action.outcome;
      // Optimistic history update: a measured run shows up in the card the
      // instant it lands. The authoritative values arrive right after via the
      // 'history' action (read back from AsyncStorage), which REPLACES these —
      // so the optimistic increment here can never double count.
      const history = isScorableOutcome(outcome)
        ? {
            lastAccuracyPct: outcome.accuracyPct as number,
            bestAccuracyPct:
              typeof current.history.bestAccuracyPct === 'number'
                ? Math.max(current.history.bestAccuracyPct, outcome.accuracyPct as number)
                : (outcome.accuracyPct as number),
            runCount: current.history.runCount + 1,
          }
        : current.history;
      return {
        ...current,
        phase: 'result',
        error: null,
        outcome,
        startedAtMs: null,
        history,
      };
    }
    case 'failed': {
      if (current.phase !== 'recording' && current.phase !== 'processing') return current;
      return {
        ...current,
        phase: 'error',
        error: action.message && action.message.trim() ? action.message : DEFAULT_RUN_ERROR,
        startedAtMs: null,
      };
    }
    case 'history': {
      return { ...current, history: action.history ?? { ...EMPTY_COACH_HISTORY } };
    }
    case 'reset': {
      return {
        ...current,
        phase: 'idle',
        error: null,
        startedAtMs: null,
      };
    }
    default:
      return current;
  }
}
