/**
 * v40FixContract.ts — LIVE-SOURCE GUARDS FOR THE v40 FIX BATCH (owner on-device
 * pass 10-14: bugs A–G from the Bohemian-Rhapsody test plus the practice-video
 * round's H, J, K, L).
 *
 * WHY THESE EXIST. There is no emulator on this box, so the tier1 gate is the only
 * thing standing between a fix and the owner's phone. Every bug in this batch was a
 * property of the WIRING (a control that was never mounted, a button that was never
 * gated, a file that was written but never read back), and wiring is exactly what a
 * pure-logic test cannot see. Each guard below reads the REAL file and goes FALSE
 * when the fix is undone:
 *
 *   A  the cover scan drops a garbled OCR line BEFORE anything is chosen from it;
 *   D  the tuner's unit hangs off a VALUE — the idle dial has no "--cents";
 *   F  a cloud-import refusal reaches the card through the shared line, with the
 *      reason and the supported-types sentence appended, never re-assembled there;
 *   G  the History row's Share button exists and is gated on the model's one rule;
 *   H  the take-correction editor mounts ONE listen row, above the editable/
 *      original branch, on the page in BOTH views;
 *   J  the practice-video screen applies its playback session BEFORE the player
 *      mounts and re-applies it on every press of its own transport;
 *   K  every PDF write is READ BACK off disk and must still be the file we wrote,
 *      or the share sheet is never opened;
 *   L  the tab page renders the take in BLOCKS (whole song reachable by scrolling)
 *      with the listen row on the same page.
 *
 * Comments are masked before every check, so a documented-but-absent call can never
 * satisfy a guard. PURE: no react, no react-native, no fs, no network.
 *
 * STANDING RULE (the team's self-match trap): a marker this file looks for must
 * never appear here as one contiguous literal — every marker is built by
 * `marker(...)` (split/join), so a live scan of src/ cannot match this file's own
 * source instead of the file it audits.
 */
import { maskComments } from './modalBackContract';

/** Build a marker from parts: the full token never appears contiguously here. */
function marker(...parts: string[]): string {
  return parts.join('');
}

/** Occurrences of a needle in a source string (for "exactly one" style checks). */
function countOf(source: string, needle: string): number {
  let count = 0;
  let at = source.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = source.indexOf(needle, at + needle.length);
  }
  return count;
}

// ─── THE FILES THIS BATCH OWNS ───────────────────────────────────────────────

export const V40_CONTRACT_PATH = 'src/services/v40FixContract.ts';
export const V40_EDITOR_PATH = 'src/components/TakeCorrectionEditor.tsx';
export const V40_TABS_PATH = 'src/components/TakeTabsView.tsx';
export const V40_HISTORY_PATH = 'src/screens/HistoryScreen.tsx';
export const V40_VIDEO_PATH = 'src/screens/PracticeVideoScreen.tsx';
export const V40_TUNER_METER_PATH = 'src/components/TunerMeter.tsx';
export const V40_CLOUD_SCREEN_PATH = 'src/screens/CloudSyncScreen.tsx';
export const V40_COVER_SCAN_PATH = 'src/services/coverScan.ts';
export const V40_SEND_DEVICE_PATH = 'src/services/takeSendDevice.ts';
export const V40_PDF_PATH = 'src/services/takeNotationPdf.ts';
export const V40_GUITAR_TAB_PATH = 'src/services/guitarTab.ts';
export const V40_LISTEN_MODEL_PATH = 'src/services/takePlayback.ts';
export const V40_CLOUD_IMPORT_PATH = 'src/services/cloudImport.ts';

/** The modules and suites the tier1 gate must compile and run (v40 additions). */
export const V40_TIER1_MODULES: readonly string[] = [
  'src/services/v40FixContract.ts',
  'scripts/v40FixBatch.test.ts',
];
export const V40_TIER1_SUITES: readonly string[] = ['scripts/v40FixBatch.test.ts'];

// ─────────────────────────────────────────────────────────────────────────────
// A — THE COVER SCAN NEVER CHOOSES A GARBLED LINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BUG (owner 10-14): a broken OCR read became the search query and therefore
 * the retailer link. The guard (`isGarbageOcrLine`) now runs on every line BEFORE
 * the title is chosen by evidence, and its verdict takes part in the same skip test
 * as the noise/furniture rules — so a garbled line cannot become the title, the
 * query, or a link.
 */
export function coverScanDropsGarbageBeforeChoosing(scanSource: string): boolean {
  const src = maskComments(scanSource);
  if (src.length < 8000) return false;
  const judged = src.indexOf(marker('const broken = isGarbageOcrLine(', 'cleaned);'));
  const skipped = src.indexOf(
    marker('if (isNoiseLine(cleaned) || isCoverFurnitureLine(cleaned) || broken)'),
  );
  if (judged < 0 || skipped < 0) return false;
  if (judged > skipped) return false;
  return src.indexOf(marker('garbled += 1;')) >= 0;
}

