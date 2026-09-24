/**
 * useHardwareBack — the Android hardware-BACK handler for the app's IN-PLACE
 * full-screen flows.
 *
 * Why this exists (owner-reproduced on device, 09-23): "Streak day → featured
 * piece → sheet music page → BACK → the app exits".
 *
 * v22 fixed the same class for `<Modal>` surfaces (`onRequestClose` — see
 * src/services/modalBackContract.ts), but the app has a second family of
 * full-screen surfaces: flows that are NOT routes and NOT modals. They replace
 * their host tab's entire body (`if (showDetail) return <PieceDetailScreen …/>`
 * in HomeScreen / HistoryScreen / FindPieceScreen / HumSearchScreen), so the
 * route never changes — the root stack still has exactly one route ("Tabs").
 * When nothing consumes the BACK press:
 *
 *   1. the in-place flow's `onBack`/`onClose` is never called (the button is the
 *      only way out, and the hardware key does nothing on that screen), and
 *   2. React Navigation receives the press on its LAST route, has nothing to pop,
 *      and finishes the activity — the app "exits".
 *
 * The fix is one subscription per in-place flow; src/services/backExitContract.ts
 * is the guard that keeps the whole class from coming back (it reads the app's
 * own source, so it needs no emulator).
 *
 * `onBack` MUST return `true` — that is React Native's "I consumed this press"
 * signal, and returning false would fall through to the exiting behaviour this
 * hook exists to prevent. It is called only for a press the app should handle.
 *
 * Focus gating: React Navigation keeps blurred tab screens mounted, so a flow
 * left behind on another tab would otherwise keep swallowing BACK on the tab the
 * user is actually looking at (a worse bug than the one being fixed). The
 * subscription is live only while the owning route — the tab that renders the
 * flow — is focused, and it is removed on blur and on unmount.
 *
 * Android-only by design: `hardwareBackPress` is an Android key event. On iOS the
 * interactive swipe-back + the on-screen "← Back" affordance are the exits.
 */
import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/**
 * Handle the Android hardware BACK press while this flow is on screen.
 *
 * @param onBack   Runs on a BACK press. Return `true` when the press was handled
 *                 (always, for these flows) so React Native does not fall
 *                 through to the default behaviour of finishing the activity.
 * @param enabled  Set false to stand down (e.g. the flow is not the active
 *                 surface). Defaults to true.
 */
export function useHardwareBack(onBack: () => boolean, enabled = true): void {
  // Latest handler without re-subscribing on every render (the flow's state
  // changes constantly while it is open — a stale closure here would close the
  // wrong surface).
  const handler = useRef(onBack);
  useEffect(() => {
    handler.current = onBack;
  });

  const isFocused = useIsFocused();
  const active = enabled && isFocused;

  useEffect(() => {
    if (!active || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => handler.current(),
    );
    return () => subscription.remove();
  }, [active]);
}
