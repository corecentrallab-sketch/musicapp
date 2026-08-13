# NoteSnap Store Submission Guide

This guide covers the first release (version 0.1.0) for Android package ID `com.notesnap.sheetmusic` / iOS bundle ID `com.notesnap.app`. Do not submit until the production AAB/IPA has been tested on real devices and the store screenshots match the shipped build.

## Owner accounts and materials
- Google Play Developer account: $25 one-time registration fee.
- Apple Developer Program account: $99/year.
- A verified developer identity, tax/payment profile where requested, and access to the NoteSnap website.
- Privacy policy: https://site-notesnap.vercel.app/privacy
- Terms: https://site-notesnap.vercel.app/terms
- Store copy: `playstore-listing.md` and `appstore-listing.md`.
- Graphics are in the mobile repo under `assets/playstore/` and `assets/appstore/`.

## Google Play Console
1. Create/sign in to a Play Console developer account and pay the one-time registration fee.
2. Create an app: name **NoteSnap: Sheet Music**, default language English, app type **App**, free pricing. Use package ID `com.notesnap.sheetmusic` when the first AAB is uploaded.
3. Build the production Android bundle from the mobile repo with `eas build --platform android --profile production`. This produces an AAB; download it after the build completes. (This guide does not run builds.)
4. In **Grow users > Store presence > Main store listing**, copy the title, short description, and full description from `playstore-listing.md`. Add the category Music & Audio and the feature graphic `assets/playstore/feature-graphic.png` (1024×500). Upload the three 1080×1920 phone screenshots.
5. In **Policy > App content**, complete the privacy policy URL, ads declaration, app access instructions, target audience/content, and content rating questionnaire. Declare microphone/audio recording clearly: it is used for music recognition and requires user permission. Answer honestly based on the final build.
6. In **Monetize > Products**, configure in-app subscriptions only if the shipped build's billing is ready. If billing is not enabled in this release, leave the app free and do not promise unavailable purchases. Confirm pricing, trial, renewal, and cancellation disclosures before enabling.
7. In **Testing**, upload the AAB to an internal test track. Install it on representative Android devices, test onboarding, microphone permission, recognition, offline library, links, and every export flow. Fix issues before production.
8. Complete the Data safety form from the actual release behavior. Include microphone/audio use and any account, analytics, or cloud-sync data only if the app collects it. Link the privacy policy.
9. Create a production release, upload the tested AAB, add release notes, review all warnings, and submit for review. Choose rollout percentage deliberately; publish when the review is approved.

## Apple App Store Connect
1. Enroll in the Apple Developer Program ($99/year), accept agreements, and create the App Store Connect app record. Use bundle ID `com.notesnap.app` and SKU `notesnap-0-1-0` (or the team's chosen unique SKU).
2. Build the production iOS archive with `eas build --platform ios --profile production`. The production profile auto-increments the iOS build number. Download the IPA and upload it through EAS Submit, Transporter, or Xcode. (This guide does not run builds.)
3. In the app record's **App Information**, choose Music as primary category and Education as secondary, set age rating 4+, and add the privacy policy URL.
4. In **App Store > iOS App**, set name NoteSnap, subtitle, promotional text, description, and keywords from `appstore-listing.md`. Set price to Free. If subscriptions are shipped, configure them in **Monetization > Subscriptions** with accurate trial, renewal, and cancellation terms.
5. Upload the three 6.7-inch iPhone screenshots (1290×2796) from `assets/appstore/screenshots/`. Ensure screenshots depict the current binary and contain no misleading claims or unshipped features.
6. Complete App Privacy details from the actual build: disclose microphone/audio data and whether it is collected, linked, or used for tracking. Declare third-party cloud services or analytics only when present. Provide the privacy policy.
7. Select the uploaded build in the version record, add review notes and a test account if login is required. Explain that microphone access identifies music playing nearby.
8. Test on physical iPhones, then click **Add for Review** and **Submit for Review**. Monitor the resolution center and release the app manually or automatically after approval.

## Final preflight
- Verify version 0.1.0, Android package ID `com.notesnap.sheetmusic` / iOS bundle ID `com.notesnap.app`, icon, microphone permission text, privacy URL, and terms URL.
- Verify all store text reflects the shipped feature set and all claims are accurate.
- Test recognition permission denial/retry, network failure, offline saved library, navigation, and external retailer/legal links.
- Keep source files and store metadata in version control for future releases. Never upload test builds or screenshots showing debug UI.
