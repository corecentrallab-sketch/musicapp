/**
 * analyticsDevice.ts — THE DEVICE HALF OF THE EVENT LOGGING (v47.2).
 *
 * `services/analytics.ts` is pure: it owns the endpoint, the allowlist, the prop
 * vocabulary, the queue and the transport, but it imports no react-native, no
 * expo and no fs, so the tier1 gate compiles and runs it with `node_modules`
 * absent. THIS file is the only place the two device facts it needs are read:
 *
 *   • LOCAL STORAGE — the app's existing AsyncStorage, where the random install
 *     id is kept between launches (`@notesnap/installId`). No new store, no
 *     second source of identity.
 *   • THE API HOST AND THE BUILD IDENTITY — `getApiBaseUrl()` from services/api
 *     (the same host every other request uses, so the events land on the backend
 *     that is actually deployed) and expo-constants' version/versionCode, which
 *     is what Settings → About already prints.
 *
 * Called ONCE, from App.tsx on mount, immediately before the `app_open` event.
 * Nothing else in the app imports this file: every screen imports `track` from
 * `services/analytics` and never sees a URL, a header or a vendor.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getApiBaseUrl } from './api';
import { configureAnalytics } from './analytics';

/**
 * Wire the analytics module to this device. Idempotent and cheap: it only
 * assigns the config, it starts no timer and sends nothing.
 */
export function initAnalytics(): void {
  const expoConfig = Constants.expoConfig;
  configureAnalytics({
    storage: {
      getItem: (key: string) => AsyncStorage.getItem(key),
      setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
    },
    baseUrl: getApiBaseUrl(),
    // The app's own version and the Android versionCode (what Play really uses).
    appVersion: expoConfig?.version ?? null,
    buildNumber: expoConfig?.android?.versionCode ?? null,
  });
}
