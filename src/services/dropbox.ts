/**
 * Dropbox sync — Phase 4b.
 *
 * Full OAuth 2 (PKCE, refresh tokens) against the real Dropbox endpoints,
 * plus list/download/upload against the v2 API. Credentials come from
 * EXPO_PUBLIC_DROPBOX_APP_KEY / EXPO_PUBLIC_DROPBOX_APP_SECRET; until the
 * owner supplies them, connectDropbox() refuses with a clear message and the
 * UI shows the "not configured" state.
 *
 * OAuth notes:
 *  - PKCE is used (public client), so the app secret is optional; when one is
 *    configured it is sent, which satisfies confidential apps too.
 *  - `token_access_type=offline` asks Dropbox to return a refresh token
 *    (Dropbox issues short-lived ~4h access tokens by default).
 *  - The redirect URI (`notesnap://oauthredirect` in standalone builds) must
 *    be registered in the Dropbox app console — see docs/cloud-sync-setup.md.
 */
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as FileSystem from 'expo-file-system';
import { dropboxConfig, CLOUD_APP_FOLDER } from './cloudConfig';
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
  authorizationEndpoint: 'https://www.dropbox.com/oauth2/authorize',
  tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
};

const TOKEN_ENDPOINT = 'https://api.dropboxapi.com/oauth2/token';

/** Least-privilege scopes for the NoteSnap sync folder. */
export const DROPBOX_SCOPES = [
  'account_info.read',
  'files.metadata.read',
  'files.content.read',
  'files.content.write',
];

/** Whether the owner has configured a Dropbox app key. */
export function isDropboxConfigured(): boolean {
  return dropboxConfig.isConfigured;
}

/** Redirect URI used for the OAuth flow (register in the Dropbox console). */
export function dropboxRedirectUri(): string {
  // `notesnap://oauthredirect` in standalone/dev builds (scheme from app.json).
  return AuthSession.makeRedirectUri({ path: 'oauthredirect' });
}

// ─── OAuth flow ───────────────────────────────────────────────

/**
 * Runs the interactive Dropbox OAuth flow (opens the system browser) and
 * stores the resulting tokens. Returns the tokens, or null if the user
 * cancelled. Throws with a friendly message when configuration is missing or
 * the exchange fails.
 */
export async function connectDropbox(): Promise<OAuthTokens | null> {
  if (!isDropboxConfigured()) {
    throw new Error(
      'Dropbox sync is not configured yet. Add EXPO_PUBLIC_DROPBOX_APP_KEY (and EXPO_PUBLIC_DROPBOX_APP_SECRET) and rebuild.'
    );
  }

  const redirectUri = dropboxRedirectUri();
  const request = new AuthSession.AuthRequest({
    clientId: dropboxConfig.appKey,
    clientSecret: dropboxConfig.appSecret.trim() || undefined,
    scopes: DROPBOX_SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: { token_access_type: 'offline' },
  });

  const result = await request.promptAsync(DISCOVERY);
  if (result.type !== 'success' || !result.params.code) {
    // Cancelled by the user, or an error page (access_denied etc.).
    return null;
  }

  const response = await AuthSession.exchangeCodeAsync(
    {
      clientId: dropboxConfig.appKey,
      clientSecret: dropboxConfig.appSecret.trim() || undefined,
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
  await saveStoredTokens('dropbox', tokens);
  return tokens;
}

/** Clears the stored Dropbox session. */
export async function disconnectDropbox(): Promise<void> {
  await clearStoredTokens('dropbox');
}

// ─── Token management (with refresh) ──────────────────────────

async function refreshDropboxTokens(
  refreshToken: string
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: dropboxConfig.appKey,
  });
  if (dropboxConfig.appSecret.trim()) {
    params.set('client_secret', dropboxConfig.appSecret.trim());
  }
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    if (res.status === 400 && data.error === 'invalid_grant') {
      await clearStoredTokens('dropbox');
      throw new NotConnectedError('dropbox');
    }
    throw new Error(data.error_description ?? data.error ?? 'Dropbox refresh failed.');
  }
  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
  };
  await saveStoredTokens('dropbox', tokens);
  return tokens;
}

