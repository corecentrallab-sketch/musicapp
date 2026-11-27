/**
 * takeLibrarySave — the OWNER'S OPTION A (decision 2026-11-24): a practice video
 * can finally be kept in Library, and both surfaces say what each store holds.
 *
 * WHAT WAS WRONG. Library was written only from four deliberate buttons (Scan, a
 * recognition result, a piece detail page, the editor's save). A practice video
 * had NO route in at all — it landed in History and stayed there — and nothing on
 * either screen said what the difference between the two stores was.
 *
 * THE RULES PINNED HERE:
 *   • a take with notes offers the action; a take with NO notes offers nothing
 *     (there is no score to write, and a button that can only fail is not drawn);
 *   • the saved copy is named by the notation editor's OWN builder
 *     (`transposedCopyTitle`), at offset 0 — a take is saved as it was read, and
 *     the same take cannot be named two different ways by the two doors;
 *   • the ABC written is the line the take card already draws (`takeStaffRows`);
 *   • the write is IDEMPOTENT on the take's row id — `addAbcToLibrary` returns the
 *     row that is already there instead of writing a second copy, and the surfaces
 *     READ the registry so "Saved to library ✓" is never optimistic;
 *   • one shared sentence explains Library vs History, and BOTH screens render it.
 */
import {
  LIBRARY_VS_HISTORY_LINE,
  SAVED_TAKE_TO_LIBRARY_LABEL,
  SAVED_TAKE_TO_LIBRARY_LINE,
  SAVE_TAKE_TO_LIBRARY_LABEL,
  SAVING_TAKE_TO_LIBRARY_LABEL,
  TAKE_LIBRARY_FALLBACK_TITLE,
  takeLibraryAbc,
  takeLibrarySaveBusy,
  takeLibrarySaveLabel,
  takeLibraryTitle,
  takeSaveOffered,
} from '../src/services/takeLibraryModel';
import { transposedCopyTitle } from '../src/services/transposedScore';
import type { SavedCaptureTake } from '../src/services/midiExport';

// The tier1 tsconfig compiles with `types: []`, so there are no Node typings —
// same convention as the repo's other source-scan suites.
declare const require: (name: string) => any;
declare const process: { cwd(): string; exit(code: number): void };
declare const console: { log(...args: unknown[]): void };

