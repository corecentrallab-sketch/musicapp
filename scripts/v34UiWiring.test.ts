/**
 * v34UiWiring.test.ts — LIVE-SOURCE GUARDS for the v34 wiring.
 *
 * The v34 batch's fixes are only real if the SHIPPED source calls them. The
 * lead's review of the first pass found the exact failure this suite exists to
 * prevent: `grep -c AudioUnavailableChip App.tsx` = 0 — the diagnostics store was
 * built, parsed and asserted, and NOTHING rendered it, so every audio failure was
 * still invisible on device.
 *
 * So this suite reads the REAL files (App.tsx at the repo root, HistoryScreen,
 * both players, the editor, the tone loader) and asserts the wiring, with FLOORS
 * so a broken walk cannot pass vacuously. It also runs MUTATIONS of each real file
 * in-memory and asserts every guard FAILS on the mutated text — a guard that has
 * never been seen to fail proves nothing (skill
 * `musicapp-guard-mutation-probes`). The same mutations are applied to the files
 * on disk, with the failing lines captured, by
 * /home/team/shared/v34-followup-probes.py → /home/team/shared/eng-v34-mutation-probes.txt.
 *
 * The guards themselves live in src/services/v34UiContract.ts (pure, tier1
 * compiled). Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  audioChipIsWiredToTheStore,
  audioChipMountedAtAppRoot,
  audioChipNeverBlocksTheUi,
  editorAuditionsThroughThePreview,
  editorDragLayerSharesScroll,
  editorReloadsTakeFromHost,
  historyPlayButtonPlaysTheClip,
  previewPlaybackSetsAudioMode,
  takeClipPlayerUsesRealPlayback,
} from '../src/services/v34UiContract';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;

let passes = 0;
let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes += 1;
    console.log(`  ✓ ${msg}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`);
  }
}
function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}
/** Every .ts/.tsx under src/ — the floor that proves the walk really walked. */
function walkSrc(): string[] {
  const fs = require('fs');
  const path = require('path');
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  visit(path.join(repoRoot(), 'src'));
  return out;
}

const APP = 'App.tsx';
const CHIP = 'src/components/AudioUnavailableChip.tsx';
const HISTORY = 'src/screens/HistoryScreen.tsx';
const TAKE_PLAYER = 'src/hooks/useTakeClipPlayer.ts';
const PREVIEW_HOOK = 'src/hooks/useNotePreview.ts';
const SESSION = 'src/services/audioSession.ts';
const EDITOR = 'src/components/TakeCorrectionEditor.tsx';

const appSource = readAppFile(APP);
const chipSource = readAppFile(CHIP);
const historySource = readAppFile(HISTORY);
const takePlayerSource = readAppFile(TAKE_PLAYER);
const previewHookSource = readAppFile(PREVIEW_HOOK);
const sessionSource = readAppFile(SESSION);
const editorSource = readAppFile(EDITOR);

const srcFiles = walkSrc();

// ── the floor: the walk saw the app ─────────────────────────────
console.log('\nv34 — the live-source walk (floors first)');
assertEq(typeof appSource, 'string', `read ${APP} (${appSource.length} chars)`);
assert(appSource.length > 3000, `read ${APP} (${appSource.length} chars)`);
assert(chipSource.length > 800, `read ${CHIP} (${chipSource.length} chars)`);
assert(historySource.length > 20000, `read ${HISTORY} (${historySource.length} chars)`);
assert(takePlayerSource.length > 3000, `read ${TAKE_PLAYER} (${takePlayerSource.length} chars)`);
assert(previewHookSource.length > 4000, `read ${PREVIEW_HOOK} (${previewHookSource.length} chars)`);
assert(sessionSource.length > 4000, `read ${SESSION} (${sessionSource.length} chars)`);
assert(editorSource.length > 20000, `read ${EDITOR} (${editorSource.length} chars)`);
assert(srcFiles.length >= 25, `the walk found ${srcFiles.length} .ts/.tsx files under src/ (floor 25)`);

