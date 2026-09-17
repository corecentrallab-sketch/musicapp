/**
 * practiceCoach.ts — pure scoring + feedback logic for the practice-coach layer
 * (owner-approved roadmap #3, slice 1: scoring, feedback copy and progress
 * persistence — deliberately NO UI here).
 *
 * Honest scope: this is a SIMPLER MONOPHONIC pitch check. The caller (the
 * slice-2 UI / audio path) hands us the reference melody (the notes of the
 * score, positioned in beats) and the notes it heard the player perform, and we
 * return one verdict per note plus one practice number and banded, human
 * feedback. Real-time note-by-note detection and full rhythm scoring come later.
 *
 * Kept FREE of any react-native / expo imports so it compiles and runs under
 * plain Node (see scripts/practiceCoach.test.ts) — same convention as tier1.ts.
 */

/** A note as written in the score, positioned in beats from the start. */
export interface ReferenceNote {
  /** MIDI note number. Integer values are exact semitones; fractions are allowed. */
  midi: number;
  /** Offset from the start of the piece, in beats. */
  startBeat: number;
  /** Written length, in beats. Also sets this note's rhythm tolerance. */
  durationBeats: number;
}

/** A note the coach heard the player perform. */
export interface PlayedNote {
  midi: number;
  startBeat: number;
  durationBeats: number;
}

/**
 * Per-note verdict.
 *  - 'hit'    — played at the right time, within ±35 cents of the written pitch.
 *  - 'flat'   — right time, 35–120 cents LOW  (direction kept for coaching).
 *  - 'sharp'  — right time, 35–120 cents HIGH (direction kept for coaching).
 *  - 'near'   — the right pitch, but well outside the rhythm tolerance: the
 *               note was right, the moment was wrong.
 *  - 'missed' — nothing was heard for this written note (never played, or so
 *               far off in pitch that we cannot call it the same note).
 *  - 'extra'  — something was played that is not in the score.
 */
export type NoteStatus = 'hit' | 'near' | 'flat' | 'sharp' | 'missed' | 'extra';

export interface PerNoteResult {
  /** Index into the reference array. NO_REFERENCE (-1) for an 'extra' note. */
  refIndex: number;
  /** Index into the played array. null for a 'missed' reference note. */
  playedIndex: number | null;
  status: NoteStatus;
  /**
   * Signed pitch error in cents (played − reference). Negative = flat.
   * Present whenever we actually heard the note (absent for 'missed').
   */
  centsOff?: number;
  /**
   * Convenience copy of the written note's MIDI number and beat position, so
   * the feedback copy can name the note ("A#4") and its bar without the caller
   * having to hand the reference melody to buildFeedback as well. Absent for
   * 'extra' (there is no written note behind it).
   */
  refMidi?: number;
  refStartBeat?: number;
}

export interface PlaybackScore {
  /** 0–100, whole number. See the formula note on scorePlayback(). */
  accuracyPct: number;
  /** Total verdicts produced: every reference note plus any extras. */
  noteCount: number;
  verdicts: PerNoteResult[];
}

/** Pitch is a clean hit when it is within this many cents of the written note. */
export const HIT_TOLERANCE_CENTS = 35;
/**
 * Pitch is still "in the neighbourhood" (the same note, mis-intonated) out to
 * this many cents. Past it, two notes are treated as different notes.
 */
export const NEIGHBOR_TOLERANCE_CENTS = 120;
/**
 * Rhythm tolerance: a played note may sit up to this fraction of the written
 * note's length away from it and still count as that note in time. Tempo drift
 * beyond this is deliberately NOT penalised in this slice — this score is a
 * pitch-first practice metric, not a rhythm grader.
 */
export const RHYTHM_TOLERANCE_RATIO = 0.35;
/** refIndex used for an 'extra' verdict (a played note with no written note). */
export const NO_REFERENCE = -1;

