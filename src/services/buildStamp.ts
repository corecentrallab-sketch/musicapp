/**
 * buildStamp.ts — THE ONE LINE THAT SAYS WHICH BUILD IS ON THE PHONE (v43 item B1).
 *
 * THE PROBLEM IT SOLVES. Every owner checklist so far has had a silent failure
 * mode: the tester is not running the build they were told to test (a stale Play
 * closed-test install, a build that never finished uploading). Nothing in the app
 * identified itself, so the only evidence was the tester's memory. From v43 BOTH
 * the Settings → About row and the Home footer rendered `buildStampLine(...)`;
 * v45 (owner 10-26) retired the Home footer copy, so **Settings → About is the
 * one surface** that renders it and step 0 of every checklist is "Settings →
 * About must read the version you were told to test".
 *
 * THE SHAPE IS FIXED, ON PURPOSE:
 *
 *     NoteSnap 0.1.37 (vc43) · 37c67ad
 *     │        │        │      └── the commit (7 chars) — the part a version alone
 *     │        │        │          cannot tell you, because one version can be
 *     │        │        │          uploaded twice
 *     │        │        └───────── the Android versionCode (what Play really uses)
 *     │        └────────────────── the app's own version
 *     └─────────────────────────── the app's name, so a screenshot is self-contained
 *
 * HONESTY RULES (the reason this is a pure function and not a template string in
 * a screen):
 *   • NO "v" DRIFT — the version is printed as `0.1.37`, never `v0.1.37`; a caller
 *     that passes `v0.1.37` gets the prefix stripped, so the line has exactly one
 *     shape and a screenshot can be compared by eye;
 *   • a value the build cannot know is never invented: an unreadable version says
 *     `0.0.0`, an unreadable versionCode says `0`, and a sha that is not a real
 *     7-char hex commit says `unknown` (the placeholder in services/buildSha.ts is
 *     seven zeros, so an unstamped build is visible at a glance).
 *
 * PURE: no react, no react-native, no expo-constants, no fs — provable before a build.
 */

/** The accessibility tag every rendered stamp carries (a source scan keys on it). */
export const BUILD_STAMP_TAG = 'build-stamp';

export interface BuildStampInput {
  /** The app's version (expo-constants `expoConfig.version`). */
  version?: string | number | null;
  /** The Android versionCode (expo-constants `expoConfig.android.versionCode`). */
  versionCode?: string | number | null;
  /** The commit, from services/buildSha.ts (a build-time constant). */
  sha?: string | null;
}

/** What an unreadable version reads as (never a guess at a real one). */
export const BUILD_STAMP_UNKNOWN_VERSION = '0.0.0';
/** What a sha that is not a real commit reads as — exactly 7 chars, like a sha. */
export const BUILD_STAMP_UNKNOWN_SHA = 'unknown';

/** The version, with any leading `v` removed so the line has ONE shape. */
export function buildStampVersion(version: unknown): string {
  const raw =
    typeof version === 'string'
      ? version.trim()
      : typeof version === 'number' && Number.isFinite(version)
        ? String(version)
        : '';
  const stripped = raw.replace(/^[vV]\s*/, '').trim();
  return stripped.length > 0 ? stripped : BUILD_STAMP_UNKNOWN_VERSION;
}

/** The versionCode as digits only (`0` when the build cannot read one). */
export function buildStampVersionCode(versionCode: unknown): string {
  const raw =
    typeof versionCode === 'number' && Number.isFinite(versionCode)
      ? String(Math.floor(versionCode))
      : typeof versionCode === 'string'
        ? versionCode.trim()
        : '';
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.length > 0 ? digits : '0';
}

/** The commit, 7 chars, lowercase hex — or `unknown` when it is not one. */
export function buildStampSha(sha: unknown): string {
  const raw = typeof sha === 'string' ? sha.trim().toLowerCase() : '';
  const hex = raw.replace(/[^0-9a-f]/g, '');
  if (hex.length < 7) return BUILD_STAMP_UNKNOWN_SHA;
  return hex.slice(0, 7);
}

/**
 * THE STAMP: `NoteSnap <version> (vc<versionCode>) · <7-char sha>`.
 * Never throws, never renders an empty string, never invents a version.
 */
export function buildStampLine(input: BuildStampInput | null | undefined): string {
  const version = buildStampVersion(input?.version);
  const versionCode = buildStampVersionCode(input?.versionCode);
  const sha = buildStampSha(input?.sha);
  return `NoteSnap ${version} (vc${versionCode}) · ${sha}`;
}
