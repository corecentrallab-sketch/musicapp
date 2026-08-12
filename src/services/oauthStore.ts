/**
 * OAuth token persistence for cloud sync — Phase 4b.
 *
 * Tokens live in AsyncStorage under the app's @notesnap/ namespace, matching
 * the existing History/streaks pattern. Each provider stores a small object:
 * the access token, an optional refresh token, and the access-token expiry
 * (epoch ms) so the sync layer can refresh before calling the APIs.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Cloud providers supported by NoteSnap sync. */
export type CloudProvider = 'dropbox' | 'gdrive';

/** Stored OAuth session for one provider. */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires (undefined = unknown). */
  expiresAt?: number;
  /** Human-readable account name, when the provider tells us one. */
  accountName?: string;
}

const KEYS: Record<CloudProvider, string> = {
  dropbox: '@notesnap/oauth/dropbox',
  gdrive: '@notesnap/oauth/gdrive',
};

/** Cached Google Drive app-folder id (see gdrive.ts). */
const GDRIVE_FOLDER_KEY = '@notesnap/oauth/gdrive-folder-id';

export async function getStoredTokens(
  provider: CloudProvider
): Promise<OAuthTokens | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS[provider]);
    return raw ? (JSON.parse(raw) as OAuthTokens) : null;
  } catch {
    return null;
  }
}

export async function saveStoredTokens(
  provider: CloudProvider,
  tokens: OAuthTokens
): Promise<void> {
  await AsyncStorage.setItem(KEYS[provider], JSON.stringify(tokens));
}

export async function clearStoredTokens(provider: CloudProvider): Promise<void> {
  await AsyncStorage.removeItem(KEYS[provider]);
}

/** Whether a stored (possibly expired) session exists for the provider. */
export async function isCloudConnected(provider: CloudProvider): Promise<boolean> {
  const tokens = await getStoredTokens(provider);
  return tokens !== null && tokens.accessToken.length > 0;
}

/**
 * True when the access token is expired or about to expire (skew keeps a
 * buffer so a token never dies mid-request). Tokens without an expiry are
 * treated as valid — the API will still return 401 if they are revoked, and
 * the caller surfaces that as a friendly reconnect error.
 */
export function isTokenExpired(tokens: OAuthTokens, skewMs = 60_000): boolean {
  return tokens.expiresAt != null && tokens.expiresAt - skewMs <= Date.now();
}

/**
 * A file as seen in a cloud provider's folder. `id` is provider-specific
 * (Dropbox path / Drive file id) and is only used for downloads.
 */
export interface CloudFileRef {
  name: string;
  sizeBytes: number;
  id: string;
}

/** Thrown when a sync/API call needs a connection that isn't there. */
export class NotConnectedError extends Error {
  constructor(provider: CloudProvider) {
    super(
      `Not connected to ${provider === 'dropbox' ? 'Dropbox' : 'Google Drive'}. Connect it in Cloud Sync first.`
    );
    this.name = 'NotConnectedError';
  }
}