/**
 * Score a performance against the written notes.
 *
 * Pairing (greedy, closest-timing-first):
 *  1. Every (reference, played) pair whose start beats are within
 *     RHYTHM_TOLERANCE_RATIO × the written note's length is a candidate.
 *  2. Candidates are taken in order of smallest timing error, then smallest
 *     pitch error; a pair is accepted when neither side is already used and the
 *     pitch is within NEIGHBOR_TOLERANCE_CENTS (otherwise it is not the same
 *     note and both sides stay free for later passes).
 *  3. Remaining unpaired notes are rescued on pitch alone: a played note within
 *     HIT_TOLERANCE_CENTS of a still-free written note becomes 'near' (right
 *     note, wrong moment). That keeps a rhythm slip from being reported as a
 *     pitch failure.
 *  4. Every written note still unpaired is 'missed'; every played note still
 *     unpaired is 'extra'.
 *
 * accuracyPct (documented for the owner — this is a PRACTICE metric, safe to
 * show users; it is NOT a recognition confidence, which is never shown raw):
 *
 *   accuracyPct = (hits + 0.5 × halfCredit) / reference.length × 100, rounded
 *
 *   halfCredit = notes we heard in the neighbourhood but not cleanly: 'flat',
 *   'sharp' (right time, pitch off by 35–120 cents) and 'near' (right pitch,
 *   wrong time). 'missed' scores 0; 'extra' notes are reported as verdicts but
 *   do not enter the formula, which is defined over the written notes only. An
 *   empty reference scores 0.
 */
export function scorePlayback(reference: ReferenceNote[], played: PlayedNote[]): PlaybackScore {
  const refs = Array.isArray(reference) ? reference : [];
  const plays = Array.isArray(played) ? played : [];
  const refUsed: boolean[] = new Array(refs.length).fill(false);
  const playUsed: boolean[] = new Array(plays.length).fill(false);
  const byRef: (PerNoteResult | null)[] = new Array(refs.length).fill(null);

  // ── Pass 1: timing candidates, closest timing first ────────────
  interface Candidate {
    ref: number;
    play: number;
    delta: number;
    cents: number;
  }
  const candidates: Candidate[] = [];
  for (let i = 0; i < refs.length; i++) {
    const tolerance = Math.abs(RHYTHM_TOLERANCE_RATIO * refs[i].durationBeats);
    for (let j = 0; j < plays.length; j++) {
      const delta = Math.abs(plays[j].startBeat - refs[i].startBeat);
      if (delta <= tolerance) {
        candidates.push({
          ref: i,
          play: j,
          delta,
          cents: centsBetween(refs[i].midi, plays[j].midi),
        });
      }
    }
  }
  candidates.sort(
    (a, b) =>
      a.delta - b.delta ||
      Math.abs(a.cents) - Math.abs(b.cents) ||
      a.ref - b.ref ||
      a.play - b.play,
  );

  for (const c of candidates) {
    if (refUsed[c.ref] || playUsed[c.play]) continue;
    const absCents = Math.abs(c.cents);
    // Too far from the written pitch to be the same note at all.
    if (absCents > NEIGHBOR_TOLERANCE_CENTS) continue;
    refUsed[c.ref] = true;
    playUsed[c.play] = true;
    byRef[c.ref] = {
      refIndex: c.ref,
      playedIndex: c.play,
      status: absCents <= HIT_TOLERANCE_CENTS ? 'hit' : c.cents < 0 ? 'flat' : 'sharp',
      centsOff: c.cents,
      refMidi: refs[c.ref].midi,
      refStartBeat: refs[c.ref].startBeat,
    };
  }

  // ── Pass 2: pitch-only rescue — right note, wrong moment ───────
  for (let i = 0; i < refs.length; i++) {
    if (refUsed[i]) continue;
    let bestPlay = -1;
    let bestCents = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let j = 0; j < plays.length; j++) {
      if (playUsed[j]) continue;
      const cents = centsBetween(refs[i].midi, plays[j].midi);
      if (Math.abs(cents) > HIT_TOLERANCE_CENTS) continue;
      const delta = Math.abs(plays[j].startBeat - refs[i].startBeat);
      if (delta < bestDelta || (delta === bestDelta && Math.abs(cents) < Math.abs(bestCents))) {
        bestPlay = j;
        bestCents = cents;
        bestDelta = delta;
      }
    }
    if (bestPlay >= 0) {
      refUsed[i] = true;
      playUsed[bestPlay] = true;
      byRef[i] = {
        refIndex: i,
        playedIndex: bestPlay,
        status: 'near',
        centsOff: bestCents,
        refMidi: refs[i].midi,
        refStartBeat: refs[i].startBeat,
      };
    }
  }

  // ── Result: written notes in order, then extras in played order ──
  const verdicts: PerNoteResult[] = [];
  for (let i = 0; i < refs.length; i++) {
    verdicts.push(byRef[i] ?? { refIndex: i, playedIndex: null, status: 'missed' });
  }
  for (let j = 0; j < plays.length; j++) {
    if (playUsed[j]) continue;
    verdicts.push({ refIndex: NO_REFERENCE, playedIndex: j, status: 'extra' });
  }

  const hits = verdicts.filter((v) => v.status === 'hit').length;
  const halfCredit = verdicts.filter(
    (v) => v.status === 'flat' || v.status === 'sharp' || v.status === 'near',
  ).length;
  const accuracyPct =
    refs.length === 0 ? 0 : clampPct(Math.round(((hits + 0.5 * halfCredit) / refs.length) * 100));

  return { accuracyPct, noteCount: verdicts.length, verdicts };
}

