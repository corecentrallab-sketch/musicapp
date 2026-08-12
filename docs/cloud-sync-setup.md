# Cloud Sync Setup (Phase 4b)

NoteSnap's cloud sync (Dropbox + Google Drive) is fully implemented but the
OAuth credentials are owned by the app owner. This page is the owner-side
setup checklist. Nothing in the app is stubbed — until the env vars below are
present, the Cloud Sync screen shows an honest "not configured" state.

## Environment variables

Set these at build time (Expo inlines `EXPO_PUBLIC_*`):

| Variable | Required for | Notes |
|---|---|---|
| `EXPO_PUBLIC_DROPBOX_APP_KEY` | Dropbox | Public app key — safe to ship |
| `EXPO_PUBLIC_DROPBOX_APP_SECRET` | Dropbox (optional) | Only if the app is confidential; PKCE works without it |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | Google Drive | Android OAuth client id |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google Drive (iOS) | iOS OAuth client id |

See `.env.example`.

## 1. Dropbox app

1. Go to <https://www.dropbox.com/developers/apps/create> and create an app:
   - **Choose API**: Dropbox API
   - **Choose type**: Scoped access → "App folder" (or Full Dropbox — App
     folder is the least privilege and all sync files live in the app folder)
   - Name it `NoteSnap`.
2. In the app's **Permissions** tab, enable exactly these scopes:
   - `account_info.read`
   - `files.metadata.read`
   - `files.content.read`
   - `files.content.write`
3. In the **Settings** tab, add the OAuth 2 **Redirect URIs**:
   - Standalone/dev builds: `notesnap://oauthredirect`
     (the `notesnap` scheme comes from `app.json` → `"scheme": "notesnap"`).
   - Expo Go development: run `npx expo start` and the console prints the
     `exp://` redirect — register that too if you test in Expo Go.
4. Copy the **App key** to `EXPO_PUBLIC_DROPBOX_APP_KEY` and the **App
   secret** to `EXPO_PUBLIC_DROPBOX_APP_SECRET` (secret optional with PKCE).

Sync folder: `/NotesSnap` at the root of the app's Dropbox (created
automatically on first use).

## 2. Google Cloud OAuth client

1. Go to <https://console.cloud.google.com/apis/credentials> (create a
   project if needed, e.g. "NoteSnap").
2. Enable the **Google Drive API**:
   <https://console.cloud.google.com/apis/library/drive.googleapis.com>
3. Create an OAuth client ID:
   - **Application type**: Android
   - **Package name**: `com.notesnap.app`
   - **SHA-1 signing certificate**: the SHA-1 of the release/debug keystore
     used to sign the build. (`keytool -list -v -keystore <keystore>` shows it.)
   - Copy the client id to `EXPO_PUBLIC_GOOGLE_CLIENT_ID`.
4. For iOS builds create a second client:
   - **Application type**: iOS, **Bundle ID**: `com.notesnap.app`
   - Copy to `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
5. Optional: add a "Desktop" client to test the flow — Google matches native
   clients by client id, so no redirect URI registration is needed for the
   Android/iOS clients.

Scope used: `https://www.googleapis.com/auth/drive.file` (the app can only
see and modify its own "NotesSnap" folder).

## How the sync works

- **Pull**: every file in the cloud folder is compared with the local library
  by filename + size. Missing files are downloaded into the library; a file
  with the same name but different size is overwritten (last-wins, cloud
  version kept — the sync result notes this).
- **Push**: items the user marked "Send to cloud" (long-press in Library) are
  uploaded. If the cloud already has the same name + size, the upload is
  skipped; otherwise the cloud copy is overwritten (last-wins, local version
  kept).
- Scanned scores upload as one file per page (`<title>-page-00N.jpg`) and
  come back as single-page scanned items.

## Testing checklist (needs a device + real credentials)

1. Connect Dropbox → authorize → token stored.
2. Sync Now with an empty cloud folder and an empty library → no-op.
3. Add a PDF to the library, "Send to cloud", Sync Now → file appears in
   /NotesSnap; queue empties.
4. Delete the local item, Sync Now → file pulled back into the library.
5. Edit the cloud file (change size) → Sync Now → local copy overwritten,
   report shows "updated".
6. Repeat 2–5 for Google Drive.
7. Airplane mode → Sync Now → friendly offline error, no crash.
8. Long-press item → Share → system share sheet opens with the file.