const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const root = process.cwd();
function read(rel: string): string {
  return String(fs.readFileSync(path.join(root, rel), 'utf8'));
}
/** Code only: a guard that matches its own explanatory comment guards nothing. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** A read take, as History and the result card hold it. */
const take: SavedCaptureTake = {
  notes: [
    { midi: 60, startSec: 0, durationSec: 0.5 },
    { midi: 62, startSec: 0.6, durationSec: 0.5 },
    { midi: 64, startSec: 1.2, durationSec: 0.8 },
  ],
  tempoBpm: 100,
  durationSec: 2,
  key: { tonic: 0, mode: 'major', correlation: 0.9, confidence: 0.8, label: 'C major' },
  capturedAt: '2026-11-24T00:00:00.000Z',
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('takeLibrary (1/3) — WHICH TAKE CAN BE SAVED, AND WHAT IS WRITTEN');
// ─────────────────────────────────────────────────────────────────────────────

ok('a take with notes is offered the action', takeSaveOffered(take));
// MUTATION: offer the action on a silent take — this fails, and the user gets a
// button whose only possible outcome is a failure.
ok(
  'a take with no notes is offered NOTHING',
  !takeSaveOffered({ ...take, notes: [] }) && !takeSaveOffered(null) && !takeSaveOffered(undefined),
);

const abc = takeLibraryAbc(take);
ok(
  'the saved copy is the ABC the card draws (a real score header, not an empty file)',
  abc !== null && abc.indexOf('X:1') >= 0 && abc.indexOf('K:C') >= 0,
  String(abc),
);
// MUTATION: write an empty score for a silent take — this fails.
ok(
  'a silent take writes no score at all',
  takeLibraryAbc({ ...take, notes: [] }) === null && takeLibraryAbc(null) === null,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('takeLibrary (2/3) — THE NAME COMES FROM THE EDITOR\'S OWN BUILDER');
// ─────────────────────────────────────────────────────────────────────────────

const expected = transposedCopyTitle({ title: 'Practice video', keyLabel: 'C major', offset: 0 });
ok(
  'the title is the editor\'s builder, at offset 0 (a take is not transposed)',
  takeLibraryTitle('Practice video', take) === expected,
  `${takeLibraryTitle('Practice video', take)} vs ${expected}`,
);
ok(
  'the title carries the take\'s own key, so the Library row says which key it is in',
  takeLibraryTitle('Practice video', take).indexOf('C major') >= 0,
  takeLibraryTitle('Practice video', take),
);
// MUTATION: print "undefined" for a row with no name — this fails.
ok(
  'a take with no name still gets a readable title',
  takeLibraryTitle('   ', take).indexOf(TAKE_LIBRARY_FALLBACK_TITLE) === 0,
  takeLibraryTitle('   ', take),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('takeLibrary (3/3) — HONEST STATE, AND THE WIRING ON BOTH SCREENS');
// ─────────────────────────────────────────────────────────────────────────────

ok(
  'the label follows the real state (never "saved" before a write)',
  takeLibrarySaveLabel('idle') === SAVE_TAKE_TO_LIBRARY_LABEL &&
    takeLibrarySaveLabel('saving') === SAVING_TAKE_TO_LIBRARY_LABEL &&
    takeLibrarySaveLabel('saved') === SAVED_TAKE_TO_LIBRARY_LABEL &&
    takeLibrarySaveLabel('error') === SAVE_TAKE_TO_LIBRARY_LABEL,
);
ok(
  'a running or finished save cannot fire again',
  takeLibrarySaveBusy('saving') && takeLibrarySaveBusy('saved') && !takeLibrarySaveBusy('idle'),
);
ok(
  'the split sentence names both stores',
  /History/.test(LIBRARY_VS_HISTORY_LINE) && /Library/.test(LIBRARY_VS_HISTORY_LINE),
  LIBRARY_VS_HISTORY_LINE,
);
ok('the saved line says the copy is kept', /Saved to your Library/.test(SAVED_TAKE_TO_LIBRARY_LINE));

const component = code(read('src/components/TakeSaveToLibraryButton.tsx'));
const historySrc = code(read('src/screens/HistoryScreen.tsx'));
const videoSrc = code(read('src/screens/PracticeVideoScreen.tsx'));
const storeSrc = code(read('src/services/libraryStore.ts'));

// MUTATION: write through a second store — this fails, and Library gains a second
// registry that the Library screen does not read.
ok(
  'the action writes through the EXISTING library store',
  component.indexOf('addAbcToLibrary({') >= 0,
  'TakeSaveToLibraryButton does not call addAbcToLibrary',
);
// MUTATION: drop `takeId` from the write — this fails, and a second tap writes a
// duplicate row.
ok(
  'the write carries the take id, so it is idempotent on the take',
  component.indexOf('takeId,') >= 0 && storeSrc.indexOf('sourceTakeId: takeId') >= 0,
  'the take id does not reach the library row',
);
// MUTATION: assume the tap worked instead of reading the registry — this fails,
// and a take already in the Library offers to save itself again.
ok(
  'the saved state is READ from the registry, never assumed',
  component.indexOf('findLibraryItemByTakeId(takeId)') >= 0,
);
// MUTATION: fall back to a title of its own — this fails, and the two doors name
// the same take differently.
ok(
  'the title comes from the shared model, not from the component',
  component.indexOf('takeLibraryTitle(') >= 0 && component.indexOf('transposedCopyTitle(') < 0,
);
// MUTATION: save with no take id — this fails, and every tap writes a new row.
ok(
  'no take id means no write',
  component.indexOf('if (!takeId || !take) return;') >= 0,
);

// BOTH doors, and the one line on each screen.
ok(
  'the practice-video result card mounts the action on the take\'s own row id',
  videoSrc.indexOf('<TakeSaveToLibraryButton') >= 0 &&
    videoSrc.indexOf('takeId={row?.rowId ?? null}') >= 0,
  'PracticeVideoScreen does not mount the save action',
);
ok(
  'the History row mounts the action on the row id',
  historySrc.indexOf('<TakeSaveToLibraryButton') >= 0 && historySrc.indexOf('takeId={item.id}') >= 0,
  'HistoryScreen does not mount the save action',
);
ok(
  'the practice-video screen says what Library holds versus History',
  videoSrc.indexOf('{LIBRARY_VS_HISTORY_LINE}') >= 0,
  'PracticeVideoScreen does not render the split line',
);
ok(
  'History says what Library holds versus History',
  historySrc.indexOf('{LIBRARY_VS_HISTORY_LINE}') >= 0,
  'HistoryScreen does not render the split line',
);

// The store's own idempotency, as written: an existing row is RETURNED, not
// duplicated. (The write itself needs a device; the rule is visible in the source.)
ok(
  'the store returns the row that is already there instead of writing a second one',
  storeSrc.indexOf('findLibraryItemByTakeId(takeId)') >= 0 &&
    storeSrc.indexOf('if (existing) return existing;') >= 0,
  'addAbcToLibrary does not short-circuit on an existing take',
);
ok(
  'the registry can be read by take id',
  storeSrc.indexOf('export async function findLibraryItemByTakeId(') >= 0,
);

if (failures > 0) {
  console.log(`\ntakeLibrarySave: ${failures} FAILED`);
  process.exit(1);
}
console.log('\ntakeLibrarySave: all passed');
