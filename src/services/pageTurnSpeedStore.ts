/**
 * pageTurnSpeedStore.ts — the device adapter for the page-turner SPEED MEMORY
 * (owner 10-10, backlog 7f64272f).
 *
 * Everything DECIDES in ./pageTurnPresets.ts (pure, tier-1 tested); this file
 * only reads and writes one AsyncStorage key. It is the module that touches
 * react-native, so it is deliberately NOT in tsconfig.tier1.json — the same
 * split as practiceHistory.ts / practiceHistoryStore.ts and medals.ts /
 * medalStore.ts.
 *
 *   • ONE KEY, plain JSON: `notesnap:pageturner:speed:v1` holds an object of
 *     `{ [libraryItemId]: { bpm, beatsPerPage } }`. Nothing leaves the device.
 *   • A BROKEN READ IS NOT A CRASH. Both calls are individually guarded; a
 *     storage failure degrades to "no saved speed for this piece", which the
 *     viewer renders as the default profile, not as an error.
 *   • NO NEW WRITE PATH for validation: every value in and out goes through the
 *     pure clamp/decode helpers, so a hand-edited or half-written map can never
 *     put the page turner outside the stepper bounds.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PAGE_TURN_SPEED_KEY,
  decodePageTurnSpeedMap,
  encodePageTurnSpeedMap,
  type PageTurnSpeedMap,
} from './pageTurnPresets';

/** The whole stored map. An unreadable/unset key yields an empty map. */
export async function readPageTurnSpeedMap(): Promise<PageTurnSpeedMap> {
  try {
    return decodePageTurnSpeedMap(await AsyncStorage.getItem(PAGE_TURN_SPEED_KEY));
  } catch {
    return {};
  }
}

/** Persist the whole map. Never throws: losing a saved speed is not a crash. */
export async function writePageTurnSpeedMap(map: PageTurnSpeedMap): Promise<void> {
  try {
    await AsyncStorage.setItem(PAGE_TURN_SPEED_KEY, encodePageTurnSpeedMap(map));
  } catch {
    // Best-effort by design (see the module header).
  }
}