/**
 * Returns a valid Dropbox access token, refreshing it first if the stored one
 * has expired. Throws NotConnectedError when there is no session (or the
 * refresh token was revoked).
 */
export async function getDropboxAccessToken(): Promise<string> {
  const tokens = await getStoredTokens('dropbox');
  if (!tokens || !tokens.accessToken) {
    throw new NotConnectedError('dropbox');
  }
  if (!isTokenExpired(tokens)) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new NotConnectedError('dropbox');
  }
  const refreshed = await refreshDropboxTokens(tokens.refreshToken);
  return refreshed.accessToken;
}

// ─── API calls (Dropbox v2) ───────────────────────────────────

const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

async function postJson<T>(url: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason =
      (data as { error_summary?: string }).error_summary ??
      (data as { error?: { '.tag'?: string } }).error?.['.tag'] ??
      `Dropbox request failed (HTTP ${res.status}).`;
    throw new Error(reason);
  }
  return data as T;
}

/** A file entry returned by list_folder (files only, top level). */
interface DropboxEntry {
  '.tag': string;
  name: string;
  path_display?: string;
  size?: number;
}

/** Ensures the /NotesSnap folder exists (idempotent). */
export async function dropboxEnsureFolder(token: string): Promise<void> {
  try {
    await postJson<{ name: string }>(
      `${API}/files/get_metadata`,
      token,
      { path: `/${CLOUD_APP_FOLDER}` }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    if (!message.includes('not_found')) {
      throw e;
    }
    await postJson(
      `${API}/files/create_folder_v2`,
      token,
      { path: `/${CLOUD_APP_FOLDER}` }
    );
  }
}

/** Lists the files directly inside /NotesSnap (non-recursive). */
export async function dropboxListFolder(token: string): Promise<CloudFileRef[]> {
  await dropboxEnsureFolder(token);
  let cursor: string | null = null;
  const files: CloudFileRef[] = [];
  do {
    const body: Record<string, unknown> = cursor
      ? { cursor }
      : { path: `/${CLOUD_APP_FOLDER}`, recursive: false, limit: 500 };
    const url: string = cursor
      ? `${API}/files/list_folder/continue`
      : `${API}/files/list_folder`;
    const data: {
      entries: DropboxEntry[];
      has_more: boolean;
      cursor?: string;
    } = await postJson(url, token, body);
    for (const entry of data.entries) {
      if (entry['.tag'] === 'file' && entry.path_display) {
        files.push({
          name: entry.name,
          id: entry.path_display,
          sizeBytes: entry.size ?? 0,
        });
      }
    }
    cursor = data.has_more ? (data.cursor ?? null) : null;
  } while (cursor);
  return files;
}

/** Downloads a Dropbox file to `destUri` (via a temporary public link). */
export async function dropboxDownload(
  token: string,
  path: string,
  destUri: string
): Promise<void> {
  const linkData = await postJson<{ link: string }>(
    `${API}/files/get_temporary_link`,
    token,
    { path }
  );
  const download = await FileSystem.downloadAsync(linkData.link, destUri);
  if (download.status !== 200) {
    throw new Error(`Dropbox download failed (HTTP ${download.status}).`);
  }
}

/** Uploads a local file to /NotesSnap/<name> (overwrites existing). */
export async function dropboxUpload(
  token: string,
  name: string,
  fileUri: string
): Promise<void> {
  await dropboxEnsureFolder(token);
  const result = await FileSystem.uploadAsync(
    `${CONTENT}/files/upload`,
    fileUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: `/${CLOUD_APP_FOLDER}/${name}`,
          mode: 'overwrite',
          autorename: false,
          mute: true,
        }),
      },
    }
  );
  if (result.status !== 200) {
    throw new Error(`Dropbox upload failed (HTTP ${result.status}).`);
  }
}
