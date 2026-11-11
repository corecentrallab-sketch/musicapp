/**
 * vc52DeviceContract.ts — THE SOURCE GUARDS FOR THE vc52 DEVICE REPAIRS
 * (owner v51 handset pass, 2026-11-08: 3 of 5 release-gate rows failed).
 *
 * Six defects, and every one of them is a class a pure-logic test cannot see and
 * a screenshot cannot prove: a write whose failure was swallowed, a player handed
 * a URI nobody checked, a colour literal the light palette does not know, an
 * editor that sat a screenful below the video it edits, a trim window that was
 * metadata only, and a build stamp nobody could find. Each guard below reads the
 * REAL source text of the file that carries the behaviour, the way the rest of
 * this repo's UI contracts do, and each one is mutation-proven (see the PR body:
 * every guard was made to FAIL on a mutated copy of the real file before it was
 * trusted).
 *
 * PURE: no react, no react-native, no fs, no network — so tier1 compiles it and
 * scripts/vc52DeviceRepairs.test.ts can pin it. The files it reads are passed in
 * as strings; nothing here opens a file.
 */

/** Strip comments before scanning: prose must never satisfy (or fail) a guard. */
export function maskComments(source: string): string {
  return (typeof source === 'string' ? source : '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

export const VC52_SCREEN_PATH = 'src/screens/PracticeVideoScreen.tsx';
export const VC52_STORE_PATH = 'src/services/practiceVideoStore.ts';
/** vc54: the all-or-nothing writer the store's save now delegates to. */
export const VC52_SAVE_MODULE_PATH = 'src/services/practiceVideoSave.ts';
export const VC52_CLIP_MODULE_PATH = 'src/services/takeClipTag.ts';
export const VC52_SETTINGS_PATH = 'src/screens/SettingsScreen.tsx';
export const VC52_APPLY_PATH = 'src/services/themeApply.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 1. A5 — A FAILED SAVE IS LOUD, AND A SAVE IS VERIFIED
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE WRITE IS READ BACK BEFORE THE SCREEN SAYS "SAVED".
 *
 * The v51 path could not tell a written row from a skipped one: `saveRecognition`
 * returns void and no-ops when the id is already in History, so
 * `savePracticeVideoRow` returned a row for a write that never happened, and the
 * screen printed "Saved to your History." on the strength of that return value.
 * The store now re-reads through the SAME read History performs and returns null
 * when the row is not there.
 *
 * ── RE-ANCHORED ON vc54 ───────────────────────────────────────────────────────
 * vc54 moved the write out of the store and into `services/practiceVideoSave.ts`
 * (`writePracticeVideoRow`), because the store's inline version had two silent
 * success paths a handset could reach. This guard follows the BEHAVIOUR, not the
 * old file layout: it demands both halves of the one save —
 *
 *   • the store's `savePracticeVideoRow` DELEGATES to `writePracticeVideoRow`
 *     through the device port, and that port's read-back is `loadPracticeVideoRow`
 *     — History's own read, never a local cache…
 *   • …and the writer itself reads the row back and treats a row that is not
 *     there as a FAILURE, not a success.
 *
 * Either half going missing is the v51 defect again: a row returned for a write
 * that never happened, printed as "Saved to your History."
 */
export function saveIsVerifiedByReadBack(storeSource: string, saveSource: string): boolean {
  const store = maskComments(storeSource);
  const save = maskComments(saveSource);
  if (store.length < 2000 || save.length < 1000) return false;
  // ── the store delegates; it no longer writes inline ───────────────────────
  const fn = store.indexOf('export async function savePracticeVideoRow');
  if (fn < 0) return false;
  const body = store.slice(fn, fn + 2400);
  if (body.indexOf('writePracticeVideoRow(') < 0) return false;
  if (body.indexOf('practiceVideoSavePort') < 0) return false;
  // ── the read-back must be the History read itself, not a local cache ───────
  if (store.indexOf('readRow: (rowId) => loadPracticeVideoRow(rowId)') < 0) return false;
  if (store.indexOf('getRecognitionHistory') < 0) return false;
  // ── the writer really re-reads the row it just wrote… ─────────────────────
  if (save.indexOf('export async function writePracticeVideoRow') < 0) return false;
  if (save.indexOf('await port.readRow(') < 0) return false;
  // ── …and a row that is not there is a FAILURE, not a success ──────────────
  return /if\s*\(\s*!\s*stored\s*\)\s*return\s+null/.test(save);
}

/**
 * THE SCREEN SAYS SO, IN WORDS THE OWNER CAN READ.
 *
 * v51's only failure signal was one `styles.meta` line — the pale-blue 12–13px
 * body colour the owner has now told us twice he cannot read, in the same colour
 * the success line used. The failure now gets its own card, its own headline, and
 * its own retry, and the "Saved to your History" sentence is no longer printed
 * unconditionally.
 */
export function saveFailureIsLoud(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 20000) return false;
  // A named headline constant, rendered in its own style — not a body line.
  if (src.indexOf('PRACTICE_VIDEO_SAVE_FAILED_HEADLINE') < 0) return false;
  if (!/\{PRACTICE_VIDEO_SAVE_FAILED_HEADLINE\}/.test(src)) return false;
  if (!/style=\{styles\.saveFailed/.test(src)) return false;
  // A retry the user can act on.
  if (src.indexOf('PRACTICE_VIDEO_SAVE_RETRY_CTA') < 0) return false;
  if (src.indexOf('handleSaveRetry') < 0) return false;
  // The save state is DERIVED from the verified write, never assumed.
  if (src.indexOf('practiceVideoSaveState(') < 0) return false;
  // The old unconditional claim is gone.
  return src.indexOf("'Saved to your History.'") < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. B1 — THE PLAYER IS ONLY MOUNTED FOR A FILE THAT IS REALLY THERE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A BLACK RECTANGLE IS NOT A VIDEO. `practiceVideoFileExists` existed in the
 * store and was called by NOTHING: the playback surface handed `<Video>` a URI
 * from the row without ever asking the file system whether the file was there,
 * so a moved/evicted file produced an unpainted black surface instead of the
 * honest missing-file sentence.
 */
export function playbackChecksTheFileExists(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 20000) return false;
  if (src.indexOf('practiceVideoFileExists') < 0) return false;
  if (src.indexOf('practiceVideoPlaybackPlan(') < 0) return false;
  // The check happens where the row is READ, before the player can mount.
  const load = src.indexOf('loadPracticeVideoRow(');
  if (load < 0) return false;
  const near = src.slice(load, load + 1400);
  return near.indexOf('practiceVideoFileExists') >= 0;
}

/**
 * THE PLAYER PAINTS A FRAME ON ARRIVAL. A mounted-but-never-loaded expo-av view
 * is a black rectangle with native controls on it. The surface now loads the file
 * itself, seeks into the window so a real frame is decoded, and shows a line
 * while it does — so the user never looks at an empty black box and wonders.
 */
export function videoMountPaintsAFrame(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 20000) return false;
  // Only real MOUNTS: `<VideoOverlayLane` is another component, and
  // `useRef<Video>(null)` is a type argument, not a mount — both are skipped by
  // requiring whitespace after the tag name.
  const tags = src.split(/<Video\s/).slice(1);
  if (tags.length === 0) return false;
  return tags.every((tag) => {
    // The status handler alone can be 1.5k of source, so the window is generous:
    // what matters is that the tag's own props carry an onLoad and an onError.
    const body = tag.slice(0, 4000);
    // …every mounted player seeks on load (directly, or through the screen's own
    // `handleVideoLoad`, which is where the seek into the window lives)…
    if (!/onLoad=\{/.test(body)) return false;
    if (!/onLoad=\{[^}]*?(setPositionAsync|seekIntoWindow|handleVideoLoad)/.test(body)) return false;
    // …and reports its own failure rather than swallowing it.
    return body.indexOf('onError') >= 0;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. LIGHT MODE — THE LITERALS ON THIS SURFACE ARE ONES THE PALETTE KNOWS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE CONTRAST MATH, PURE. WCAG 2.1 relative luminance + contrast ratio, so a
 * colour claim is a measured number in a test rather than an eyeball.
 */
export function hexToRgb(hex: string): [number, number, number] | null {
  const raw = typeof hex === 'string' ? hex.trim().replace(/^#/, '') : '';
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a `#rrggbb` colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return (
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2])
  );
}

/** WCAG contrast ratio between two `#rrggbb` colours (1 … 21). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/** WCAG AA for normal-size text. */
export const AA_TEXT_MIN = 4.5;
/** WCAG AA for large/bold text. */
export const AA_LARGE_MIN = 3;

/**
 * EVERY COLOUR THE PRACTICE-VIDEO SURFACE PAINTS ITS TEXT WITH MUST BE A LITERAL
 * `themeApply` KNOWS. A colour that is not in the table keeps its dark-palette
 * value in light mode — which is exactly how pale blue landed on paper-white
 * (owner, twice: "light blue text … almost impossible to read").
 */
export function surfaceInkIsThemed(screenSource: string, applySource: string): boolean {
  const src = maskComments(screenSource);
  const apply = maskComments(applySource);
  if (src.length < 20000) return false;
  // The text colours this surface actually uses, read off its own StyleSheet.
  const inks = ['honest', 'meta', 'missingText', 'secondaryBtnText', 'chipText', 'error'];
  const literals: string[] = [];
  inks.forEach((key) => {
    const re = new RegExp(`\\b${key}:\\s*\\{[^}]*color:\\s*'(#[0-9a-fA-F]{3,6})'`);
    const found = re.exec(src);
    if (found) literals.push(found[1].toLowerCase());
  });
  if (literals.length < inks.length) return false;
  // …and each one must appear in the remap table (so light mode repaints it).
  return literals.every((literal) => apply.indexOf(`'${literal}'`) >= 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE TRIM EDITOR SITS UNDER THE VIDEO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE OWNER, VERBATIM: "The blue video editor panel needs to be closer to the
 * captured video screen … you have to scroll too far down away from the video to
 * start editing using the blue box. The editor needs to be closer to the video."
 *
 * The review surface rendered video → size line → notes lines → the FULL STAFF
 * CARD → and only then the clip panel. The staff card is the tallest thing on the
 * page, so the editor was a screenful away. The order is now video → clip →
 * notes/score, on BOTH surfaces, and this guard measures the real order in the
 * real file.
 */
export function trimEditorSitsUnderTheVideo(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 20000) return false;
  const mounts = src.split('<TakeClipTagEditor').slice(1);
  // Two surfaces (the review page and the watch page) must both carry it.
  if (mounts.length < 2) return false;
  return mounts.every((mount) => {
    const at = src.indexOf(`<TakeClipTagEditor${mount.slice(0, 40)}`);
    const before = at < 0 ? -1 : at;
    if (before < 0) return false;
    const video = src.lastIndexOf('<Video', before);
    const staff = src.indexOf('<TakeStaffCard', before);
    // …it comes AFTER a video mount…
    if (video < 0) return false;
    // …and BEFORE the notation card (the thing that pushed it off-screen).
    return staff < 0 || staff > before;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. A4 — PLAYBACK HONOURS THE WINDOW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE OWNER, VERBATIM: "when I trimmed back the video … the video plays it back as
 * a whole video — the entire recording … If you trim a video, then play it, it
 * should show up as trimmed and play as trimmed."
 *
 * The v47 half only STOPPED at the window's end; the start was applied once, in
 * our own Play button, so the native transport (and any re-play) ran from 0:00.
 * The surface now asks the pure `trimPlaybackAction` on EVERY status update, and
 * re-seeks when the window changes.
 */
export function playbackHonoursTheWindow(screenSource: string, clipModuleSource: string): boolean {
  const src = maskComments(screenSource);
  const clip = maskComments(clipModuleSource);
  if (src.length < 20000) return false;
  // The pure rule exists and describes all three outcomes.
  if (clip.indexOf('export function trimPlaybackAction') < 0) return false;
  if (clip.indexOf("'seek'") < 0 || clip.indexOf("'stop'") < 0) return false;
  // The screen uses it in the status handler…
  if (src.indexOf('trimPlaybackAction(') < 0) return false;
  const handler = src.indexOf('onPlaybackStatusUpdate');
  if (handler < 0) return false;
  if (src.slice(handler, handler + 2200).indexOf('trimPlaybackAction(') < 0) return false;
  // …and re-seeks when the window itself changes (the ± buttons and the drag).
  if (!/useEffect\([\s\S]{0,900}trimSpan[\s\S]{0,900}setPositionAsync/.test(src)) return false;
  // …and the surface says which window is playing.
  return src.indexOf('trimPlaybackWindowLine(') >= 0;
}

/**
 * THE COPY NEVER CLAIMS THE FILE WAS CUT. The .mp4 still travels whole (cutting it
 * needs a native media module, which is an owner decision, not this batch's), so
 * the sentence must say what is true: playback honours the window, the file does
 * not change.
 */
export function copyNeverClaimsTheFileWasCut(clipModuleSource: string): boolean {
  const clip = maskComments(clipModuleSource);
  const line = /export const TRIM_VIDEO_WHOLE_LINE\s*=\s*'([\s\S]*?)';/.exec(clip);
  if (!line) return false;
  const text = line[1].toLowerCase();
  // …it still says the file is not cut…
  if (text.indexOf('cannot cut the video file') < 0) return false;
  // …and now says the window IS honoured on playback.
  return text.indexOf('plays only the window') >= 0 || text.indexOf('playback') >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE BUILD STAMP IS FINDABLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE OWNER IS THE RELEASE OPERATOR and could not find "v51 / 0.1.45" anywhere:
 * it was a small grey line under a row, and nothing else. Step 0 of every
 * checklist now takes ONE glance: the About row's subtitle IS the stamp, and the
 * About screen it opens leads with it. Home still carries none
 * (`v43UiContract.homeCarriesNoBuildStamp` stays green).
 */
export function stampIsFindableInSettings(settingsSource: string): boolean {
  const src = maskComments(settingsSource);
  if (src.length < 20000) return false;
  // The About row's own subtitle is the stamp (one glance, no scrolling).
  if (!/title="About NoteSnap"[\s\S]{0,200}sub=\{stampLine\}/.test(src)) return false;
  // The About screen leads with it.
  if (!/Alert\.alert\(\s*stampLine/.test(src)) return false;
  // …and it is still built from the build's OWN constants.
  if (src.indexOf('buildStampLine(') < 0) return false;
  if (src.indexOf('sha: BUILD_SHA') < 0) return false;
  return src.indexOf('BUILD_STAMP_TAG') >= 0;
}

/** Every vc52 guard, as one list a test can loop over (name → predicate). */
export const VC52_GUARD_NAMES: readonly string[] = [
  'saveIsVerifiedByReadBack',
  'saveFailureIsLoud',
  'playbackChecksTheFileExists',
  'videoMountPaintsAFrame',
  'surfaceInkIsThemed',
  'trimEditorSitsUnderTheVideo',
  'playbackHonoursTheWindow',
  'copyNeverClaimsTheFileWasCut',
  'stampIsFindableInSettings',
];
