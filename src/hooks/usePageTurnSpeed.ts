/**
 * usePageTurnSpeed — the React binding between the page-turner speed PRESETS
 * (services/pageTurnPresets.ts), the per-piece MEMORY
 * (services/pageTurnSpeedStore.ts) and the running auto-scroll engine
 * (hooks/useAutoScroll.ts).
 *
 * Why a hook and not a copy in each viewer: the PDF viewer and the scanned
 * viewer must behave IDENTICALLY — same presets, same restore, same save — and
 * the piece identity they key on (`route.params.itemId`, the library item id) is
 * the same string in both. One implementation, two hosts.
 *
 * Behaviour:
 *   • On mount (and whenever `itemId` changes) the piece's saved profile is read
 *     once and applied to the engine. A piece with no saved speed keeps the
 *     engine's defaults — an unknown piece never inherits another's speed.
 *   • The LIVE numbers are what get saved, debounced, so both a preset tap AND a
 *     fine-tune with the steppers are remembered for that piece.
 *   • `activePresetId` is DERIVED from the live numbers: a fine-tuned custom rate
 *     lightens no chip, which is the truth.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PAGE_TURN_PRESETS,
  activePageTurnPresetId,
  pageTurnPreset,
  pageTurnSpeedForPiece,
  withPageTurnSpeedForPiece,
  type PageTurnPreset,
  type PageTurnPresetId,
} from '../services/pageTurnPresets';
import {
  readPageTurnSpeedMap,
  writePageTurnSpeedMap,
} from '../services/pageTurnSpeedStore';
import type { AutoScrollApi } from './useAutoScroll';

/** Stepper taps burst; one write per settled value is enough. */
const SAVE_DEBOUNCE_MS = 400;

export interface PageTurnSpeedApi {
  /** The skill-level profiles, in slow-to-fast order. */
  presets: readonly PageTurnPreset[];
  /** The preset the current numbers ARE, or null when fine-tuned. */
  activePresetId: PageTurnPresetId | null;
  /** Apply a profile (both numbers) and remember it for this piece. */
  onSelectPreset: (id: PageTurnPresetId) => void;
  /** True once a profile has been restored for / saved on this piece. */
  remembered: boolean;
}

export function usePageTurnSpeed(
  itemId: string | null | undefined,
  autoScroll: AutoScrollApi,
): PageTurnSpeedApi {
  const applySpeedProfile = autoScroll.applySpeedProfile;
  const bpm = autoScroll.bpm;
  const beatsPerPage = autoScroll.beatsPerPage;
  const [restored, setRestored] = useState(false);
  const [remembered, setRemembered] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Restore this piece's saved speed — once per piece.
  useEffect(() => {
    let cancelled = false;
    setRestored(false);
    setRemembered(false);
    void (async () => {
      const map = await readPageTurnSpeedMap();
      if (cancelled || !aliveRef.current) return;
      const saved = pageTurnSpeedForPiece(map, itemId ?? null);
      if (saved) {
        applySpeedProfile(saved);
        setRemembered(true);
      }
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, applySpeedProfile]);

  // Remember the LIVE numbers for this piece (debounced). Only after the restore
  // pass, so a piece with no saved speed is not immediately stamped with the
  // defaults before the user has chosen anything.
  useEffect(() => {
    if (!restored || !itemId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void (async () => {
        const map = await readPageTurnSpeedMap();
        await writePageTurnSpeedMap(
          withPageTurnSpeedForPiece(map, itemId, { bpm, beatsPerPage }),
        );
      })();
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [itemId, restored, bpm, beatsPerPage]);

  const onSelectPreset = useCallback(
    (id: PageTurnPresetId) => {
      const preset = pageTurnPreset(id);
      if (!preset) return;
      applySpeedProfile(preset);
      setRemembered(true);
    },
    [applySpeedProfile],
  );

  return {
    presets: PAGE_TURN_PRESETS,
    activePresetId: activePageTurnPresetId({ bpm, beatsPerPage }),
    onSelectPreset,
    remembered,
  };
}
