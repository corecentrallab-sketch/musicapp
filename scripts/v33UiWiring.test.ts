/**
 * v33UiWiring.test.ts — tier1 gate for the v33 UI SLICES' WIRING.
 *
 * The v33 model layers are asserted by scripts/v33TakeEditor.test.ts; this suite
 * asserts the screens and components that USE them, by reading the real sources
 * (no emulator exists in this gate — the `musicapp-tier1-live-scan-suite`
 * pattern). Every scanner it calls is also run against a PRE-FIX fixture that
 * MUST fail, so a scanner that cannot fail cannot pass.
 *
 * slice B — the capture page is capture-only (no Save button, no match card, the
 *           ratified action bar, the miss behind its own explicit step).
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  capturePageIsCaptureOnly,
  matchResultsAreOffThePage,
  takeActionBarWired,
} from '../src/services/v33UiContract';
import {
  CAPTURE_ONLY_CHIP_LABEL,
  CAPTURE_ONLY_LINE,
  CORRECT_TAKE_CTA,
  DONE_CTA,
  FIND_THIS_MELODY_CTA,
  RECORD_ANOTHER_CTA,
  SAVED_CHIP_LABEL,
  WHEN_YOU_STOP_ITEMS,
} from '../src/services/melodyCapture';
import { MIDI_EXPORT_LABEL } from '../src/services/midiExport';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

let failures = 0;
let passes = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
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

const WINDOW = 'src/components/MelodyCaptureWindow.tsx';
const FLOW = 'src/screens/HumSearchScreen.tsx';

const windowSource = readAppFile(WINDOW);
const flowSource = readAppFile(FLOW);

console.log('\nslice B — the capture page is CAPTURE-ONLY');
assert(windowSource.length > 8000, `read ${WINDOW} (${windowSource.length} chars)`);
assert(flowSource.length > 8000, `read ${FLOW} (${flowSource.length} chars)`);
assertEq(
  capturePageIsCaptureOnly(windowSource),
  true,
  'the real capture window is capture-only: chip, "When you stop", no Save button, the saved chip',
);
assertEq(
  takeActionBarWired(windowSource),
  true,
  'the real page carries the ratified action bar, in order, each control wired',
);
assertEq(
  matchResultsAreOffThePage(windowSource, flowSource),
  true,
  'no match surface renders on the page; the miss lives behind the explicit step',
);

// The copy itself: the capture-only rule is facts, not a promise.
assert(CAPTURE_ONLY_CHIP_LABEL.indexOf('CAPTURE') >= 0, 'the chip names the capture-only rule');
assert(
  /nothing is matched here/i.test(CAPTURE_ONLY_LINE),
  'the capture-only line says nothing is matched on this page',
);
assert(
  WHEN_YOU_STOP_ITEMS.some((line) => /saved to your history/i.test(line)),
  '"When you stop" states the auto-save (the chip is not the only place it is said)',
);
assert(
  WHEN_YOU_STOP_ITEMS.some((line) => /nothing is matched/i.test(line)),
  '"When you stop" states the no-matching rule',
);
assert(
  WHEN_YOU_STOP_ITEMS.every((line) => !/transcri/i.test(line) || /never a studio/i.test(line)),
  'no "When you stop" line claims a transcription',
);
assert(
  SAVED_CHIP_LABEL.toLowerCase().indexOf('history') >= 0,
  'the saved chip names where the take went (the user has to be told)',
);
assert(
  MIDI_EXPORT_LABEL.length > 0 && FIND_THIS_MELODY_CTA.length > 0 && DONE_CTA.length > 0,
  'the action bar copy exists in the modules the page renders',
);
assert(
  CORRECT_TAKE_CTA.indexOf('pitch') >= 0,
  'the editor door names what it corrects (pitch), not a vague "edit"',
);
assert(RECORD_ANOTHER_CTA.indexOf('Record another') >= 0, 'record-again stays (owner-confirmed)');

// ── MUTATION 1: the v32 page with its Save button and match card ──
const preFixPage = `onSave={handleSave} matchLine={matchLine} onOpenMatch={handlers}
  <Text>{SAVE_MELODY_CTA}</Text><Text>{matchLine}</Text>`;
assertEq(
  capturePageIsCaptureOnly(preFixPage),
  false,
  'MUTATION: the v32 page (Save button, match line) FAILS capturePageIsCaptureOnly',
);
// ── MUTATION 2: the half-fix — the chip is added but Save stays ──
const halfFix = windowSource.replace(
  'export type MelodyWindowPhase',
  'const SAVE_MELODY_CTA = "Save melody";\nexport type MelodyWindowPhase',
);
assert(halfFix !== windowSource, 'the half-fix mutation changed the real source');
assertEq(
  capturePageIsCaptureOnly(halfFix),
  false,
  'MUTATION: adding the chip while keeping Save FAILS capturePageIsCaptureOnly',
);
// ── MUTATION 3: the find button renders but is not wired (the dead CTA) ──
const deadFind = windowSource.replace('onPress={onFindMelody}', 'onPress={undefined}');
assert(deadFind !== windowSource, 'the dead-find mutation changed the real source');
assertEq(
  takeActionBarWired(deadFind),
  false,
  'MUTATION: a "Find this melody" control with no handler FAILS takeActionBarWired',
);
// ── MUTATION 4: the action bar order is shuffled (Done before record-again) ──
const outOfOrder = `<Text>{MIDI_EXPORT_LABEL}</Text><Text>{FIND_THIS_MELODY_CTA}</Text>
  <Text>{DONE_CTA}</Text><Text>{RECORD_ANOTHER_CTA}</Text>
  onPress={onExportMidi} onPress={onFindMelody} onPress={onRecordAgain} onPress={onClose}`;
assertEq(
  takeActionBarWired(outOfOrder),
  false,
  'MUTATION: an action bar with Done before record-again FAILS takeActionBarWired',
);
// ── MUTATION 4b: the bar loses a control entirely (Done deleted) ──
const missingDone = windowSource.split('DONE_CTA').join('RECORD_ANOTHER_CTA');
assert(missingDone !== windowSource, 'the missing-control mutation changed the real source');
assertEq(
  takeActionBarWired(missingDone),
  false,
  'MUTATION: an action bar missing Done FAILS takeActionBarWired',
);
// ── MUTATION 5: the match card comes back onto the page ──
const backOnPage = windowSource.replace(
  'export type MelodyWindowPhase',
  'const matchLine = "x";\nexport type MelodyWindowPhase',
);
assertEq(
  matchResultsAreOffThePage(backOnPage, flowSource),
  false,
  'MUTATION: a match line back on the window FAILS matchResultsAreOffThePage',
);
// ── MUTATION 6: the miss overlay loses its gate (it would show for everyone) ──
const ungated = flowSource.replace('visible={findOpen}', 'visible');
assert(ungated !== flowSource, 'the gate mutation changed the real source');
assertEq(
  matchResultsAreOffThePage(windowSource, ungated),
  false,
  'MUTATION: an ungated miss overlay FAILS matchResultsAreOffThePage',
);
// ── MUTATION 7: the miss card escapes back onto the capture page (outside the
//    Modal — exactly the v32 layout the owner rejected) ──
const escapedCard = flowSource
  .replace('stage === \'no-match\' && outcome && (', 'stage === \'review\' && outcome && (')
  .replace("if (stage === 'no-match') {\n      setFindOpen(true);", 'if (false) {\n      setFindOpen(true);');
assert(escapedCard !== flowSource, 'the page-leak mutation changed the real source');
assertEq(
  matchResultsAreOffThePage(windowSource, escapedCard),
  false,
  'MUTATION: a miss card not reachable through the explicit step FAILS the contract',
);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