/**
 * A, THE HALF THAT WAS STILL LEAKING (round 4). A read carrying ONE glued token — the
 * owner's on-device "thy,Be- I'm Freddie Mercurycause" — used to pass this guard,
 * because a line was written off only when TWO of its tokens were affected, so the
 * nonsense string became the query with `garbled: 0`. The punctuation glued between
 * two LETTERS is now a rule of its own, and it is consulted BEFORE that threshold, so
 * the count can never answer for it again.
 */
export function coverScanWritesOffGluedPunctuationOnItsOwn(scanSource: string): boolean {
  const src = maskComments(scanSource);
  if (src.length < 8000) return false;
  if (src.indexOf(marker('export function hasGluedInner', 'Punctuation(')) < 0) return false;
  const severe = src.indexOf(
    marker('if (tokens.some((token) => hasGluedInner', 'Punctuation(token))) return true;'),
  );
  if (severe < 0) return false;
  const threshold = src.indexOf(marker('const affected = tokens.filter('));
  if (threshold < 0) return false;
  // The carve-out answers FIRST: below the threshold the two-token count would own
  // this case again, which is the bug the owner's device found.
  return severe < threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// D — THE TUNER'S UNIT HANGS OFF A VALUE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BUG (owner 10-14): the idle tuner read "--cents" — a unit with no number.
 * The unit is now part of the VALUE (`tunerCentsReadout` returns `unit: null` when
 * no note is named) and the screen renders it only when it is present.
 */
export function tunerUnitHangsOffItsValue(meterSource: string): boolean {
  const src = maskComments(meterSource);
  if (src.length < 1000) return false;
  if (src.indexOf(marker('const readout = tunerCentsReadout(reading);')) < 0) return false;
  if (
    src.indexOf(
      marker(
        '{readout.unit ? <Text style={styles.centsUnit}>{readout.unit}</Text> : null}',
      ),
    ) < 0
  ) {
    return false;
  }
  // A unit printed next to a placeholder (the old bug) is simply not there.
  return src.indexOf(marker('centsUnit}>{TUNER_CENTS_SUFFIX}')) < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// F — THE CLOUD REFUSAL REACHES THE CARD, WITH ITS REASON
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BUG (owner 10-14): a `.jpg` was refused and the card said nothing at all.
 * The outcome line (`cloudImportOutcomeLine`) now APPENDS the file layer's own
 * reason and the supported-types sentence, and the screen renders THAT line through
 * the card's own alert — the screen never re-assembles the refusal wording, so the
 * copy cannot drift from the model the tests read.
 */
export function cloudRefusalReachesTheCard(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 5000) return false;
  if (src.indexOf(marker('cloudImportOutcomeLine(', 'outcome)')) < 0) return false;
  if (src.indexOf(marker('Alert.alert(')) < 0) return false;
  // The hand-built zero-import wording is gone…
  if (src.indexOf(marker('0 files are in your Library')) >= 0) return false;
  // …and the reason is appended by the model, not re-read here.
  return src.indexOf(marker('firstError')) < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// G — HISTORY'S SHARE BUTTON IS REAL AND GATED
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BUG (owner 10-14): a saved take could not be shared from History (the sheet
 * existed, nothing opened it). The row now carries a Share button GATED on the
 * model's one rule (`shareTakeOffered`), opened out of the press event, and mounts
 * the one send-to sheet at the screen root with the screen's OWN MIDI export handed
 * to it — one MIDI path, never a second copy.
 */
export function historyShareIsGatedOnTheModel(historySource: string): boolean {
  const src = maskComments(historySource);
  if (src.length < 20000) return false;
  const gate = src.indexOf(marker('{shareTakeOffered(', 'item.capture) ? ('));
  const cta = src.indexOf(marker('SHARE_TAKE_CTA'));
  const sheet = src.indexOf(marker('<TakeSendToSheet'));
  const openMarker = marker('requestAnimationFrame(() => setSendTake(item))');
  const open = src.indexOf(openMarker);
  if (gate < 0 || cta < 0 || sheet < 0 || open < 0) return false;
  // The button AND the press that opens the sheet live inside the gate's block.
  const block = src.slice(gate, gate + 1200);
  if (block.indexOf(marker('SHARE_TAKE_CTA')) < 0) return false;
  if (block.indexOf(openMarker) < 0) return false;
  // …and the sheet is mounted after it, at the screen root, with the one MIDI path.
  if (sheet < gate) return false;
  return src.indexOf(marker('onSendMidi={() => (sendTake ? handleExportTake(sendTake)')) >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// H — THE EDITOR MOUNTS THE ONE LISTEN ROW, IN BOTH VIEWS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE OWNER'S ASK (10-14), verbatim: "there needs to be a Play your Take button …
 * There is also a 'Play this Version' button needed for the quantized version. Both
 * versions need to be heard."
 *
 * THE PROPERTY. The editor builds exactly ONE listen row (a second row would be a
 * second pair of players that can drift), from the editor's own two engines, and
 * mounts it OUTSIDE the editable/original branch — so the view switch can hide the
 * lane, the chords and the batch fixes, and must never be able to hide the two
 * playback controls. The tab page is handed that very same node.
 *
 * WHERE "OUTSIDE" IS — REVISED BY UX ROUND 1 STEP 2 (owner's "Corrections" ask,
 * 10-18). Fix H put the row ABOVE the branch; the restructure moved the same row
 * BELOW it, into the new "Listen & Send" group, because listening is the
 * verification of a finished pass (spec ux-round-1/correct-your-take-spec.md §3).
 * The property is unchanged and so is the row's markup — the row is still mounted
 * once, still outside the branch, still on the page in BOTH views. This check now
 * asserts that placement: the node is still built before the branch, and the mount
 * is past the read-only arm (never inside the EDITABLE arm, which is the arm the
 * view switch can hide) and above the sticky save bar.
 *
 * The one thing this form cannot see is a mount wedged into the few lines that
 * close the read-only arm; that case is covered by the round-1 group guard
 * (scripts/takeGroupRestructure.test.ts), which requires the row to render inside
 * the "Listen & Send" group, between the two group headers.
 */
export function takeEditorMountsTheOneListenRow(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 20000) return false;
  const node = src.indexOf(marker('const listenRow = ('));
  const row = src.indexOf(marker('<TakeListenRow'));
  const player = src.indexOf(marker('useTakeClipPlayer('));
  const branch = src.indexOf(marker('{editable ? ('));
  const mount = src.indexOf(marker('{', 'listenRow', '}'));
  const prop = src.indexOf(marker('listenRow', '={listenRow}'));
  const tabs = src.indexOf(marker('<TakeTabsView'));
  const readOnlyArm = src.indexOf(marker(') : ('));
  const switchBack = src.indexOf(marker('Switch to ${EDITOR_VIEW_CORRECTED_CTA}'));
  const saveBar = src.indexOf(marker('styles.', 'saveBar'));
  if (node < 0 || row < 0 || player < 0 || branch < 0) return false;
  if (mount < 0 || prop < 0 || tabs < 0) return false;
  if (readOnlyArm < 0 || switchBack < 0 || saveBar < 0) return false;
  // ONE row.
  if (countOf(src, marker('<TakeListenRow')) !== 1) return false;
  // Built before the branch, mounted OUTSIDE it: on the page in BOTH views.
  if (node > branch) return false;
  if (mount < readOnlyArm) return false;
  if (mount < switchBack) return false;
  if (mount > saveBar) return false;
  // The mount is the row's own node, not only the prop handed to the tab page.
  if (mount > prop) return false;
  // …and that prop really belongs to the tab page's own mount.
  if (prop < tabs) return false;
  // The recording's own availability is decided by the model, one source plays at
  // a time, and a closed editor is never left playing.
  if (src.indexOf(marker('takePlaybackAvailable(')) < 0) return false;
  if (src.indexOf(marker('if (!preview.playing) stopClip();')) < 0) return false;
  return src.indexOf(marker('if (!visible) stopClip();')) >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// J — THE PRACTICE VIDEO APPLIES ITS SESSION BEFORE IT PLAYS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BUG (owner 10-14): "Watch your practice video won't play in either viewing
 * screen + no audio". The only session restore sat in the player's own ready
 * callback, which never fires before the first press (and never at all when the
 * file cannot be decoded), while this screen is reached straight from a filming
 * session that left the app in its RECORDING session.
 *
 * THE PROPERTY. The session is restored by an effect that runs as soon as the phase
 * IS playback — before the player mounts — and re-applied on every press of the
 * screen's own transport, which loads the file when it is not loaded and puts every
 * failure into a sentence plus the app-wide diagnostics.
 */
export function practiceVideoAppliesItsSessionBeforePlayback(screenSource: string): boolean {
  const src = maskComments(screenSource);
  if (src.length < 8000) return false;
  const effect = src.indexOf(marker("if (phase !== 'playback') return undefined;"));
  const restore = src.indexOf(marker('void restorePlaybackAudioMode();'));
  const mount = src.indexOf(marker('<Video', '\n'));
  if (effect < 0 || restore < 0 || mount < 0) return false;
  // The effect restores it, and the player is mounted AFTER it.
  if (restore < effect) return false;
  if (restore > mount) return false;
  const toggle = src.indexOf(marker('const toggleVideo = useCallback(async () => {'));
  if (toggle < 0) return false;
  // The window covers the WHOLE toggle callback. v41 routed the load/play through
  // the guarded `playWithAudioFocus` (audio-focus root cause), which lengthened the
  // body past the old 1600-char window and pushed `reportAudioFailure(` out of it.
  const body = src.slice(toggle, toggle + 3000);
  if (body.indexOf(marker('ensurePlaybackAudioMode()')) < 0) return false;
  if (body.indexOf(marker('loadAsync(')) < 0) return false;
  if (body.indexOf(marker('VIDEO_PLAYBACK_FAILED_LINE')) < 0) return false;
  if (body.indexOf(marker('reportAudioFailure(')) < 0) return false;
  // …and the transport is really on the surface.
  return src.indexOf(marker('onPress={() => void toggleVideo()}')) >= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// K — THE FILE WE HAND OVER IS THE FILE WE WROTE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BUG (owner 10-14): a take shared from Correct your Take "arrived in Gmail but
 * won't open". The BYTES this app builds were proven sound off device, so the one
 * seam left is the device write. Both PDF paths (share, and the email attachment)
 * now read the file back off disk after writing it, and the pure verdict
 * (`takePdfReadBackProblem`) must say the header is still at byte 0, the length is
 * the same and the bytes are the same — otherwise the share sheet is never opened
 * and the user gets the honest sentence instead.
 */
export function takeShareVerifiesTheWrittenFile(sendSource: string): boolean {
  const src = maskComments(sendSource);
  if (src.length < 3000) return false;
  // The pure verdict is really used, on bytes really read back off the device.
  if (src.indexOf(marker('takePdfReadBackProblem(')) < 0) return false;
  if (src.indexOf(marker('readTakeFileBase64(')) < 0) return false;
  if (src.indexOf(marker('readAsStringAsync(')) < 0) return false;
  const write = marker('const fileUri = await write(name, bytes);');
  const verify = marker('verifyWrittenTakePdf(');
  const refuse = marker('if (problem) {');
  const share = marker('await share(fileUri');
  let at = src.indexOf(write);
  let paths = 0;
  while (at >= 0) {
    const block = src.slice(at, at + 900);
    const atVerify = block.indexOf(verify);
    const atRefuse = block.indexOf(refuse);
    const atShare = block.indexOf(share);
    // Both facts, in order: written → proven on disk → refused on mismatch → shared.
    if (atVerify < 0 || atRefuse < 0 || atShare < 0) return false;
    if (atVerify > atRefuse || atRefuse > atShare) return false;
    paths += 1;
    at = src.indexOf(write, at + write.length);
  }
  return paths === 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// L — THE TAB PAGE SHOWS THE WHOLE TAKE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BUG (owner 10-14): "Tabs … does not show the whole song played". The old grid
 * was ONE text line per string, as wide as the take — off the right edge of a phone,
 * so every note after the first screenful read as missing. The page now renders the
 * take in BLOCKS (each note in exactly one block, in order), with the listen row on
 * the same page so the whole take can be read AND heard.
 */
export function takeTabsRendersEveryBlock(tabsSource: string): boolean {
  const src = maskComments(tabsSource);
  if (src.length < 2000) return false;
  const windows = src.indexOf(marker('tabWindows(layout)'));
  const count = src.indexOf(marker('tabWindowCount(layout)'));
  const map = src.indexOf(marker('windows.map((window)'));
  const lines = src.indexOf(marker('window.lines.map('));
  const caption = src.indexOf(marker('TAB_WINDOWS_CAPTION'));
  const row = src.indexOf(marker('{', 'listenRow', '}'));
  const branch = src.indexOf(marker('{tabHasNotes(layout) ? ('));
  if (windows < 0 || count < 0 || map < 0 || lines < 0) return false;
  if (caption < 0 || row < 0 || branch < 0) return false;
  if (map < windows || lines < map) return false;
  // The listen row is on the page whether or not the take has notes.
  if (row > branch) return false;
  // The single horizontal strip is gone: the blocks are the only grid.
  return src.indexOf(marker('tabLines(layout)')) < 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GATE ITSELF
// ─────────────────────────────────────────────────────────────────────────────

/** Both tier1 lists must name this round's new module and suite, or nothing runs. */
export function tier1ListsTheV40Fixes(tsconfigSource: string, packageSource: string): boolean {
  if (typeof tsconfigSource !== 'string' || typeof packageSource !== 'string') return false;
  if (tsconfigSource.length < 2000 || packageSource.length < 500) return false;
  for (const module of V40_TIER1_MODULES) {
    if (tsconfigSource.indexOf(`"${module}"`) < 0) return false;
  }
  for (const suite of V40_TIER1_SUITES) {
    const compiled = suite.replace(/\.ts$/, '.js');
    if (packageSource.indexOf(`/tmp/tier1-test/${compiled}`) < 0) return false;
  }
  return true;
}