// ── the guards pass on the real source ──────────────────────────
console.log('\nv34 fix 1c — the AudioUnavailableChip is MOUNTED, not just built');
assertEq(
  audioChipMountedAtAppRoot(appSource),
  true,
  'the repo-root App.tsx imports AND renders <AudioUnavailableChip /> inside SafeAreaProvider',
);
assertEq(
  audioChipIsWiredToTheStore(chipSource),
  true,
  'the chip subscribes to the store, renders audioChipText, and dismisses via clearAudioFailure',
);
assertEq(
  audioChipNeverBlocksTheUi(chipSource),
  true,
  'the chip renders nothing when healthy and passes touches through (box-none, 40dp dismiss)',
);

console.log('\nv34 — every play button reaches a real player');
assertEq(
  historyPlayButtonPlaysTheClip(historySource),
  true,
  "History's row play button calls takePlayer.toggle({ id: <the row's own id>",
);
assertEq(
  takeClipPlayerUsesRealPlayback(takePlayerSource),
  true,
  'the take player applies the playback session BEFORE loading the clip with expo-av',
);
assertEq(
  previewPlaybackSetsAudioMode(previewHookSource, sessionSource),
  true,
  'the Hum-Along preview plays through loadToneSound, which sets the session before its first play',
);
assertEq(
  editorAuditionsThroughThePreview(editorSource),
  true,
  'the editor auditions every pitch it changes through the same preview hook',
);

console.log('\nv34 fix 2 + 3 — the editor reloads its take and shares the scroll');
assertEq(
  editorReloadsTakeFromHost(editorSource),
  true,
  'the editor calls shouldReloadEditorModel / takeIdentityOf / takeNoteCount and rebuilds from the take',
);
assertEq(
  editorDragLayerSharesScroll(editorSource),
  true,
  'both responders install shouldStartEditorDrag, the axes are split, and scrollEnabled follows the drag',
);

// ── MUTATIONS: each guard must FAIL on the mutated real source ──
console.log('\nv34 — MUTATION PROBES (each guard must bite)');

