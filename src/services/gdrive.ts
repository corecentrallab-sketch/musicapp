/**
 * Google Drive sync — Phase 4b.
 *
 * Full OAuth 2 (PKCE, refresh tokens) against Google's endpoints plus Drive
 * API v3 list/download/upload. Scope is drive.file (least privilege — the app
 * can only touch files/folders it creates). Credentials come from
 * EXPO_PUBLIC_GOOGLE_CLIENT_ID (+ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID); until
 * the owner supplies them, connectGDrive() refuses and the UI shows the
 * "not configured" state.
 *
 * OAuth notes:
 *  - Redirect URI for installed apps is `<applicationId>:/oauthredirect`
 *    (e.g. com.notesnap.sheetmusic:/oauthredirect) — the same convention the
 *    expo-auth-session Google provider uses for native builds. It works
 *    without registering the URI in Google Cloud Console (native clients
 *    match on client id), but the app must run in a dev/standalone build —
 *    not Expo Go — with its own client id.
 *  - `access_type=offline&prompt=consent` makes Google issue a refresh token.
 */
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { googleConfig, CLOUD_APP_FOLDER } from './cloudConfig';
import {
  clearStoredTokens,
  getStoredTokens,
  isTokenExpired,
  NotConnectedError,
  saveStoredTokens,
  type CloudFileRef,
  type OAuthTokens,
} from './oauthStore';

WebBrowser.maybeCompleteAuthSession();

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** Least-privilege scope: only files this app created/owns. */
export const GDRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_ID_KEY = '@notesnap/oauth/gdrive-folder-id';

/** Whether the owner has configured a Google Android client ID. */
export function isGDriveConfigured(): boolean {
  return googleConfig.isConfigured;
}

/** Android application id (com.notesnap.sheetmusic) used to build the redirect URI. */
function applicationId(): string {
  const cfg = Constants.expoConfig;
  const id =
    (cfg?.android as { package?: string } | undefined)?.package ??
    (cfg?.ios as { bundleIdentifier?: string } | undefined)?.bundleIdentifier;
  return id ?? 'com.notesnap.sheetmusic';
}

/** Redirect URI for the Google OAuth flow (native installed-app convention). */
export function gdriveRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    native: `${applicationId()}:/oauthredirect`,
  });
}

// ─── OAuth flow ───────────────────────────────────────────────

/**
 * Runs the interactive Google OAuth flow (system browser) and stores the
 * resulting tokens. Returns the tokens, or null if the user cancelled.
 */
export async function connectGDrive(): Promise<OAuthTokens | null> {
  if (!isGDriveConfigured()) {
    throw new Error(
      'Google Drive sync is not configured yet. Add EXPO_PUBLIC_GOOGLE_CLIENT_ID (and EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID) and rebuild.'
    );
  }

  const clientId = googleConfig.androidClientId;
  const redirectUri = gdriveRedirectUri();
  const request = new AuthSession.AuthRequest({
    clientId,
    scopes: GDRIVE_SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });

  const result = await request.promptAsync(DISCOVERY);
  if (result.type !== 'success' || !result.params.code) {
    return null;
  }

  const response = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code: result.params.code,
      redirectUri,
      extraParams: request.codeVerifier
        ? { code_verifier: request.codeVerifier }
        : undefined,
    },
    DISCOVERY
  );

  const tokens: OAuthTokens = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken ?? undefined,
    expiresAt: response.expiresIn
      ? Date.now() + response.expiresIn * 1000
      : undefined,
  };
  await saveStoredTokens('gdrive', tokens);
  return tokens;
}

/** Clears the stored Google session and the cached app-folder id. */
export async function disconnectGDrive(): Promise<void> {
  await clearStoredTokens('gdrive');
  await AsyncStorage.removeItem(FOLDER_ID_KEY);
}

// ─── Token management (with refresh) ──────────────────────────

async function refreshGDriveTokens(
  refreshToken: string
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: googleConfig.androidClientId,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    if (res.status === 400 && (data.error === 'invalid_grant' || data.error === 'invalid_client')) {
      await clearStoredTokens('gdrive');
      throw new NotConnectedError('gdrive');
    }
    throw new Error(data.error_description ?? data.error ?? 'Google refresh failed.');
  }
  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
  };
  await saveStoredTokens('gdrive', tokens);
  return tokens;
}

