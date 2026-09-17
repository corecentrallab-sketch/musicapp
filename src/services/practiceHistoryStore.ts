/**
 * practiceHistoryStore.ts — AsyncStorage adapter for the practice-coach history
 * (roadmap #3, slice 1). This is the ONLY practice-history module that touches
 * react-native; the logic lives in ./practiceHistory.ts, which is storage
 * agnostic and unit-tested under plain Node.
 *
 * The practice-coach UI (slice 2) should call the pre-bound helpers here so
 * runs are actually persisted — calling practiceHistory.ts directly without a
 * storage argument uses an in-memory fallback that is lost on restart.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  savePracticeSession,
  getPracticeHistory,
  getBestAccuracy,
  type PracticeSession,
  type PracticeStorage,
} from './practiceHistory';

/** The device adapter — the same AsyncStorage every other retention feature uses. */
export const devicePracticeStorage: PracticeStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
};

/** Append one finished run to the on-device history (capped, oldest dropped). */
export function savePracticeSessionLocal(session: {
  pieceId: string;
  accuracyPct: number;
  durationSec: number;
  playedAt?: string;
}): Promise<PracticeSession | null> {
  return savePracticeSession(session, devicePracticeStorage);
}

/** On-device history, newest first; optionally just one piece's runs. */
export function getPracticeHistoryLocal(pieceId?: string | null): Promise<PracticeSession[]> {
  return getPracticeHistory(pieceId, devicePracticeStorage);
}

/** Highest accuracy recorded on this device for a piece (null if never played). */
export function getBestAccuracyLocal(pieceId: string): Promise<number | null> {
  return getBestAccuracy(pieceId, devicePracticeStorage);
}
