/**
 * modernRetryContract.ts — the source contract that keeps the pass-2
 * (retry / resample) path from silently dead-ending again.
 *
 * Why this exists (owner-reproduced on device, 09-22): in the "Find any song"
 * screen, a SECOND pass after "No modern song found" showed nothing at all — no
 * loading, no result, no error, no retry. `npm run test:tier1` was green at the
 * time, because every failure in that path was a *silent* one in a screen: no
 * pure-logic assertion can see a missing `setState`. This module reads the app's
 * own source text instead, so the class of bug is caught with no emulator and
 * with node_modules absent (same approach — and the same comment masker — as
 * src/services/modalBackContract.ts, the guard that caught the v22 white
 * screen).
 *
 * The four invariants, each one a way the pre-fix code could swallow a pass:
 *
 *   1. NO SILENT START RETURN — a `startRecording()` result must never be
 *      dropped with a bare `if (!started) return;`. Every start failure has to
 *      reach a surface (`if (!started) { …setInterstitial…; return; }`).
 *   2. NO UNBOUNDED STOP — `await recording.stopAndUnloadAsync()` without a
 *      bound can never resolve, and the caller only shows its surface after the
 *      stop returns, so an unbounded stop is a screen that stays blank forever.
 *   3. THE PREVIOUS RECORDING IS TORN DOWN FIRST — a new capture must release
 *      any recorder still held, so pass 2 starts on a clean audio session
 *      instead of racing pass 1's orphaned recorder.
 *   4. THE RETRY TIMER IS TRACKED — the 300ms auto-start must be stored in a ref
 *      and cleared (on unmount and before re-arming), so tapping the mic during
 *      that window cannot start a second capture.
 *
 * Pure by design — no react / react-native / fs imports. The disk walk lives in
 * the test script (scripts/recognitionRetry.test.ts); this file only reasons
 * about source text.
 */
import { maskComments, type SourceFile } from './modalBackContract';

export type { SourceFile } from './modalBackContract';

/** One source-contract breach, ready to print in a test failure. */
export interface RetryContractViolation {
  path: string;
  /** 1-based line number of the offending code. */
  line: number;
  /** What is wrong, in words. */
  problem: string;
  /** The offending snippet, whitespace-collapsed. */
  snippet: string;
}

/** Which line (1-based) `offset` sits on. */
function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/** Every identifier in the file that was assigned from a `startRecording()` call. */
export function startResultIdentifiers(source: string): string[] {
  const masked = maskComments(source);
  const found: string[] = [];
  const pattern = /\b([A-Za-z_$][\w$]*)\s*=\s*await\s+[\w$.]*\.startRecording\s*\(/g;
  let match = pattern.exec(masked);
  while (match) {
    found.push(match[1]);
    match = pattern.exec(masked);
  }
  return found;
}

/**
 * Invariant 1 — every file that inspects a `startRecording()` result may not
 * drop it with a bare return. A bare `if (!started) return;` is the silent
 * dead-end the owner hit: nothing is set, so nothing is shown.
 */
export function findSilentStartReturns(
  files: readonly SourceFile[],
): RetryContractViolation[] {
  const violations: RetryContractViolation[] = [];
  for (const file of files) {
    const masked = maskComments(file.source);
    const idents = startResultIdentifiers(file.source);
    if (idents.length === 0) continue;
    for (const ident of idents) {
      const pattern = new RegExp(
        `if\\s*\\(\\s*!\\s*${ident.replace(/\$/g, '\\$')}\\s*\\)\\s*return\\s*;`,
        'g',
      );
      let match = pattern.exec(masked);
      while (match) {
        violations.push({
          path: file.path,
          line: lineAt(masked, match.index),
          problem:
            'a failed recording start returns with NO surface — the retry becomes a silent dead end (set an interstitial error state before returning)',
          snippet: match[0].replace(/\s+/g, ' ').trim(),
        });
        match = pattern.exec(masked);
      }
    }
  }
  return violations;
}

/**
 * Invariant 2 — no awaited `stopAndUnloadAsync()` without a bound. The stop must
 * be raced against a timeout so a recorder that never reports "stopped" cannot
 * hang the caller (and with it, the entire screen).
 */
export function findUnboundedStops(
  files: readonly SourceFile[],
): RetryContractViolation[] {
  const violations: RetryContractViolation[] = [];
  for (const file of files) {
    const masked = maskComments(file.source);
    const pattern = /await\s+[\w$.]*\.stopAndUnloadAsync\s*\(\s*\)\s*;/g;
    let match = pattern.exec(masked);
    while (match) {
      violations.push({
        path: file.path,
        line: lineAt(masked, match.index),
        problem:
          'an unbounded await on stopAndUnloadAsync() can never resolve on some devices — bound it (race a timeout) or the screen never gets its loading/error surface',
        snippet: match[0].replace(/\s+/g, ' ').trim(),
      });
      match = pattern.exec(masked);
    }
  }
  return violations;
}

/**
 * Invariant 3 — starting a capture releases whatever recorder is still held, so
 * pass 2 cannot race pass 1's orphaned recorder on a dirty audio session.
 */
export function startTearsDownStaleRecording(source: string): boolean {
  const masked = maskComments(source);
  const start = masked.indexOf('const startRecording');
  if (start < 0) return false;
  const ctor = masked.indexOf('new Audio.Recording(', start);
  if (ctor < 0) return false;
  const beforeCtor = masked.slice(start, ctor);
  return /releaseRecording\s*\(|teardownStaleRecording\s*\(|stopAndUnloadAsync\s*\(/.test(
    beforeCtor,
  );
}

/**
 * Invariant 4 — the retry auto-start is stored in a ref and cleared. A bare
 * `setTimeout(() => handleStart(), 300)` cannot be cancelled, so it can start a
 * second capture while the user is already tapping the mic.
 */
export function retryTimerTracked(source: string): boolean {
  const masked = maskComments(source);
  const hasRetryTimerRef = /\bretryTimerRef\b/.test(masked);
  const assigns = /retryTimerRef\.current\s*=\s*setTimeout\s*\(/.test(masked);
  const clears = /clearTimeout\s*\(\s*retryTimerRef\.current\s*\)/.test(masked);
  return hasRetryTimerRef && assigns && clears;
}
