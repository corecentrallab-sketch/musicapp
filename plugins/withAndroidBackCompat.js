/**
 * withAndroidBackCompat — restores Android's legacy BACK dispatch, which is what
 * this React Native 0.76 app's whole BACK system is built on.
 *
 * THE BUG THIS PREVENTS (owner-reported blank-white Home page, v22 → v24; the
 * device symptom is "open a sheet → leave it → the Home tab body is blank, and
 * the next BACK exits the app"):
 *
 *   Android's own docs, "Behavior changes: apps targeting Android 16 (API 36)",
 *   section "Migration or opt-out required for predictive back":
 *
 *     "For apps targeting Android 16 (API level 36) or higher and running on an
 *      Android 16 or higher device, the predictive back system animations … are
 *      enabled by default. Additionally, onBackPressed is not called and
 *      KeyEvent.KEYCODE_BACK is not dispatched anymore. … update your app to use
 *      supported back navigation APIs, or temporarily opt out by setting the
 *      android:enableOnBackInvokedCallback attribute to false in the <application>
 *      or <activity> tag of your app's AndroidManifest.xml file."
 *
 *   Note this build targets SDK 36 (app.json → expo-build-properties
 *   android.targetSdkVersion 36) and the app has NO manifest attribute today, so
 *   the platform default applies: no back key events at all.
 *
 *   React Native 0.76.9 has no predictive-back support (no OnBackInvokedCallback
 *   anywhere in its Android sources), so with the default EVERY JS back path in
 *   this app dies:
 *     • `<Modal onRequestClose>` — RN dispatches it from an OnKeyListener on the
 *       dialog window (ReactModalHostView.kt: "onRequestClose callback must be set
 *       if back key is expected to close the modal"), i.e. only from a
 *       KEYCODE_BACK key event. The platform now dismisses the Dialog itself, so
 *       JS never hears about it and the sheet viewer's `showScoreViewer` flag
 *       stays true after the user pressed BACK.
 *     • `BackHandler` / useHardwareBack() — the JS hardwareBackPress event is
 *       raised from the activity's onBackPressed(), which the platform no longer
 *       calls.
 *
 *   Because every sheet-viewer host replaced its ENTIRE body with the viewer
 *   (`return <ScoreViewer …/>`), a viewer flag left true with its dialog already
 *   gone renders a host body with nothing visible in it — an empty body under the
 *   tab header ("Discover" on Home) = the blank white page; the next BACK press
 *   then has nothing to consume and finishes the activity.
 *
 * The app also fixes the structural half (the viewer is now an OVERLAY inside an
 * always-mounted host body — see src/services/backExitContract.ts, the
 * blank-return contract), so a stale viewer flag can never blank a screen again.
 * This plugin fixes the other half: BACK once again reaches JS.
 *
 * Opting out is the migration path the Android docs name explicitly for apps that
 * have not moved to the predictive-back APIs, and it is the correct one for RN
 * 0.76 (which cannot handle OnBackInvokedCallback). The tier1 gate asserts this
 * plugin is still referenced from app.json and still sets the attribute to false —
 * so removing it cannot silently re-break BACK on Android 16.
 *
 * @param {import('@expo/config-types').ExpoConfig} config
 * @return {import('@expo/config-types').ExpoConfig}
 */
const { withAndroidManifest } = require('@expo/config-plugins');

/** The manifest attribute the platform reads to decide how BACK is dispatched. */
const BACK_COMPAT_ATTRIBUTE = 'android:enableOnBackInvokedCallback';

const withAndroidBackCompat = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const application = manifest.application && manifest.application[0];
    if (!application) {
      throw new Error(
        'withAndroidBackCompat: the merged AndroidManifest has no <application> tag to carry ' +
          BACK_COMPAT_ATTRIBUTE,
      );
    }
    application.$ = application.$ || {};
    application.$[BACK_COMPAT_ATTRIBUTE] = 'false';
    return cfg;
  });

module.exports = withAndroidBackCompat;
module.exports.BACK_COMPAT_ATTRIBUTE = BACK_COMPAT_ATTRIBUTE;
