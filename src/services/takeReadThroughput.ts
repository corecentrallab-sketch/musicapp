/**
 * takeReadThroughput.ts — the device's own read speed, remembered between reads.
 *
 * THE ONE THING IT STORES: how many seconds of audio this phone processed per second of
 * wall clock, from reads that actually finished. `takeReadClock.ts` (pure) turns that into a
 * remaining-time estimate; before the first finished read there is nothing here, and the
 * lane shows the honest ceiling instead of a countdown that was never earned.
 *
 * Nothing else is written, and nothing leaves the device. A storage failure is not an error
 * the user needs: the clock simply falls back to the ceiling sentence, which is always true.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { READ_THROUGHPUT_MAX_SAMPLES, pushThroughput } from './takeReadClock';

/** The key the samples live under (versioned: a shape change starts a fresh key). */
export const READ_THROUGHPUT_KEY = 'notesnap:read-throughput:v1';

/** The samples this device has kept, or an empty list when there are none / it cannot read. */
export async function loadReadThroughput(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(READ_THROUGHPUT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(-READ_THROUGHPUT_MAX_SAMPLES);
  } catch {
    return [];
  }
}

/** Keep one more sample (and return the list that is now stored). */
export async function rememberReadThroughput(
  samples: ReadonlyArray<number> | null | undefined,
  sample: number | null,
): Promise<number[]> {
  const next = pushThroughput(samples ?? [], sample);
  try {
    await AsyncStorage.setItem(READ_THROUGHPUT_KEY, JSON.stringify(next));
  } catch {
    // The estimate is a nicety; a failed write must never break a read.
  }
  return next;
}