/** Signed pitch error between two MIDI note numbers, in whole-ish cents. */
export function centsBetween(referenceMidi: number, playedMidi: number): number {
  return Math.round((playedMidi - referenceMidi) * 100 * 100) / 100;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

// ─── Musical naming / positioning ──────────────────────────────

const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * Scientific pitch name for a MIDI note number: 60 → "C4", 61 → "C#4".
 * Sharps only (no flat spelling) — one name per pitch, so feedback copy stays
 * predictable. Non-finite input returns "?" rather than inventing a note.
 */
export function noteName(midi: number): string {
  if (!Number.isFinite(midi)) return '?';
  const m = Math.round(midi);
  const octave = Math.floor(m / 12) - 1;
  const pitchClass = ((m % 12) + 12) % 12;
  return `${PITCH_CLASSES[pitchClass]}${octave}`;
}

/**
 * ASSUMPTION: the score is in 4/4 — one bar is BEATS_PER_BAR beats, so bar =
 * floor(startBeat / 4) + 1. Time signatures are not modelled in this slice;
 * when the score carries a real meter this helper is the single place to change.
 */
export const BEATS_PER_BAR = 4;

/** 1-based bar number for a beat offset under the 4/4 assumption above. */
export function barOf(startBeat: number): number {
  if (!Number.isFinite(startBeat) || startBeat < 0) return 1;
  return Math.floor(startBeat / BEATS_PER_BAR) + 1;
}

// ─── Banded feedback copy ──────────────────────────────────────

export interface CoachingFeedback {
  headline: string;
  lines: string[];
}

/** Band floors, highest first. NEVER quote these numbers to users. */
export const COACH_READY_MIN = 90;
export const COACH_CLOSE_MIN = 70;
export const COACH_SHAPE_MIN = 50;
/** At most this many specific issue lines in any one piece of feedback. */
export const MAX_FEEDBACK_LINES = 3;

/**
 * Turn a score into banded, honest, growth-oriented feedback — the same pattern
 * as tier1.ts's no-match copy: banded words, never a raw percentage, and never
 * a number threshold quoted back at the user.
 *
 * Bands: >=90 performance-ready, 70–89 really close, 50–69 getting the shape,
 * <50 start slow. Below 90 the lines are the most common actual issues (up to
 * MAX_FEEDBACK_LINES, one per bar); at >=90 the copy stays purely positive
 * (pieceTitle, when known, is woven in there — corrective lines stay short and
 * specific, so no title).
 */
export function buildFeedback(score: PlaybackScore, pieceTitle?: string): CoachingFeedback {
  const accuracyPct = typeof score?.accuracyPct === 'number' ? score.accuracyPct : 0;
  const verdicts = Array.isArray(score?.verdicts) ? score.verdicts : [];

  if (verdicts.length === 0) {
    return {
      headline: 'Nothing to score yet.',
      lines: [
        'Play a few bars and we will show you where to focus — no judgement, just the spots to work on.',
      ],
    };
  }

  const title = typeof pieceTitle === 'string' && pieceTitle.trim() ? pieceTitle.trim() : '';

  if (accuracyPct >= COACH_READY_MIN) {
    return {
      headline: "Beautiful — that's performance-ready.",
      lines: [
        title
          ? `${title} — every note landed where it should.`
          : "Every note landed where it should, start to finish.",
        'Play it at tempo once more, then let it settle — this one is ready for an audience.',
      ],
    };
  }

  if (accuracyPct >= COACH_CLOSE_MIN) {
    return {
      headline: 'Really close. A few spots to polish.',
      lines: issueLines(verdicts, 'polish'),
    };
  }

  if (accuracyPct >= COACH_SHAPE_MIN) {
    return {
      headline: "You're getting the shape of it — let's work on the tricky bits.",
      lines: issueLines(verdicts, 'polish'),
    };
  }

  return {
    headline: 'Good work getting through it. Start slow and build up.',
    lines: [
      'Take it one phrase at a time at half speed — the notes are there, they just need reps.',
      ...issueLines(verdicts, 'nextStep'),
    ],
  };
}

/** One aggregated issue, ready to be phrased as advice. */
interface IssueGroup {
  status: NoteStatus;
  bar: number;
  name: string;
  count: number;
}

/** Statuses that change what the user should DO next, worst-first. */
const ISSUE_ORDER: NoteStatus[] = ['missed', 'sharp', 'flat', 'near', 'extra'];

/**
 * The most common issues by count, at most MAX_FEEDBACK_LINES of them, one per
 * bar (a bar already called out is skipped, so the list stays specific rather
 * than repeating "bar 3, bar 3, bar 3").
 */
function issueLines(verdicts: PerNoteResult[], tone: 'polish' | 'nextStep'): string[] {
  const groups = new Map<string, IssueGroup>();
  for (const v of verdicts) {
    if (v.status === 'hit') continue;
    const hasRef = v.status !== 'extra' && v.refIndex !== NO_REFERENCE;
    const bar = hasRef ? barOf(v.refStartBeat ?? 0) : 0;
    const key = `${v.status}|${bar}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      continue;
    }
    groups.set(key, {
      status: v.status,
      bar,
      name: hasRef ? noteName(v.refMidi ?? NaN) : '',
      count: 1,
    });
  }

  const ordered = Array.from(groups.values()).sort(
    (a, b) =>
      b.count - a.count ||
      a.bar - b.bar ||
      ISSUE_ORDER.indexOf(a.status) - ISSUE_ORDER.indexOf(b.status),
  );

  const usedBars = new Set<number>();
  const lines: string[] = [];
  for (const g of ordered) {
    if (lines.length >= MAX_FEEDBACK_LINES) break;
    if (g.bar !== 0) {
      if (usedBars.has(g.bar)) continue;
      usedBars.add(g.bar);
    }
    lines.push(renderIssue(g, tone));
  }
  if (lines.length === 0) {
    lines.push('Keep going a bar at a time — the next run will be closer.');
  }
  return lines;
}

/** Phrase one aggregated issue: 'polish' = what went wrong, 'nextStep' = what to do. */
function renderIssue(g: IssueGroup, tone: 'polish' | 'nextStep'): string {
  const bar = g.bar > 0 ? g.bar : 1;
  const name = g.name || 'note';
  switch (g.status) {
    case 'flat':
      return tone === 'polish'
        ? `The ${name} in bar ${bar} was flat — slow it down and aim higher.`
        : `Bar ${bar}: reach a little higher for the ${name}, slowly enough to hear it land.`;
    case 'sharp':
      return tone === 'polish'
        ? `The ${name} in bar ${bar} was sharp — ease off and aim lower.`
        : `Bar ${bar}: let the ${name} relax down — try it hands alone, slower.`;
    case 'missed':
      return tone === 'polish'
        ? `One note got away in bar ${bar} — try the left hand alone there.`
        : `Bar ${bar}: play the left hand alone, slowly, until it feels easy.`;
    case 'near':
      return tone === 'polish'
        ? `The ${name} in bar ${bar} came in at the wrong moment — count it in before you play it.`
        : `Bar ${bar}: count the beat out loud before you add the notes.`;
    case 'extra':
      return tone === 'polish'
        ? "A few notes crept in that aren't on the page — stay with the written rhythm."
        : 'Play it through once reading only, so the written rhythm leads.';
    default:
      return `Bar ${bar} needs another slow pass before it joins up.`;
  }
}

// ─── Convenience for the slice-2 UI ────────────────────────────

/**
 * Score a performance and build its feedback in one call — what the coach UI
 * will actually use.
 */
export function scoreAndCoach(
  reference: ReferenceNote[],
  played: PlayedNote[],
  pieceTitle?: string,
): { score: PlaybackScore; feedback: CoachingFeedback } {
  const score = scorePlayback(reference, played);
  return { score, feedback: buildFeedback(score, pieceTitle) };
}
