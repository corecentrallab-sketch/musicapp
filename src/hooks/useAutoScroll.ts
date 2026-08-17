/**
 * useAutoScroll — BPM-linked auto page turning for the score readers
 * (FEATURE BUILD 2). Applies to the PDF viewer and the scanned viewer.
 *
 * Timing model (mirrors the metronome's drift-corrected clock, PR #31):
 *   A coarse `setInterval` (100 ms) acts as a look-ahead scheduler. Each tick
 *   it turns the page once the absolute time of the next scheduled turn has
 *   arrived. Turn times come from an accumulating time base:
 *       turnTime(n) = startTime + n * pageIntervalMs
 *   — never from "now + interval" — so a late JS callback (UI jank, GC pause,
 *   background suspension) never shifts the page turns; the next turn still
 *   lands on its absolute time. If the app was suspended and the clock fell
 *   far behind, missed turns are skipped (no page burst) and the schedule
 *   resumes on a fresh slot.
 *
 *   BPM → page advance:
 *       secondsPerPage = (60 / bpm) * beatsPerPage
 *       pageIntervalMs = secondsPerPage * 1000
 *   Defaults: 60 BPM, 4 beats per page → 4.0 s per page.
 *
 * Tempo / beats-per-page changes while running snap the next turn to one new
 * interval after the last scheduled turn (the metronome's snapNextBeat
 * pattern), so an adjustment takes effect on the very next page turn.
 *
 * The hook only advances pages while `status === 'running'`; pausing keeps the
 * remaining time to the next turn so resume continues where it left off.
 * Reaching the last page stops automatically. The interval is cleaned up on
 * pause/stop/unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export const AUTO_SCROLL_BPM_MIN = 30;
export const AUTO_SCROLL_BPM_MAX = 200;
export const AUTO_SCROLL_DEFAULT_BPM = 60;
export const AUTO_SCROLL_BEATS_PER_PAGE_MIN = 1;
export const AUTO_SCROLL_BEATS_PER_PAGE_MAX = 16;
export const AUTO_SCROLL_DEFAULT_BEATS_PER_PAGE = 4;

/** How often the look-ahead scheduler wakes up (ms). */
const SCHEDULER_INTERVAL_MS = 100;

/** Monotonic clock — `performance.now()` is provided by Hermes/RN; DOM lib
 *  types declare it so it also type-checks on web. */
const nowMs = () => performance.now();

export type AutoScrollStatus = 'idle' | 'running' | 'paused';

export interface UseAutoScrollParams {
  /** Current 1-based page (kept fresh from the owning screen). */
  currentPage: number;
  /** Total pages; 0 means "unknown yet". */
  pageCount: number;
  /** Advance exactly one page. Called only when there is a next page. */
  onTurnPage: () => void;
}

