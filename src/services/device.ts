/**
 * Anonymous device identity for NoteSnap.
 *
 * A UUID v4 persisted in AsyncStorage, generated once per install. Sent as the
 * `x-user-id` header on recognition requests and as `deviceId` when creating a
 * Stripe Checkout session — this is what ties a purchase to an install so the
 * server webhook can grant the Pro entitlement (GET /api/entitlement).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const DEVICE_ID_KEY = '@notesnap/deviceId';

/** Tiny UUID v4 fallback (no native crypto needed). */
function uuidV4Fallback(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns the stable device UUID, creating and persisting it on first use.
 * Uses expo-crypto's secure randomUUID when available; never hardcoded.
 */
export async function getDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
  } catch {
    // fall through and regenerate
  }

  let id: string;
  try {
    id = Crypto.randomUUID();
  } catch {
    id = uuidV4Fallback();
  }

  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // Non-fatal: the id still works for this session.
  }
  return id;
}
