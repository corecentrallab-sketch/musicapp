/**
 * THE v46 DEFECT SWEEP — two owner device-pass defects, guarded where they can
 * actually break: in the source the user sees.
 *
 * ── DEFECT A: THE HUM TAKE COULD NOT BE STOPPED ─────────────────────────────
 * The owner's device pass (10-28): "once you provide the small sound sample the
 * recording stays open sampling ambient noise". The stop control EXISTED — it was
 * the last child of the recording face's ScrollView (meter → note strip → "when
 * you stop" → stop), so on a phone it sat under the fold. A live meter with no
 * visible way to end the take reads exactly like a microphone that cannot be
 * switched off.
 *
 * The fix: the stop is DOCKED — the scroll region now ends after the hint and the
 * stop renders in its own footer OUTSIDE it, so it is on screen at any height.
 * That is a LAYOUT contract, and no existing guard can see it: every other suite
 * asks "does the window receive an onStop?" (it always did). `melodyCapture.test.ts`
 * tests the copy; `v33UiWiring.test.ts` tests the flow. None of them can tell a
 * docked stop from a scrolled one.
 *
 * Three predicates hold the fix in place, because the dock alone is not enough:
 *   1. `humStopIsDockedOnTheRecordingFace` — the control exists, is wired to
 *      `onStop`, renders ONCE, and that one render is a footer outside the live
 *      scroller, inside the recording arm of the face ternary only.
 *   2. `humStopHintIsFactualAndDocked` — the line under it (STOP_CTA_HINT) is
 *      exported by the copy module and rendered in the dock, and it still says the
 *      two facts the dock claims: the mic goes off, the melody is kept.
 *   3. `humStopChainReleasesTheMic` — the thing the user actually needs from that
 *      button: `onStop={handleStop}` → `await recorder.stopRecording()` (never
 *      swallowed) → metering interval cleared, recorder released, playback audio
 *      mode restored. Docking the stop is worth nothing if the chain behind it
 *      stops releasing the microphone.
 *
 * ── DEFECT B: "BROWSE WHAT IS FREE NOW" OPENED THE PERSONAL LIBRARY ─────────
 * The Discover surface's free-scores lever was handed `onBrowseLibrary` by its
 * HOST (HomeScreen), and that host's handler was `navigate('Library')` — the
 * user's own saved library, a different screen holding none of the public-domain
 * scores the row promises. The row was right; the DESTINATION was decided two
 * files away by whoever mounted the surface.
 *
 * The fix removes the prop: the destination now lives in the Discover surface
 * itself (`handleBrowseFreeScores` clears the family + query and scrolls the
 * catalog list — the free scores — into view). Three predicates:
 *   4. `freeScoresLeverIsSelfContained` — `onBrowseLibrary` is GONE from
 *      FindPieceScreen (nothing left for a host to re-point), both lever bindings
 *      route to `handleBrowseFreeScores`, that handler's body decides the
 *      destination locally and never navigates, and `testID="free-scores-list"`
 *      addresses the list it scrolls to.
 *   5. `familyFreeRowCallsItsOwnProp` — FamilyScreen declares `onBrowseFreeScores`,
 *      carries no `onBrowseLibrary`, and its free row calls that prop while its
 *      MONEY row still opens the licensed retailer (the money path must not be
 *      collateral damage).
 *   6. `theDoorCannotRepointTheFreeScoresLever` — HomeScreen's `<FindPieceScreen`
 *      mount carries no destination prop at all, and the
 *      `handleBrowseLibraryFromDiscover` handler that sent users to their library
 *      is gone. (Home's `handleBrowseLibraryFromModern` is a DIFFERENT
 *      destination — the modern-song card's own offer — and is untouched.)
 *
 * MASKING. Every predicate reads comment-MASKED source (`maskSource` from
 * services/genreFamilies). Both defects are documented in comments at the exact
 * spots the code changed ("there is deliberately NO `onBrowseLibrary` prop any
 * more"), and documentation is not the bug. Masking also means a commented-out
 * dock or a commented-out binding cannot satisfy a "must be present" half.
 *
 * NOT COVERED HERE (deliberately — one module, one job):
 *   • WHERE the browse block lives, and the door's minimal shape →
 *     services/v46DiscoverHosting.ts;
 *   • the facet chips / money facet wiring → services/frontDoor.ts
 *     (`fragmentEntryPointsAreWired`) and services/frontDoorBands.ts;
 *   • the take's copy, chords and honesty lines → services/melodyCapture.ts.
 */

import { maskSource } from './genreFamilies';

