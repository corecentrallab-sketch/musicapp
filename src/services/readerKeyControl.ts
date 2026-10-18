/**
 * readerKeyControl.ts — THE READER'S IN-PLACE KEY CONTROL AND ITS BACK-OUT GUARD
 * (UX round 1 step 3, owner 10-18 item 1, backlog 5e3dffd3).
 *
 * THE OWNER'S ASK. The full-score reader shipped in v39 with the key chosen in the
 * editor and handed in as params, so a user who opened the score and realised they
 * wanted +2 instead of +1 had to go back, re-key and re-open — and backing out
 * after a key change silently discarded it. The reader therefore grows two things,
 * and THIS module is the pure half of both:
 *
 *   1. THE KEY CONTROL — a key chip (`A minor`) with − / + semitone steppers that
 *      re-key the WHOLE score IN PLACE. The re-key is an ABSOLUTE derivation from
 *      the ABC the reader was opened with (`readerKeyPlan`): step +1, +1, −1 and
 *      the third step is the same shift as the first, so a chain of steps can
 *      never accumulate spelling drift or lose bars. The offset is clamped to
 *      ±11 semitones, the same band `abcTranspose.transposeAbc` transposes in, and
 *      the stepper at the bound is reported (atFloor/atCeiling) so the screen can
 *      say why it stops instead of shipping a button that does nothing.
 *
 *   2. THE BACK-OUT GUARD — "edits are never lost" as a rule, not a hope. The
 *      reader is a registered ROUTE (services/backExitContract.ts: routes are its
 *      first class), so the guard is a MODAL-OVERLAY-STYLE confirm ON the route:
 *      React Navigation's own `beforeRemove` event, never a hardware-BACK handler
 *      that would put this screen in the in-place-flow class. `readerLeaveOutcome`
 *      decides what a leave attempt means:
 *
 *        • nothing changed                → 'leave'        (no prompt, ever);
 *        • changed, no prompt up yet      → 'ask'          (ONCE);
 *        • changed, the prompt is up      → 'close-prompt' (a second BACK closes
 *                                          the prompt and stays — never a second
 *                                          prompt, and never a silent loss).
 *
 * `readerSavePlan` is the third rule: the save writes the ABC the user is LOOKING
 * AT with the title built from the key they CHOSE (`transposedCopyTitle`, the one
 * shared builder the editor uses), so the newly chosen key is what persists and
 * the reader can never save the params it was opened with instead.
 *
 * PURE: no react, no react-native, no fs, no network. Compiles and runs under
 * tsconfig.tier1.json.
 */
import {
  clampSemitones,
  extractAbcKey,
  keyDisplayName,
  parseKey,
  transposeAbc,
  transposeKey,
} from './abcTranspose';
import { transposedCopyTitle } from './transposedScore';

/** The `−` stepper's accessibility label — one semitone DOWN, said plainly. */
export const READER_KEY_DECREASE_LABEL = 'One semitone down';
/** The `+` stepper's accessibility label. */
export const READER_KEY_INCREASE_LABEL = 'One semitone up';
/** The key chip's accessibility label (the chip itself is information, not a button). */
export const READER_KEY_CHIP_LABEL = 'Key';
/**
 * THE UNSAVED-COPY LINE (the owner's words, 10-18 item 1). It is shown in the
 * footer, next to the save control, exactly while the reader holds a key change
 * that is not in the Library — the sticky footer is the one action that can lose
 * work, so the warning belongs beside it and never scrolls away.
 */
export const READER_UNSAVED_LINE = 'Unsaved change — save this copy to keep it.';
/** The back-out prompt's question (the owner's words). */
export const READER_KEEP_PROMPT_TITLE = 'Keep this transposed copy?';
/** The prompt's save action. */
export const READER_KEEP_PROMPT_SAVE = 'Save to Library';
/** The prompt's discard action — it says what it does to the work. */
export const READER_KEEP_PROMPT_LEAVE = 'Leave without saving';
/**
 * Shown at the ±11 bound, where a stepper is disabled. A disabled control with no
 * explanation is the "dead area" the money-path rule forbids everywhere else, so
 * the reader says where transposing stops and why.
 */
export const READER_KEY_LIMIT_LINE =
  'Transposing stops at 11 semitones from the original key.';

/** The offset band the reader transposes in (the same band `transposeAbc` uses). */
export const READER_KEY_OFFSET_MIN = -11;
export const READER_KEY_OFFSET_MAX = 11;

