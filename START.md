# NoteSnap — Quick Start (Android Emulator)

## One command to launch everything

Double-click **`start-android.bat`** in this folder.

It will:
1. Find your Android SDK and emulator
2. Pick the best available Android Virtual Device (preferring `Pixel_8_Pro`)
3. Start the emulator (or attach to one already running)
4. Wait for Android to finish booting
5. **First run only:** build the expo-dev-client natively (2-5 minutes)
6. Launch the Expo dev server and open NoteSnap on the emulator

## expo-dev-client — no more Expo Go

NoteSnap uses **`expo-dev-client`** instead of Expo Go. This eliminates:

- ❌ Expo Go version-mismatch prompts ("2.32.19 vs 2.32.20")
- ❌ Uninstall-reinstall loops on every launch
- ❌ Broken Metro connections from app reinstalls

The dev client is built **natively onto the emulator** — it's a real Android APK that
stays installed permanently. Hot reloads work exactly as before: press `r` in Metro.

## Prerequisites

- **Android Studio** installed with at least one AVD (Android Virtual Device)
- **Android SDK, NDK, and Java** (required for the one-time native build)
- **Node.js** and **npm** installed
- Run `npm install` once before first launch

## First-time setup

The very first launch triggers a native build (`npx expo run:android`). This:

- Takes **2-5 minutes** (compiling native code)
- Creates an `android/` directory with the native project
- Installs the NoteSnap dev client APK on the emulator

After that, every subsequent launch is instant — the script skips the build step
and goes straight to `npx expo start --dev-client`.

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
