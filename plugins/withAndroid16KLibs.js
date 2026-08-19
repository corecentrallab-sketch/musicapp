/**
 * Config plugin: force 16 KB-aligned, uncompressed native libraries in the AAB.
 *
 * Android 16 (API 36) devices use 16 KB memory pages. Google Play requires apps
 * targeting SDK 35+ to ship native libs uncompressed and 16 KB-aligned
 * (extractNativeLibs=false path). The Expo SDK 52 prebuild template only wires
 * `expo.useLegacyPackaging` into APK-level `packagingOptions.jniLibs`, which does
 * NOT affect App Bundle packaging — AGP still compresses libs in the AAB
 * (bundle.nativeLibs.useLegacyPackaging defaults to legacy/compressed), which
 * crashes on 16 KB-page devices.
 *
 * This plugin patches the generated android/app/build.gradle to set the AAB-level
 * DSL `bundle { nativeLibs { useLegacyPackaging = false } }`, so AGP (8.5.1+)
 * stores all .so files uncompressed and aligned to 16 KB inside the AAB.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const BUNDLE_BLOCK = `    bundle {
        nativeLibs {
            useLegacyPackaging = false
        }
    }
`;

module.exports = function withAndroid16KLibs(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes('useLegacyPackaging = false')) {
      // Already applied — keep the plugin idempotent.
      return config;
    }
    // Insert the bundle block inside the `android {}` block, right before
    // `androidResources` (present in every Expo SDK 52 app/build.gradle template).
    const anchor = '    androidResources {';
    if (!contents.includes(anchor)) {
      throw new Error(
        'withAndroid16KLibs: could not find "androidResources {" anchor in android/app/build.gradle'
      );
    }
    config.modResults.contents = contents.replace(anchor, `${BUNDLE_BLOCK}${anchor}`);
    return config;
  });
};