export function useAutoScroll({
  currentPage,
  pageCount,
  onTurnPage,
}: UseAutoScrollParams) {
  const [status, setStatus] = useState<AutoScrollStatus>('idle');
  const [bpm, setBpmState] = useState(AUTO_SCROLL_DEFAULT_BPM);
  const [beatsPerPage, setBeatsPerPageState] = useState(
    AUTO_SCROLL_DEFAULT_BEATS_PER_PAGE
  );

  // Refs — the scheduler must never read stale values from a closure.
  const statusRef = useRef<AutoScrollStatus>('idle');
  const bpmRef = useRef(AUTO_SCROLL_DEFAULT_BPM);
  const beatsPerPageRef = useRef(AUTO_SCROLL_DEFAULT_BEATS_PER_PAGE);
  const currentPageRef = useRef(currentPage);
  const pageCountRef = useRef(pageCount);
  const onTurnPageRef = useRef(onTurnPage);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Absolute time (nowMs base) the next page turn is scheduled for. */
  const nextTurnRef = useRef(0);
  /** Absolute time of the most recently scheduled turn. */
  const lastTurnRef = useRef(0);
  /** Remaining ms until the next turn when paused (null when not paused). */
  const remainingRef = useRef<number | null>(null);

  // Keep the refs in sync with the latest render values.
  useEffect(() => {
    currentPageRef.current = currentPage;
    pageCountRef.current = pageCount;
    onTurnPageRef.current = onTurnPage;
  });

  const pageIntervalMs = useCallback(
    () => (60000 / bpmRef.current) * beatsPerPageRef.current,
    []
  );

  const clearTicker = useCallback(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    statusRef.current = 'idle';
    setStatus('idle');
    clearTicker();
    remainingRef.current = null;
  }, [clearTicker]);

  const tick = useCallback(() => {
    if (statusRef.current !== 'running') return;
    const now = nowMs();
    const interval = pageIntervalMs();

    // If the app was suspended (backgrounded) we may be far behind. Skip the
    // missed turns instead of bursting through pages when the UI resumes, and
    // resume the schedule on a fresh slot.
    if (nextTurnRef.current < now - interval * 1.5) {
      nextTurnRef.current = now + interval;
      return;
    }

    // Turn every page whose absolute time has arrived (normally exactly one).
    while (nextTurnRef.current <= now) {
      lastTurnRef.current = nextTurnRef.current;
      nextTurnRef.current += interval;

      const atEnd =
        pageCountRef.current > 0 &&
        currentPageRef.current >= pageCountRef.current;
      if (atEnd) {
        stop();
        return;
      }
      onTurnPageRef.current();
    }
  }, [pageIntervalMs, stop]);

  const startTicker = useCallback(() => {
    if (tickerRef.current) return;
    tickerRef.current = setInterval(tick, SCHEDULER_INTERVAL_MS);
  }, [tick]);

  const start = useCallback(() => {
    if (statusRef.current !== 'idle') return;
    const now = nowMs();
    statusRef.current = 'running';
    setStatus('running');
    lastTurnRef.current = now;
    nextTurnRef.current = now + pageIntervalMs();
    remainingRef.current = null;
    startTicker();
  }, [pageIntervalMs, startTicker]);

  const pause = useCallback(() => {
    if (statusRef.current !== 'running') return;
    remainingRef.current = Math.max(0, nextTurnRef.current - nowMs());
    statusRef.current = 'paused';
    setStatus('paused');
    clearTicker();
  }, [clearTicker]);

  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    const now = nowMs();
    const remaining = remainingRef.current ?? pageIntervalMs();
    statusRef.current = 'running';
    setStatus('running');
    lastTurnRef.current = now;
    nextTurnRef.current = now + remaining;
    remainingRef.current = null;
    startTicker();
  }, [pageIntervalMs, startTicker]);

  const toggle = useCallback(() => {
    if (statusRef.current === 'running') pause();
    else if (statusRef.current === 'paused') resume();
    else start();
  }, [pause, resume, start]);

  /** Snap the next turn to one new interval after the last scheduled turn, so
   *  BPM / beats-per-page changes apply from the next turn. */
  const snapNextTurn = useCallback(() => {
    if (statusRef.current !== 'running') return;
    nextTurnRef.current = Math.max(nowMs(), lastTurnRef.current + pageIntervalMs());
  }, [pageIntervalMs]);

  const applyBpm = useCallback(
    (value: number) => {
      const next = Math.min(
        AUTO_SCROLL_BPM_MAX,
        Math.max(AUTO_SCROLL_BPM_MIN, Math.round(value))
      );
      setBpmState(next);
      bpmRef.current = next;
      snapNextTurn();
    },
    [snapNextTurn]
  );

  const stepBpm = useCallback(
    (delta: number) => applyBpm(bpmRef.current + delta),
    [applyBpm]
  );

  const applyBeatsPerPage = useCallback(
    (value: number) => {
      const next = Math.min(
        AUTO_SCROLL_BEATS_PER_PAGE_MAX,
        Math.max(AUTO_SCROLL_BEATS_PER_PAGE_MIN, Math.round(value))
      );
      setBeatsPerPageState(next);
      beatsPerPageRef.current = next;
      snapNextTurn();
    },
    [snapNextTurn]
  );

  const stepBeatsPerPage = useCallback(
    (delta: number) =>
      applyBeatsPerPage(beatsPerPageRef.current + delta),
    [applyBeatsPerPage]
  );

  // Clean up the interval when the owning screen unmounts (also covers
  // navigating away while auto-scroll is running).
  useEffect(() => {
    return () => {
      clearTicker();
    };
  }, [clearTicker]);

  const secondsPerPage = (60 / bpm) * beatsPerPage;

  return {
    status,
    bpm,
    beatsPerPage,
    secondsPerPage,
    start,
    pause,
    resume,
    stop,
    toggle,
    applyBpm,
    stepBpm,
    applyBeatsPerPage,
    stepBeatsPerPage,
  };
}

export type AutoScrollApi = ReturnType<typeof useAutoScroll>;
