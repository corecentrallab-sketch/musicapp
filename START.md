# NoteSnap — Quick Start (Android Emulator)

## One command to launch everything

Double-click **`start-android.bat`** in this folder.

It will:
1. Find your Android SDK and emulator
2. Pick the best available Android Virtual Device (preferring `Pixel_8_Pro`)
3. Start the emulator (or attach to one already running)
4. Wait for Android to finish booting
5. **First run only:** build the native debug APK (2-5 minutes)
6. Launch the Expo dev server and open NoteSnap on the emulator

## Development builds — no expo-dev-client in release

NoteSnap uses **Expo Go** for quick JS-only development. Because the app includes
native modules (react-native-pdf, react-native-blob-util) that Expo Go cannot
load, test those features with a native build instead:

- Quick JS-only iteration: `npx expo start` → open in **Expo Go**
- Full native features (PDF viewer, imports, camera scanning):
  `npx expo run:android` — builds a debug APK with React Native's built-in dev
  support (hot reload works: press `r` in Metro). No expo-dev-client needed.

> **Why was expo-dev-client removed?** The 2026-08-17 release security audit
> found expo-dev-client's native code (dev-launcher/dev-menu) compiled into the
> production AAB, which also pulled the `SYSTEM_ALERT_WINDOW` and `DUMP`
> permissions into the merged manifest. A release build must not ship the dev
> menu, so the dependency was dropped (see PR — security audit). Restore it
> from git history if the dev-client workflow is ever wanted again.

## Prerequisites

- **Android Studio** installed with at least one AVD (Android Virtual Device)
- **Android SDK, NDK, and Java** (required for the one-time native build)
- **Node.js** and **npm** installed
- Run `npm install` once before first launch

## First-time setup

The very first launch triggers a native build (`npx expo run:android`). This:

- Takes **2-5 minutes** (compiling native code)
- Creates an `android/` directory with the native project
- Installs a debug NoteSnap APK on the emulator

After that, every subsequent launch is instant — the script skips the build step
and goes straight to `npx expo start`.

If you ever clean your build output (`android/app/build/`), the script will
automatically rebuild on the next run.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not find Android SDK" | Install Android Studio, or set `ANDROID_HOME` to your SDK path |
| "No Android Virtual Devices found" | Open Android Studio → AVD Manager → create a device |
| Emulator times out | Try launching the AVD manually from AVD Manager once, then re-run the script |
| Native build fails | Ensure Android SDK, NDK, and Java are installed. Open the project's `android/` folder in Android Studio to let it sync Gradle, then try again |
| Expo doesn't open | Make sure dependencies are installed: `npm install` |

## Convention

The script looks for an AVD named **`Pixel_8_Pro`** first. If not found, it falls back to whatever AVD you have. Name your AVD `Pixel_8_Pro` in Android Studio for the smoothest experience.