/** A whole, finite semitone count, or the fallback. */
function wholeSemitones(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

/** What ONE step of the key control does, as data the screen applies. */
export interface ReaderKeyPlan {
  /** The offset the reader is in AFTER this step (clamped to ±11). */
  offset: number;
  /** The whole semitones actually applied (0 when the step is a no-op). */
  delta: number;
  /** The ABC to render: the reader's own score, shifted absolutely. */
  abc: string;
  /** The new key label (e.g. `Am`), derived from the key the reader is showing. */
  keyLabel: string;
  /** True when this step changed the offset the reader was opened in. */
  changed: boolean;
  /** True when the offset is at the −11 bound (the `−` stepper is spent). */
  atFloor: boolean;
  /** True when the offset is at the +11 bound (the `+` stepper is spent). */
  atCeiling: boolean;
}

/**
 * THE STEP. `abc`/`keyLabel`/`offset` are the reader's CURRENT state (the ABC it
 * was opened with, the key label that ABC is in, and the offset those two came
 * from); `delta` is +1 or −1 semitone.
 *
 * Two properties the gate pins, because both are ways this control silently
 * breaks a score:
 *   • ABSOLUTE, NOT CUMULATIVE — only `delta` is applied to the reader's own ABC,
 *     so N steps cannot compound a spelling change (`transposeAbc` is not a
 *     perfect inverse of itself), and every step still carries EVERY bar.
 *   • A NO-OP IS A NO-OP — at a bound (or with a junk delta) the ABC and the key
 *     come back byte-identical rather than re-spelled, so the score can never be
 *     rewritten by a step that changed nothing.
 */
export function readerKeyPlan(input: {
  abc: unknown;
  keyLabel: unknown;
  offset: unknown;
  delta: unknown;
}): ReaderKeyPlan {
  const abc = typeof input?.abc === 'string' ? input.abc : '';
  const keyLabel = typeof input?.keyLabel === 'string' ? input.keyLabel.trim() : '';
  const offset = wholeSemitones(input?.offset, 0);
  const delta = wholeSemitones(input?.delta, 0);
  const offsetAfter = clampSemitones(offset + delta);
  const applied = offsetAfter - offset;

  const shiftedKeyLabel = (semitones: number): string => {
    const source = parseKey(keyLabel.length > 0 ? keyLabel : extractAbcKey(abc) ?? 'C');
    if (!source) return keyLabel;
    return transposeKey(source, semitones).keyLabel;
  };

  return {
    offset: offsetAfter,
    delta: applied,
    abc: applied === 0 || abc.length === 0 ? abc : transposeAbc(abc, applied),
    keyLabel: applied === 0 ? keyLabel : shiftedKeyLabel(applied),
    changed: offsetAfter !== offset,
    atFloor: offsetAfter <= READER_KEY_OFFSET_MIN,
    atCeiling: offsetAfter >= READER_KEY_OFFSET_MAX,
  };
}

/** The words on the chip: the key's full name (`A minor`), never a bare letter. */
export function readerKeyChipLabel(keyLabel: unknown): string {
  const label = typeof keyLabel === 'string' ? keyLabel.trim() : '';
  if (label.length === 0) return keyDisplayName('C');
  return keyDisplayName(label);
}

/**
 * WHETHER THE READER IS HOLDING WORK THAT IS NOT IN THE LIBRARY.
 *
 * The baseline is the LAST SAVED OFFSET when the user has saved in this window,
 * and the offset the reader was opened in until then. So: change nothing and press
 * BACK → no prompt; step +1 and step back −1 → no prompt (nothing is unsaved);
 * save and then press BACK → no prompt (the copy is in the Library); change the key
 * again after saving → prompt, because THAT change is not saved.
 */
export function readerIsDirty(input: {
  offset: unknown;
  initialOffset: unknown;
  savedOffset?: unknown;
}): boolean {
  const offset = wholeSemitones(input?.offset, 0);
  const initial = wholeSemitones(input?.initialOffset, 0);
  const rawSaved = input?.savedOffset;
  const saved =
    rawSaved === null || rawSaved === undefined ? null : wholeSemitones(rawSaved, initial);
  return offset !== (saved === null ? initial : saved);
}

/** What a leave attempt means for the reader's back-out guard. */
export type ReaderLeaveOutcome = 'leave' | 'ask' | 'close-prompt';

/**
 * THE BACK-OUT DECISION — one prompt, never two, and never a silent loss.
 *   • `leave`         — nothing unsaved: the route pops exactly as it always did;
 *   • `ask`           — the ONE prompt;
 *   • `close-prompt`  — the prompt is already up, so a second BACK press closes the
 *                       prompt and leaves the user on the reader (never a re-ask,
 *                       and never a leave that would lose the change).
 */
export function readerLeaveOutcome(input: {
  dirty: boolean;
  promptOpen: boolean;
}): ReaderLeaveOutcome {
  if (input?.dirty !== true) return 'leave';
  return input?.promptOpen === true ? 'close-prompt' : 'ask';
}

/** What a save from the reader writes — always the score the user is looking at. */
export interface ReaderSavePlan {
  /** The ABC to write: the reader's CURRENT score, in the CURRENT key. */
  abc: string;
  /** The Library title, from the ONE shared builder the editor also calls. */
  title: string;
  /** The offset the saved copy is in (the one the reader is showing). */
  offset: number;
  /** The key label the saved copy is in. */
  keyLabel: string;
}

/**
 * THE SAVE. The reader is opened with the editor's params but the user may have
 * re-keyed inside it, so what persists must come from the reader's own state — the
 * score being viewed and the key it is now in — never from `route.params`. Omitting
 * this is how a reader would save "the score you opened" while showing another one.
 */
export function readerSavePlan(input: {
  abc: unknown;
  title: unknown;
  keyLabel: unknown;
  offset: unknown;
}): ReaderSavePlan {
  const abc = typeof input?.abc === 'string' ? input.abc : '';
  const keyLabel = typeof input?.keyLabel === 'string' ? input.keyLabel.trim() : '';
  const offset = wholeSemitones(input?.offset, 0);
  return {
    abc,
    keyLabel,
    offset,
    title: transposedCopyTitle({ title: input?.title, keyLabel, offset }),
  };
}
