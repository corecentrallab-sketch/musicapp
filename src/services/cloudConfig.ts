/**
 * Cloud sync configuration — Phase 4b.
 *
 * Credentials arrive as build-time environment variables (EXPO_PUBLIC_* is
 * inlined by Expo). The owner registers the OAuth apps separately; until the
 * secrets land, `isConfigured` is false and the UI shows an honest
 * "not configured" state. Nothing here is stubbed: when credentials exist,
 * every call goes against the real provider endpoints.
 */

const DROPBOX_APP_KEY = process.env.EXPO_PUBLIC_DROPBOX_APP_KEY ?? '';
const DROPBOX_APP_SECRET = process.env.EXPO_PUBLIC_DROPBOX_APP_SECRET ?? '';
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

/** Folder name used inside each provider (Dropbox path / Drive folder). */
export const CLOUD_APP_FOLDER = 'NotesSnap';

/** Dropbox OAuth app credentials (EXPO_PUBLIC_DROPBOX_APP_KEY / _SECRET). */
export const dropboxConfig = {
  appKey: DROPBOX_APP_KEY,
  appSecret: DROPBOX_APP_SECRET,
  /** True when the owner has supplied a Dropbox app key. */
  get isConfigured(): boolean {
    return DROPBOX_APP_KEY.trim().length > 0;
  },
};

/** Google OAuth client credentials (EXPO_PUBLIC_GOOGLE_CLIENT_ID / _IOS). */
export const googleConfig = {
  androidClientId: GOOGLE_ANDROID_CLIENT_ID,
  iosClientId: GOOGLE_IOS_CLIENT_ID,
  /** True when the owner has supplied a Google Android client ID. */
  get isConfigured(): boolean {
    return GOOGLE_ANDROID_CLIENT_ID.trim().length > 0;
  },
};
