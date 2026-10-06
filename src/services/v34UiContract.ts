/**
 * v34UiContract.ts — THE LIVE-SOURCE GUARDS FOR THE v34 WIRING (the half the
 * gate could not see).
 *
 * The v34 batch's fixes are only real if the SHIPPED SOURCE calls them:
 *   • the diagnostics store is parsed and asserted but nothing RENDERED it
 *     (the lead's review found `grep -c AudioUnavailableChip App.tsx` = 0 — a
 *     store full of reasons and no chip on any screen);
 *   • a play button can call a handler that never touches expo-av;
 *   • an editor can import the drag helpers and still claim every touch.
 * None of those are visible to a pure-logic test, so — exactly like
 * `v33UiContract.ts` (see the `musicapp-tier1-live-scan-suite` skill) — each
 * rule below reads the app's own source text and returns a boolean.
 *
 * PURE: no react, no react-native, no fs. The disk walk lives in
 * scripts/v34UiWiring.test.ts, which also runs live MUTATIONS of the real files
 * to prove each guard bites (a guard that only ever sees healthy source proves
 * nothing — see the `musicapp-guard-mutation-probes` skill).
 *
 * Comments are masked before every check, so a commented-out mount or a
 * documented-but-absent call can never satisfy a guard.
 */
import { maskComments } from './modalBackContract';

/** The chip's own test id — the same string the component stamps on the chip. */
export const AUDIO_CHIP_TEST_ID = 'audio-unavailable-chip';