/** The capture window — the surface the docked stop renders on. */
export const CAPTURE_WINDOW_FILE = 'src/components/MelodyCaptureWindow.tsx';
/** The capture window's copy module (STOP_CTA_HINT lives here). */
export const CAPTURE_COPY_FILE = 'src/services/melodyCapture.ts';
/** The hum flow that hosts the window and owns the recorder. */
export const HUM_FLOW_FILE = 'src/screens/HumSearchScreen.tsx';
/** The recorder hook — where "stop" becomes "the mic is off". */
export const RECORDER_HOOK_FILE = 'src/hooks/useAudioRecorder.ts';
/** Discover = FindPieceScreen: the free-scores lever's own home. */
export const FREE_LEVER_FILE = 'src/screens/FindPieceScreen.tsx';
/** The family screen whose free row rides the same lever. */
export const FAMILY_SCREEN_FILE = 'src/components/FamilyScreen.tsx';
/** The minimal door — the host that must no longer decide the destination. */
export const DOOR_FILE = 'src/screens/HomeScreen.tsx';

/** The stop button's testID: the handle any future QA / automation aims at. */
export const STOP_TEST_ID = 'capture-window-stop';
/** The list the lever scrolls to — the FREE scores, addressable. */
export const FREE_LIST_TEST_ID = 'free-scores-list';

/**
 * Take the brace-balanced block that starts at the first `{` after `from`.
 * Strings and template literals are skipped so a `}` inside copy cannot end the
 * block early (the capture window's copy is full of punctuation).
 * Returns '' when there is no block, so every caller can fail closed.
 */
export function braceBlock(source: string, from: number): string {
  if (from < 0 || from >= source.length) return '';
  const open = source.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  let mode: 'code' | 'single' | 'double' | 'template' = 'code';
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (mode !== 'code') {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (
        (mode === 'single' && ch === "'") ||
        (mode === 'double' && ch === '"') ||
        (mode === 'template' && ch === '`')
      ) {
        mode = 'code';
      }
      continue;
    }
    if (ch === "'") mode = 'single';
    else if (ch === '"') mode = 'double';
    else if (ch === '`') mode = 'template';
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return '';
}

/**
 * DEFECT A, half 1 — THE STOP IS DOCKED ON THE RECORDING FACE.
 *
 * FAILS when:
 *   • the stop's `testID` is gone (unaddressable — the gate cannot even find it);
 *   • the tag that carries it no longer has `onPress={onStop}` (a stop that ends
 *     nothing — the dead-CTA class);
 *   • `styles.stopDock` renders more than once (the dock drifted onto another
 *     face, or was duplicated);
 *   • the dock is inside the live scroller (`styles.liveStage`) instead of after
 *     it — the exact regression that put the stop under the fold;
 *   • anything re-opens a scroller between the live scroll's close and the dock;
 *   • the scroller or the dock falls outside the `recording ? ( … ) : ( … )` arm
 *     (the dock showing on the analysing/review faces is the layout regression
 *     the other way), or the dock reappears after that arm.
 *
 * @param windowSource src/components/MelodyCaptureWindow.tsx
 */
