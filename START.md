# NoteSnap — Android Quick Start

## First run
1. Install Android Studio (SDK platform-tools + emulator) and create an AVD (the launcher prefers `Pixel_8_Pro`).
2. Install Node.js, then run `npm install` in this folder.
3. Double-click `start-android.bat`.
4. The script locates the SDK, boots the emulator, builds/installs the Expo dev client on the first run, and starts Metro with `--dev-client`. Native compilation can take 2–5 minutes; later launches reuse the APK.
5. Complete onboarding. Android asks for notification permission once; allow it to receive the 6pm streak reminder. You can change this in Settings.

## Development workflow
- Edit TypeScript/React Native files and rely on Metro fast refresh.
- Press `r` in Metro to reload, or Ctrl+C to stop it.
- `npm run android-dev` starts Metro in dev-client mode when the native app is already installed.
- Sheet music practice time starts when the viewer opens and is saved when it closes. Home displays today's minutes and the weekly goal counts actual practice days.

## Troubleshooting
| Problem | Fix |
|---|---|
| Could not find Android SDK | Install Android Studio or set `ANDROID_HOME` / `ANDROID_SDK_ROOT` to the SDK directory. |
| No Android Virtual Devices found | Android Studio → Device Manager → create and boot an AVD. |
| Emulator does not boot | Launch the AVD manually once, wait for the home screen, then retry. |
| Native build fails | Confirm SDK/NDK and Java are installed, run `npm install`, then retry. The launcher prints the error and falls back to Expo Go mode. |
| Dev client Metro fails | Read the terminal error, stop other Metro servers, run `npm install`, then retry. The launcher automatically attempts `npx expo start` as an Expo Go fallback. |
| App still does not appear | Ensure the emulator is unlocked and connected (`adb devices` shows `device`), then run `npm run android-dev` and press `a` in Metro if needed. |
| Notifications do not arrive | Enable Daily streak nudge in Settings and grant Android notification permission. The nudge is cancelled after practice that day. |

The app works offline for saved content and practice tools after it has loaded; recognition requires a connection.