/** Collapse whitespace so a multi-line JSX pattern can be matched exactly. */
function squash(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

function countOf(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = source.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = source.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * THE FAILURE THE LEAD'S REVIEW FOUND (v34 fix 1c). `appSource` is the REPO-ROOT
 * App.tsx (app.json's `main` — NOT src/App.tsx, which does not exist): the chip
 * must be IMPORTED from the components folder and RENDERED as an element, and it
 * must be rendered inside the SafeAreaProvider the navigator sits in so it
 * overlays every screen and window in the app.
 */
export function audioChipMountedAtAppRoot(appSource: string): boolean {
  const src = maskComments(appSource);
  if (src.length < 800) return false;
  if (src.indexOf("from './src/components/AudioUnavailableChip'") < 0) return false;
  if (src.indexOf('import { AudioUnavailableChip }') < 0) return false;
  const mount = src.indexOf('<AudioUnavailableChip />');
  if (mount < 0) return false;
  const provider = src.indexOf('<SafeAreaProvider>');
  return provider >= 0 && mount > provider;
}

/**
 * The chip is a VIEW of the store, not a decoration: it reads the current failure,
 * subscribes to reports/clears, renders the fixed sentence builder, and its ✕
 * clears.
 */
export function audioChipIsWiredToTheStore(chipSource: string): boolean {
  const src = maskComments(chipSource);
  if (src.length < 800) return false;
  if (src.indexOf('subscribeAudioFailure(') < 0) return false;
  if (src.indexOf('currentAudioFailure()') < 0) return false;
  if (src.indexOf('clearAudioFailure()') < 0) return false;
  if (src.indexOf('audioChipText(') < 0) return false;
  if (src.indexOf(AUDIO_CHIP_TEST_ID) < 0) return false;
  // The unsubscribe the subscribe returns must be RETURNED from the effect, or a
  // dismissed-then-remounted screen keeps a dead listener on the store.
  return /useEffect\(\(\) => \{[\s\S]*return unsubscribe;[\s\S]*?\}, \[\]\)/.test(src);
}

/**
 * The chip never blocks the UI: it renders NOTHING when the audio stack is
 * healthy, it is `pointerEvents="box-none"` (the wrap passes touches through to
 * the screen underneath), and its dismiss control is a real button with a label.
 */
export function audioChipNeverBlocksTheUi(chipSource: string): boolean {
  const src = maskComments(chipSource);
  if (src.indexOf('pointerEvents="box-none"') < 0) return false;
  if (src.indexOf('if (!failure) return null') < 0) return false;
  if (src.indexOf('AUDIO_CHIP_DISMISS_LABEL') < 0) return false;
  // The dismiss target keeps a finger-sized hit area (40dp is the chip's own).
  return src.indexOf('minHeight: 40') >= 0 && src.indexOf('minWidth: 40') >= 0;
}

/**
 * THE ROW'S PLAY BUTTON PLAYS THE CLIP. `historySource` is
 * src/screens/HistoryScreen.tsx: its play control must be a Pressable whose
 * `onPress` calls THIS row's `takePlayer.toggle(...)` — a button that only sets
 * state, or only flips an icon, is the dead-CTA class this app keeps getting bit
 * by (and the owner's device pass heard nothing from exactly this button).
 */
export function historyPlayButtonPlaysTheClip(historySource: string): boolean {
  const src = squash(maskComments(historySource));
  if (src.length < 2000) return false;
  const literal = 'onPress={() => takePlayer.toggle({ id: item.id,';
  if (src.indexOf(literal) < 0) return false;
  // The handler must hand over the row's OWN id AND its own clip — a button that
  // plays the neighbouring row's recording is the same defect with a nicer look.
  return src.indexOf('personalMelody: item.personalMelody') >= 0;
}

/**
 * THE TAKE PLAYER IS A REAL PLAYER. `hookSource` is src/hooks/useTakeClipPlayer.ts:
 * expo-av is imported, the clip is loaded with `Audio.Sound.createAsync`, and the
 * PLAYBACK SESSION IS APPLIED BEFORE THE LOAD — the order is the fix. expo-av
 * reports a play on a session that was never established as success and then
 * plays nothing (on Android the player's volume is 0 while it holds no audio
 * focus), so a createAsync that runs first is the silent button the owner hit.
 */
export function takeClipPlayerUsesRealPlayback(hookSource: string): boolean {
  const src = maskComments(hookSource);
  if (src.indexOf("from 'expo-av'") < 0) return false;
  if (src.indexOf('import { ensurePlaybackAudioMode }') < 0) return false;
  const session = src.indexOf('await ensurePlaybackAudioMode()');
  const load = src.indexOf('await Audio.Sound.createAsync(');
  if (session < 0 || load < 0) return false;
  if (load < session) return false;
  // Every failure leaves the user a sentence AND reaches the app-wide chip.
  if (src.indexOf('reportAudioFailure({') < 0) return false;
  return src.indexOf('sound.unloadAsync()') >= 0;
}

/**
 * THE HUM-ALONG PREVIEW'S PLAY PATH ALSO SETS THE SESSION (the second player).
 * The preview hook (src/hooks/useNotePreview.ts) plays one-shot tones through
 * `loadToneSound`, and the ladder loader that lives in src/services/audioSession.ts
 * is where `ensurePlaybackAudioMode()` is awaited BEFORE the first
 * `Audio.Sound.createAsync`. Both halves are checked, so bypassing either the
 * loader call in the hook or the session call in the loader fails this guard.
 *
 * `audioSession.ts` is not tier1-compiled (it imports expo-av / expo-constants),
 * which is exactly why the check reads its text instead of importing it.
 */
export function previewPlaybackSetsAudioMode(
  hookSource: string,
  sessionSource: string,
): boolean {
  const hook = maskComments(hookSource);
  if (hook.length < 1200) return false;
  if (hook.indexOf('loadToneSound(') < 0) return false;
  if (hook.indexOf('await sound.replayAsync()') < 0) return false;
  if (hook.indexOf('reportAudioFailure({') < 0) return false;

  const session = maskComments(sessionSource);
  const start = session.indexOf('export async function loadToneSound(');
  if (start < 0) return false;
  const body = session.slice(start);
  const mode = body.indexOf('await ensurePlaybackAudioMode()');
  const firstLoad = body.indexOf('Audio.Sound.createAsync(');
  if (mode < 0 || firstLoad < 0) return false;
  return firstLoad > mode;
}

/**
 * THE EDITOR RELOADS THE TAKE THE HOST HOLDS (v34 fix 2 — the blank "Corrected
 * Take" from a History row). The identity of what the model was built from must
 * be tracked, the reload decision must be the pure helper (never an inline
 * `if (!take) return`), the model must be rebuilt from the incoming take, and the
 * reload may not fire under a user with edits in flight — that last part is the
 * helper's own rule, asserted in scripts/v34Fixes.test.ts.
 */
export function editorReloadsTakeFromHost(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.length < 8000) return false;
  if (src.indexOf('shouldReloadEditorModel({') < 0) return false;
  if (src.indexOf('takeIdentityOf(take, rowId)') < 0) return false;
  if (src.indexOf('takeNoteCount(take)') < 0) return false;
  if (src.indexOf('createEditorState(take)') < 0) return false;
  // A reload that does not clear the selection would leave a handle pointing at a
  // note id that no longer exists in the new model.
  return src.indexOf('setSelectedId(null)') >= 0;
}

/**
 * THE DRAG LAYER HANDS THE GESTURE BACK TO THE PAGE (v34 fix 3 — the frozen
 * "Correct Your Take" page). v33's lane claimed the touch on touch-down
 * (`onStartShouldSetPanResponder: () => true`) and froze the scroll; now the lane
 * installs `shouldStartEditorDrag` (which is FALSE, always) on BOTH responders,
 * claims a pitch drag only for vertical intent, a timing drag only for horizontal
 * intent, and the page's own `scrollEnabled` follows `pageScrollEnabledDuringDrag`.
 */
export function editorDragLayerSharesScroll(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.indexOf('pageScrollEnabledDuringDrag(dragging)') < 0) return false;
  if (src.indexOf('shouldCapturePitchDrag(') < 0) return false;
  if (src.indexOf('shouldCaptureEdgeDrag(') < 0) return false;
  const startClaims = countOf(src, 'onStartShouldSetPanResponder: shouldStartEditorDrag');
  if (startClaims < 2) return false;
  // The v33 freeze, verbatim — its return is the whole bug.
  if (src.indexOf('onStartShouldSetPanResponder: () => true') >= 0) return false;
  return src.indexOf('onMoveShouldSetPanResponder: () => true') < 0;
}

/**
 * Every note the user can HEAR must be a note they can correct: the editor's
 * pitch audition goes through the preview hook (`preview.playNote`), which is the
 * same tone path the Hum-Along preview uses. A control that sets pitch without
 * auditioning it leaves the user unable to check their own correction.
 */
export function editorAuditionsThroughThePreview(editorSource: string): boolean {
  const src = maskComments(editorSource);
  if (src.indexOf('useNotePreview(') < 0) return false;
  return countOf(src, 'preview.playNote(') >= 2;
}
