/**
 * withWifiNotRequired — declares android.hardware.wifi as an OPTIONAL feature.
 *
 * THE DEFECT THIS PREVENTS (Play refused vc62): this app never declared
 * `<uses-feature android:name="android.hardware.wifi">`, but it does hold
 * `android.permission.ACCESS_WIFI_STATE` (pulled in by a dependency). Play
 * infers `android.hardware.wifi` as a REQUIRED feature from that permission, so
 * every device that reports no wifi hardware (wifi-less tablets, some TV and
 * emulator images) was filtered out of the listing and could not install.
 *
 * Nothing in this app needs a wifi radio — ACCESS_WIFI_STATE is read for a
 * connectivity hint only — so wifi is optional: declare it `required="false"`
 * with `tools:node="replace"` so the merged manifest keeps OUR declaration and a
 * library that later declares wifi `required="true"` cannot win the merge. The
 * `xmlns:tools` prefix is declared here because `tools:node` is meaningless (and
 * aapt2 rejects the file) without it.
 *
 * CAMERA AND MICROPHONE STAY REQUIRED, ON PURPOSE: this app films practice takes
 * and listens to music playing around you, so a device without them is not a
 * supported device. This plugin does not touch them — Play's inference from
 * CAMERA / RECORD_AUDIO keeps both required, and the release verifier asserts it.
 *
 * @param {import('@expo/config-types').ExpoConfig} config
 * @return {import('@expo/config-types').ExpoConfig}
 */
const { withAndroidManifest } = require('@expo/config-plugins');

/** The feature Play infers from ACCESS_WIFI_STATE, and the one we make optional. */
const WIFI_FEATURE = 'android.hardware.wifi';
/** The namespace `tools:node` lives in. */
const TOOLS_NAMESPACE = 'http://schemas.android.com/tools';

const withWifiNotRequired = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest) {
      throw new Error('withWifiNotRequired: the merged AndroidManifest is missing');
    }
    manifest.$ = manifest.$ || {};
    // tools:node="replace" needs its prefix declared on <manifest>.
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = TOOLS_NAMESPACE;
    }

    const existing = Array.isArray(manifest['uses-feature']) ? manifest['uses-feature'] : [];
    const kept = existing.filter(
      (feature) => !(feature && feature.$ && feature.$['android:name'] === WIFI_FEATURE),
    );
    kept.push({
      $: {
        'android:name': WIFI_FEATURE,
        'android:required': 'false',
        'tools:node': 'replace',
      },
    });

    // <uses-feature> must be written BEFORE <application>, so rebuild the key
    // order instead of appending the array at the end of the manifest object.
    const ordered = {};
    let placed = false;
    for (const key of Object.keys(manifest)) {
      if (key === 'uses-feature') continue;
      if (key === 'application' && !placed) {
        ordered['uses-feature'] = kept;
        placed = true;
      }
      ordered[key] = manifest[key];
    }
    if (!placed) ordered['uses-feature'] = kept;
    cfg.modResults.manifest = ordered;
    return cfg;
  });

module.exports = withWifiNotRequired;
module.exports.WIFI_FEATURE = WIFI_FEATURE;