// MUTATION 1: the chip is never mounted (the exact v34 defect).
const noMount = appSource.replace('      <AudioUnavailableChip />', '      {null}');
assert(noMount !== appSource, 'mutation 1 changed the real App.tsx');
assertEq(
  audioChipMountedAtAppRoot(noMount),
  false,
  'MUTATION: an App.tsx that never renders the chip FAILS audioChipMountedAtAppRoot',
);
// MUTATION 2: imported for its types only — no element.
const importOnly = appSource.replace('<AudioUnavailableChip />', 'null');
assert(importOnly !== appSource, 'mutation 2 changed the real App.tsx');
assertEq(
  audioChipMountedAtAppRoot(importOnly),
  false,
  'MUTATION: an import with no rendered element FAILS audioChipMountedAtAppRoot',
);
// MUTATION 3: the chip renders but never reads the store.
const deafChip = chipSource.replace('subscribeAudioFailure(', 'neverCalled(');
assert(deafChip !== chipSource, 'mutation 3 changed the real chip');
assertEq(
  audioChipIsWiredToTheStore(deafChip),
  false,
  'MUTATION: a chip that does not subscribe FAILS audioChipIsWiredToTheStore',
);
// MUTATION 4: the chip stays on screen after every tone plays (never dismisses).
const stickyChip = chipSource.replace('clearAudioFailure();', 'undefined;');
assert(stickyChip !== chipSource, 'mutation 4 changed the real chip');
assertEq(
  audioChipIsWiredToTheStore(stickyChip),
  false,
  'MUTATION: a chip whose ✕ does not clear the store FAILS audioChipIsWiredToTheStore',
);
// MUTATION 5: the chip swallows touches over the whole app.
const blockingChip = chipSource.replace('pointerEvents="box-none"', 'pointerEvents="auto"');
assert(blockingChip !== chipSource, 'mutation 5 changed the real chip');
assertEq(
  audioChipNeverBlocksTheUi(blockingChip),
  false,
  'MUTATION: a chip that traps touches FAILS audioChipNeverBlocksTheUi',
);
// MUTATION 6: the row's play button is decorative — it goes somewhere else.
const decorativePlay = historySource.replace(
  /onPress=\{\(\) =>\s*takePlayer\.toggle\(\{/,
  'onPress={() => setEditTake({',
);
assert(decorativePlay !== historySource, 'mutation 6 changed the real History screen');
assertEq(
  historyPlayButtonPlaysTheClip(decorativePlay),
  false,
  "MUTATION: a play button that does not call takePlayer.toggle FAILS historyPlayButtonPlaysTheClip",
);
// MUTATION 7: the play button forgets which row it belongs to.
const wrongRow = historySource.replace(
  /onPress=\{\(\) =>\s*takePlayer\.toggle\(\{\s*id: item\.id,/,
  'onPress={() => takePlayer.toggle({ id: item.title,',
);
assert(wrongRow !== historySource, 'mutation 7 changed the real History screen');
assertEq(
  historyPlayButtonPlaysTheClip(wrongRow),
  false,
  'MUTATION: a play button that plays the wrong row FAILS historyPlayButtonPlaysTheClip',
);
// MUTATION 8: the take player never establishes the session (the silent button).
const noSession = takePlayerSource.replace('await ensurePlaybackAudioMode();', 'await Promise.resolve(true);');
assert(noSession !== takePlayerSource, 'mutation 8 changed the real take player');
assertEq(
  takeClipPlayerUsesRealPlayback(noSession),
  false,
  'MUTATION: a take player that skips the playback session FAILS takeClipPlayerUsesRealPlayback',
);
// MUTATION 9: the session is applied AFTER the load (expo-av then plays nothing).
const lateSession = takePlayerSource
  .replace('await ensurePlaybackAudioMode();', '')
  .replace(
    'const { sound } = await Audio.Sound.createAsync(\n            { uri },\n            { shouldPlay: true },\n          );',
    'const { sound } = await Audio.Sound.createAsync(\n            { uri },\n            { shouldPlay: true },\n          );\n          await ensurePlaybackAudioMode();',
  );
assert(lateSession !== takePlayerSource, 'mutation 9 changed the real take player');
assert(
  lateSession.indexOf('await ensurePlaybackAudioMode()') >= 0,
  'mutation 9 kept the session call (it only reordered it)',
);
assertEq(
  takeClipPlayerUsesRealPlayback(lateSession),
  false,
  'MUTATION: a session applied AFTER the load FAILS takeClipPlayerUsesRealPlayback',
);
// MUTATION 10: the preview bypasses the ladder loader (and the session with it).
const previewBypass = previewHookSource.replace('loadToneSound(', 'createSoundDirect(');
assert(previewBypass !== previewHookSource, 'mutation 10 changed the real preview hook');
assertEq(
  previewPlaybackSetsAudioMode(previewBypass, sessionSource),
  false,
  'MUTATION: a preview that skips loadToneSound FAILS previewPlaybackSetsAudioMode',
);
// MUTATION 11: the loader itself stops setting the session.
const loaderNoSession = sessionSource.replace(
  'await ensurePlaybackAudioMode();\n\n  let lastDetail = \'\';',
  'let lastDetail = \'\';',
);
assert(loaderNoSession !== sessionSource, 'mutation 11 changed the real tone loader');
assertEq(
  previewPlaybackSetsAudioMode(previewHookSource, loaderNoSession),
  false,
  'MUTATION: a loader that never sets the session FAILS previewPlaybackSetsAudioMode',
);
// MUTATION 12: the loader sets the session only AFTER every rung has failed.
const loaderLateSession = sessionSource
  .replace("await ensurePlaybackAudioMode();\n\n  let lastDetail = '';", "let lastDetail = '';")
  .replace(
    "  reportAudioFailure({\n    source: 'tone-preview',",
    "  await ensurePlaybackAudioMode();\n  reportAudioFailure({\n    source: 'tone-preview',",
  );
assert(loaderLateSession !== sessionSource, 'mutation 12 changed the real tone loader');
assertEq(
  previewPlaybackSetsAudioMode(previewHookSource, loaderLateSession),
  false,
  'MUTATION: a session set after the first play attempt FAILS previewPlaybackSetsAudioMode',
);
// MUTATION 13: the editor decides reloads inline instead of via the asserted rule.
const inlineReload = editorSource.replace(
  'shouldReloadEditorModel({',
  'Boolean(take) || reloadOnce({',
);
assert(inlineReload !== editorSource, 'mutation 13 changed the real editor');
assertEq(
  editorReloadsTakeFromHost(inlineReload),
  false,
  'MUTATION: an inline reload decision (not the pure rule) FAILS editorReloadsTakeFromHost',
);
// MUTATION 14: the reload forgets the take identity it built the model from.
const noIdentity = editorSource.replace('takeIdentityOf(take, rowId)', 'String(Date.now())');
assert(noIdentity !== editorSource, 'mutation 14 changed the real editor');
assertEq(
  editorReloadsTakeFromHost(noIdentity),
  false,
  'MUTATION: a reload that cannot tell two takes apart FAILS editorReloadsTakeFromHost',
);
// MUTATION 15: the lane claims the touch on touch-down again (the v33 freeze).
const claimsTouchDown = editorSource.replace(
  'onStartShouldSetPanResponder: shouldStartEditorDrag',
  'onStartShouldSetPanResponder: () => true',
);
assert(claimsTouchDown !== editorSource, 'mutation 15 changed the real editor');
assertEq(
  editorDragLayerSharesScroll(claimsTouchDown),
  false,
  'MUTATION: a lane that claims touch-down FAILS editorDragLayerSharesScroll',
);
// MUTATION 16: only ONE of the two responders is fixed (the other still claims).
const halfFixed = editorSource.replace(
  /onStartShouldSetPanResponder: shouldStartEditorDrag/,
  'onStartShouldSetPanResponder: () => true',
);
assert(halfFixed !== editorSource, 'mutation 16 changed the real editor');
assertEq(
  editorDragLayerSharesScroll(halfFixed),
  false,
  'MUTATION: half the fix (one responder still claims touch-down) FAILS editorDragLayerSharesScroll',
);
// MUTATION 17: the page's scroll no longer follows the drag.
const frozenScroll = editorSource.replace(
  'scrollEnabled={pageScrollEnabledDuringDrag(dragging)}',
  'scrollEnabled={!dragging}',
);
assert(frozenScroll !== editorSource, 'mutation 17 changed the real editor');
assertEq(
  editorDragLayerSharesScroll(frozenScroll),
  false,
  'MUTATION: a scroll flag decided inline FAILS editorDragLayerSharesScroll',
);
// MUTATION 18: edits stop auditioning (the user cannot hear a correction).
const silentEdit = editorSource.replace(/preview\.playNote\(/g, 'previewNoop(');
assert(silentEdit !== editorSource, 'mutation 18 changed the real editor');
assertEq(
  editorAuditionsThroughThePreview(silentEdit),
  false,
  'MUTATION: an editor that never auditions a changed pitch FAILS editorAuditionsThroughThePreview',
);

console.log('\nv34 — the guards are not vacuous');
assertEq(audioChipMountedAtAppRoot(''), false, 'an empty source mounts nothing');
assertEq(audioChipMountedAtAppRoot('const x = 1;'), false, 'a tiny source mounts nothing');
assertEq(historyPlayButtonPlaysTheClip(''), false, 'an empty History screen wires no play button');
assertEq(takeClipPlayerUsesRealPlayback(''), false, 'an empty hook plays nothing');
assertEq(previewPlaybackSetsAudioMode('', ''), false, 'empty player sources wire nothing');
assertEq(editorReloadsTakeFromHost(''), false, 'an empty editor reloads nothing');
assertEq(editorDragLayerSharesScroll(''), false, 'an empty editor claims nothing');
assertEq(audioChipIsWiredToTheStore(''), false, 'an empty chip reads nothing');
assertEq(audioChipNeverBlocksTheUi(''), false, 'an empty chip blocks nothing (it is not a chip)');

if (failures > 0) {
  console.error(`\n${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed`);
