# NoteSnap — Quick Start (Android Emulator)

## One command to launch everything

Double-click **`start-android.bat`** in this folder.

It will:
1. Find your Android SDK and emulator
2. Pick the best available Android Virtual Device (preferring `Pixel_8_Pro`)
3. Start the emulator (or attach to one already running)
4. Wait for Android to finish booting
5. Launch the Expo dev server and open NoteSnap on the emulator

## Prerequisites

- **Android Studio** installed with at least one AVD (Android Virtual Device)
- **Node.js** and **npm** installed
- Run `npm install` once before first launch

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not find Android SDK" | Install Android Studio, or set `ANDROID_HOME` to your SDK path |
| "No Android Virtual Devices found" | Open Android Studio → AVD Manager → create a device |
| Emulator times out | Try launching the AVD manually from AVD Manager once, then re-run the script |
| Expo doesn't open | Make sure dependencies are installed: `npm install` |

## Convention

The script looks for an AVD named **`Pixel_8_Pro`** first. If not found, it falls back to whatever AVD you have. Name your AVD `Pixel_8_Pro` in Android Studio for the smoothest experience.