export function humStopIsDockedOnTheRecordingFace(windowSource: string): boolean {
  const masked = maskSource(windowSource);
  // Floor: the window is a large file; a truncated read must not pass.
  if (masked.length < 8000) return false;
  // The face the dock belongs to is derived from the phase, not from a prop.
  if (masked.indexOf("const recording = phase === 'recording'") < 0) return false;

  const stopAt = masked.indexOf(`testID="${STOP_TEST_ID}"`);
  if (stopAt < 0) return false;
  // The button's OWN opening tag — not a type argument, not a runaway slice.
  const tagAt = masked.lastIndexOf('<TouchableOpacity', stopAt);
  const tagEnd = masked.indexOf('>', stopAt);
  if (tagAt < 0 || tagEnd < 0) return false;
  const tag = masked.slice(tagAt, tagEnd + 1);
  if (tag.length > 800) return false;
  if (tag.indexOf('onPress={onStop}') < 0) return false;

  // ONE dock in the whole file …
  const dockUses = masked.split('styles.stopDock').length - 1;
  if (dockUses !== 1) return false;
  const dockAt = masked.indexOf('styles.stopDock');

  // … and it is a FOOTER: the live scroller closes BEFORE the dock begins.
  const liveAt = masked.indexOf('styles.liveStage');
  if (liveAt < 0 || liveAt > dockAt) return false;
  const liveCloseAt = masked.indexOf('</ScrollView>', liveAt);
  if (liveCloseAt < 0) return false;
  if (liveCloseAt > dockAt) return false;
  if (liveCloseAt > stopAt) return false;
  // Nothing re-wraps the stop in another scroller on its way to the dock.
  if (masked.slice(liveCloseAt, dockAt).indexOf('<ScrollView') >= 0) return false;

  // The dock is in the RECORDING arm of the face ternary, not on the others.
  const arm = /recording\s*\?\s*\(/.exec(masked);
  if (arm === null) return false;
  const armAt = arm.index;
  const elseAt = masked.indexOf(') : (', armAt);
  if (elseAt < 0) return false;
  if (liveAt < armAt || liveAt > elseAt) return false;
  if (dockAt < armAt || dockAt > elseAt) return false;
  if (stopAt > elseAt) return false;
  // …and no second, stray dock on the idle / analysing / review faces.
  if (masked.indexOf('styles.stopDock', elseAt) >= 0) return false;
  return true;
}

/**
 * DEFECT A, half 2 — THE LINE UNDER THE STOP IS FACTUAL AND SITS IN THE DOCK.
 *
 * FAILS when `STOP_CTA_HINT` is not exported by the copy module, when the window
 * does not render it as the dock's own line (a `{STOP_CTA_HINT}` expression AFTER
 * the dock opens), or when the copy stops naming the two facts the dock claims —
 * the microphone going off and the take being kept. This is what keeps a "pause"
 * or "cancel" refactor from quietly re-describing the same button.
 *
 * @param windowSource src/components/MelodyCaptureWindow.tsx
 * @param serviceSource src/services/melodyCapture.ts
 */
export function humStopHintIsFactualAndDocked(
  windowSource: string,
  serviceSource: string,
): boolean {
  const copy = maskSource(serviceSource);
  if (copy.length < 500) return false;
  const declAt = copy.indexOf('export const STOP_CTA_HINT');
  if (declAt < 0) return false;
  const declEnd = copy.indexOf(';', declAt);
  if (declEnd < 0) return false;
  const declaration = copy.slice(declAt, declEnd + 1);
  if (declaration.length > 400) return false;
  if (!/microphone/i.test(declaration)) return false;
  if (!/kept/i.test(declaration)) return false;

  const masked = maskSource(windowSource);
  if (masked.length < 8000) return false;
  const dockAt = masked.indexOf('styles.stopDock');
  if (dockAt < 0) return false;
  const hintAt = masked.indexOf('{STOP_CTA_HINT}');
  if (hintAt < 0) return false;
  // The hint belongs to the dock: it renders after the dock opens …
  if (hintAt < dockAt) return false;
  // … and it is the FIRST STOP_CTA_HINT render in the file (no stray copy above).
  if (masked.indexOf('{STOP_CTA_HINT}', dockAt) !== hintAt) return false;
  return true;
}

/**
 * DEFECT A, half 3 — THE STOP STILL ACTUALLY RELEASES THE MICROPHONE.
 *
 * The docked button is only worth its pixels if pressing it ends the capture:
 *   • the flow hands the window `onStop={handleStop}`;
 *   • `handleStop` AWAITS `recorder.stopRecording()` and surfaces a failed stop
 *     as its own error stage (never a silent return — the PR #115 rule);
 *   • `stopRecording()` clears the metering interval, releases the recorder and
 *     restores the playback audio mode (a record-mode session left behind is what
 *     makes everything the user taps afterwards silent).
 *
 * @param flowSource src/screens/HumSearchScreen.tsx
 * @param recorderSource src/hooks/useAudioRecorder.ts
 */
export function humStopChainReleasesTheMic(flowSource: string, recorderSource: string): boolean {
  const flow = maskSource(flowSource);
  if (flow.length < 10000) return false;
  if (flow.indexOf('onStop={handleStop}') < 0) return false;
  const stopDecl = flow.indexOf('const handleStop = useCallback');
  if (stopDecl < 0) return false;
  const stopBody = braceBlock(flow, stopDecl);
  if (stopBody === '') return false;
  if (stopBody.indexOf('await recorder.stopRecording()') < 0) return false;
  // A stop that produced nothing is an error the user can act on, never a no-op.
  if (stopBody.indexOf('setStage(\'error\')') < 0) return false;

  const rec = maskSource(recorderSource);
  if (rec.length < 5000) return false;
  const recDecl = rec.indexOf('const stopRecording = useCallback');
  if (recDecl < 0) return false;
  const recBody = braceBlock(rec, recDecl);
  if (recBody === '') return false;
  if (recBody.indexOf('clearInterval(meteringTimerRef.current)') < 0) return false;
  if (recBody.indexOf('await releaseRecording(recording)') < 0) return false;
  if (recBody.indexOf('restorePlaybackAudioMode()') < 0) return false;
  return true;
}

/**
 * DEFECT B, half 1 — THE FREE-SCORES LEVER IS SELF-CONTAINED.
 *
 * FAILS when FindPieceScreen:
 *   • carries `onBrowseLibrary` again in code (the prop a host re-pointed at the
 *     personal Library tab) — the whole point of the fix is that there is nothing
 *     left for a caller to decide;
 *   • loses `testID="free-scores-list"` (the list the lever scrolls to);
 *   • loses either binding of the lever: the Discover row's
 *     `onPress={handleBrowseFreeScores}` or the family screen mount's
 *     `onBrowseFreeScores={handleBrowseFreeScores}`;
 *   • loses the handler, or that handler stops landing on the catalog list
 *     (`scrollToFreeList()`), or starts NAVIGATING somewhere (the destination
 *     moved out of the surface again — which is exactly how B happened).
 *
 * @param findPieceSource src/screens/FindPieceScreen.tsx
 */
export function freeScoresLeverIsSelfContained(findPieceSource: string): boolean {
  const masked = maskSource(findPieceSource);
  if (masked.length < 4000) return false;
  // Floor: this is the surface the search field hangs off.
  if (masked.indexOf('<TextInput') < 0) return false;

  // The caller-injected destination is GONE (comments are masked, so the note
  // explaining its removal is not a hit).
  if (masked.indexOf('onBrowseLibrary') >= 0) return false;

  // The list it lands on is addressable.
  if (masked.indexOf(`testID="${FREE_LIST_TEST_ID}"`) < 0) return false;

  // BOTH lever bindings — the Discover row and the family screen's free row.
  if (masked.indexOf('onPress={handleBrowseFreeScores}') < 0) return false;
  if (masked.indexOf('onBrowseFreeScores={handleBrowseFreeScores}') < 0) return false;

  // ONE handler, deciding the destination here.
  const declAt = masked.indexOf('const handleBrowseFreeScores = useCallback');
  if (declAt < 0) return false;
  const body = braceBlock(masked, declAt);
  if (body === '') return false;
  if (body.indexOf('scrollToFreeList()') < 0) return false;
  if (/navigate\s*\(/.test(body)) return false;
  if (body.indexOf("'Library'") >= 0) return false;
  return true;
}

/**
 * DEFECT B, half 2 — THE FAMILY SCREEN'S FREE ROW CALLS ITS OWN PROP.
 *
 * FAILS when FamilyScreen declares `onBrowseLibrary` again, loses
 * `onBrowseFreeScores`, or when its row tap no longer routes the FREE row to that
 * prop while the MONEY row still opens the licensed retailer — the money path
 * riding the same row must never be collateral damage of this fix.
 *
 * @param familySource src/components/FamilyScreen.tsx
 */
export function familyFreeRowCallsItsOwnProp(familySource: string): boolean {
  const masked = maskSource(familySource);
  if (masked.length < 3000) return false;
  if (masked.indexOf('onBrowseLibrary') >= 0) return false;
  // The prop the Discover surface hands in.
  if (masked.indexOf('onBrowseFreeScores: () => void;') < 0) return false;
  // … destructured by the component.
  if (masked.indexOf('  onBrowseFreeScores,') < 0) return false;
  // … and the row's one tap expression: money → retailer, free → the prop.
  if (masked.indexOf('isMoney && url') < 0) return false;
  if (masked.indexOf('handleOpenRetailer(url) : onBrowseFreeScores()') < 0) return false;
  return true;
}

/**
 * DEFECT B, half 3 — THE DOOR CANNOT RE-POINT THE LEVER.
 *
 * FAILS when HomeScreen still declares `handleBrowseLibraryFromDiscover` (the
 * handler that sent the free-scores row to the personal Library tab), or when its
 * `<FindPieceScreen` mount carries an `onBrowseLibrary` prop again — the two ways
 * the old destination can come back. Home's own `handleBrowseLibraryFromModern`
 * belongs to the modern-song card and is deliberately not banned.
 *
 * @param homeSource src/screens/HomeScreen.tsx
 */
export function theDoorCannotRepointTheFreeScoresLever(homeSource: string): boolean {
  const masked = maskSource(homeSource);
  if (masked.length < 20000) return false;
  const mountAt = masked.indexOf('<FindPieceScreen');
  if (mountAt < 0) return false;
  // The mount's own tag — bounded, so a runaway slice cannot pass by accident.
  const mountEnd = masked.indexOf('/>', mountAt);
  if (mountEnd < 0) return false;
  const mount = masked.slice(mountAt, mountEnd + 2);
  if (mount.length > 1200) return false;
  if (mount.indexOf('onBrowseLibrary') >= 0) return false;
  // The re-point handler itself is gone from the door.
  if (masked.indexOf('handleBrowseLibraryFromDiscover') >= 0) return false;
  return true;
}