/**
 * Returns a valid Google access token, refreshing first if expired.
 * Throws NotConnectedError when there is no session or the refresh was
 * rejected.
 */
export async function getGDriveAccessToken(): Promise<string> {
  const tokens = await getStoredTokens('gdrive');
  if (!tokens || !tokens.accessToken) {
    throw new NotConnectedError('gdrive');
  }
  if (!isTokenExpired(tokens)) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new NotConnectedError('gdrive');
  }
  const refreshed = await refreshGDriveTokens(tokens.refreshToken);
  return refreshed.accessToken;
}

// ─── API calls (Drive API v3) ─────────────────────────────────

async function driveFetch<T>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body && typeof init.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason =
      (data as { error?: { message?: string } }).error?.message ??
      (data as { error?: string }).error ??
      `Google Drive request failed (HTTP ${res.status}).`;
    throw new Error(reason);
  }
  return data as T;
}

/** Finds or creates the app folder and caches its id. */
export async function gdriveEnsureFolder(token: string): Promise<string> {
  const cached = await AsyncStorage.getItem(FOLDER_ID_KEY);
  if (cached) return cached;

  const query = encodeURIComponent(
    `name='${CLOUD_APP_FOLDER}' and mimeType='${FOLDER_MIME}' and trashed=false`
  );
  const list = await driveFetch<{ files: { id: string; name: string }[] }>(
    `${DRIVE}/files?q=${query}&fields=files(id,name)&spaces=drive`,
    token
  );
  if (list.files.length > 0) {
    await AsyncStorage.setItem(FOLDER_ID_KEY, list.files[0].id);
    return list.files[0].id;
  }

  const created = await driveFetch<{ id: string }>(`${DRIVE}/files`, token, {
    method: 'POST',
    body: JSON.stringify({ name: CLOUD_APP_FOLDER, mimeType: FOLDER_MIME }),
  });
  await AsyncStorage.setItem(FOLDER_ID_KEY, created.id);
  return created.id;
}

interface DriveFileEntry {
  id: string;
  name: string;
  size?: string;
  mimeType?: string;
}

/** Lists the files directly inside the app folder. */
export async function gdriveListFiles(token: string): Promise<CloudFileRef[]> {
  const folderId = await gdriveEnsureFolder(token);
  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const list = await driveFetch<{ files: DriveFileEntry[] }>(
    `${DRIVE}/files?q=${query}&fields=files(id,name,size,mimeType)&pageSize=500&spaces=drive`,
    token
  );
  return list.files.map((f) => ({
    name: f.name,
    id: f.id,
    sizeBytes: f.size ? Number(f.size) : 0,
  }));
}

/** Downloads a Drive file (alt=media) to `destUri`. */
export async function gdriveDownload(
  token: string,
  fileId: string,
  destUri: string
): Promise<void> {
  const download = await FileSystem.downloadAsync(
    `${DRIVE}/files/${fileId}?alt=media`,
    destUri,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (download.status !== 200) {
    throw new Error(`Google Drive download failed (HTTP ${download.status}).`);
  }
}

/**
 * Uploads a local file into the app folder with the given name. Uses
 * uploadType=media (raw bytes via expo-file-system) followed by a PATCH to
 * set the name and parent folder.
 */
export async function gdriveUpload(
  token: string,
  name: string,
  fileUri: string,
  mimeType: string
): Promise<void> {
  const folderId = await gdriveEnsureFolder(token);
  const upload = await FileSystem.uploadAsync(
    `${UPLOAD}/files?uploadType=media`,
    fileUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType,
      },
    }
  );
  const created = upload.body ? JSON.parse(upload.body) : null;
  if (upload.status !== 200 || !created?.id) {
    throw new Error(`Google Drive upload failed (HTTP ${upload.status}).`);
  }
  await driveFetch(`${DRIVE}/files/${created.id}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ name, parents: [folderId] }),
  });
}

/** MIME type used when uploading a file with the given extension. */
export function mimeTypeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'musicxml':
      return 'application/vnd.recordare.musicxml+xml';
    case 'mxl':
      return 'application/vnd.recordare.musicxml';
    case 'mid':
    case 'midi':
      return 'audio/midi';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}
