/**
 * app-links.ts — the one place the site points at the NoteSnap app
 * (SITE WAVE 1b, P4: the "practise this in NoteSnap" CTA loop).
 *
 * The app is pre-launch: Android only, distributed through a Google Play closed
 * test, so the site links to the closed-test opt-in page and says so. There is no
 * iOS build and no production listing to link to — linking to a store page that
 * does not exist would dead-end the visitor, so we do not.
 *
 * Pure constants, no environment: the same URL the recognition demo already
 * used (`RecognitionDemo.tsx`), now shared so the two surfaces cannot drift.
 */

/** Google Play closed-test opt-in ("become a tester") link for the Android app. */
export const PLAY_TEST_URL =
  "https://play.google.com/apps/testing/com.notesnap.sheetmusic";

/** Package name of the Android app, for honest copy ("Android only, for now"). */
export const ANDROID_PACKAGE = "com.notesnap.sheetmusic";

export const APP_NAME = "NoteSnap";

/**
 * What the app adds over the site — the bullets in the CTA. Short, true, and
 * matched to released app functionality (recognition incl. hum/whistle, the
 * practice coach, offline sheets + editor).
 */
export const APP_PROMISE_BULLETS: readonly string[] = [
  "Recognise music playing around you — or hum, whistle or sing the melody",
  "Practice coach: play along and see which notes and rhythms to fix",
  "Offline sheet music, an editor, and PDF/scan import",
];
