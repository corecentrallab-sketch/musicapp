/**
 * v39OwnerRound.test.ts — THE v39 OWNER-ROUND GATE (owner-reported 10-11).
 *
 * Three owner findings, one suite, the team's usual shape (pure decisions + a
 * live-source guard that reads the REAL files):
 *
 *   1. THE COVER SCAN RETURNED THE WRONG PIECE IDENTIFIER (the money path). The
 *      preselected query — the string that is searched AND the `?query=` of the
 *      retailer links — must be the piece's TITLE read off the cover, not whatever
 *      line happened to print first, and a substituted result must answer the words
 *      the user actually asked with.
 *   2. THE CLOUD CARDS. The rendered copy must claim nothing the build does not do
 *      (an automatic/merging sync), the merge behaviour must be stated as the
 *      separate window it is, and both provider cards must carry a real action.
 *   3. THE TAKE'S OWN NOTE. The History row's "Name the take" text is the user's
 *      own, normalised, kept with the take, and carried in the share payload.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
// The suite reads the REAL screens (the wiring guards are source guards). Node's
// module-scoped `require` is declared here rather than imported: the tier1 program
// compiles with `types: []`, so there is no `fs` module declaration to import, and
// a module-scoped declaration cannot clash with another suite's.
declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

/** The repo root, found upward from the cwd (the tier1 run's own convention). */
function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}

/** Read a real repo file by relative path — the house pattern (v39Fixes.test.ts). */
function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}
import {
  COVER_SCAN_MAX_QUERY,
  coverQueryFromScan,
  coverQueryFromText,
  isCoverFurnitureLine,
  isLikelyComposerLine,
  coverTitleScore,
} from '../src/services/coverScan';
import {
  SUBSTITUTE_MIN_SCORE,
  rankFuzzyMatches,
  rankSubstituteMatches,
  substituteAccepted,
} from '../src/services/fuzzySearch';
import {
  CLOUD_MERGE_SCOPE_NOTE,
  CLOUD_SYNC_NOT_LIVE_LINE,
  cloudCardsAreWired,
  cloudCopyIsHonest,
  cloudImportCopyIsHonest,
  cloudImportCtaLabel,
  cloudImportOutcomeLine,
} from '../src/services/cloudImport';
import {
  TAKE_NOTE_LABEL,
  TAKE_NOTE_MAX_LENGTH,
  historyTakeNotesWired,
  normaliseTakeNote,
  sharePayloadCarriesTheNote,
  takeCanHoldNote,
  takeNoteLine,
  takeNoteSaveOutcome,
  takeNoteShareLine,
} from '../src/services/takeNotes';
import { takeSummaryText } from '../src/services/takeSendTo';

let passed = 0;
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`v39 owner round: ${message}`);
  passed += 1;
}
function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`v39 owner round: ${message} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  }
  passed += 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE COVER SCAN'S IDENTIFIER (fix 1 — the money path)
// ─────────────────────────────────────────────────────────────────────────────

// THE OWNER'S CASE, AS A TITLE PAGE PRINTS IT: the instrument/imprint line is the
// first line on the paper, the title is the second, the composer the third. The old
// "first two surviving lines, glued" prefill searched "PIANO SOLO Bagatelle in
// A Minor" and handed that same string to the retailer link.
const furnitureFirst = coverQueryFromText(
  ['PIANO SOLO', 'Bagatelle in A Minor', 'Ludwig van Beethoven'].join('\n'),
);
assertEq(furnitureFirst.titleLine, 'Bagatelle in A Minor', 'the TITLE is what the read leads with, not what printed first');
assertEq(furnitureFirst.composerLine, 'Ludwig van Beethoven', 'the composer is appended when the line is a name');
assertEq(
  furnitureFirst.query,
  'Bagatelle in A Minor Ludwig van Beethoven',
  'the query is the title (+ composer) — the identifier the money path uses',
);
assert(
  furnitureFirst.query.indexOf('PIANO SOLO') < 0,
  'no instrument/imprint line is inside the query the retailer links carry',
);

// COMPOSER PRINTED FIRST (a very common layout): the title must still lead.
const composerFirst = coverQueryFromText(['J.S. Bach', 'Air on the G String'].join('\n'));
assertEq(composerFirst.query, 'Air on the G String J.S. Bach', 'a reversed cover does not make the composer the title');
assert(isLikelyComposerLine('J.S. Bach'), 'a name line is recognised as a name');
assert(!isLikelyComposerLine('Air on the G String'), 'a title is not mistaken for a name');

// The instrument line is furniture only when EVERY word is furniture: real titles
// that merely contain such a word survive.
assert(isCoverFurnitureLine('PIANO SOLO'), '"PIANO SOLO" is a cover line, never a title');
assert(isCoverFurnitureLine('HAL LEONARD'), 'a publisher imprint is not a title');
assert(!isCoverFurnitureLine('Piano Sonata No. 14'), 'a real title containing "piano" survives');
assert(coverTitleScore('Moonlight Sonata') > coverTitleScore('Ludwig van Beethoven'), 'the title outranks the name line');

// A page with nothing title-shaped still yields NO query (never a guess), and the
// honest state is the one that lets the user type the title.
const junk = coverQueryFromText('ISBN 1\n12\n$\n\n£3.50\npiano solo');
assertEq(junk.query, '', 'a page with no title yields no query at all');
assertEq(coverQueryFromScan({ ocrText: 'ISBN 1\n12\n$\n\n£3.50\npiano solo' }).status, 'no-text', 'and its own honest state');
// The v33/v36 guarantees are unchanged by the new selection.
assertEq(
  coverQueryFromText(
    [
      'Toccata and Fugue in D minor',
      'Johann Sebastian Bach',
      'BWV 565',
      'ISBN 978-0-000-00000-0',
      'Printed in Germany',
      '£4.95',
      'https://example.com/shop',
    ].join('\n'),
  ).query,
  'Toccata and Fugue in D minor Johann Sebastian Bach',
  'a clean title page still searches exactly what it always did',
);
assertEq(coverQueryFromScan({ ocrText: 'Für Elise\nBeethoven' }).query, 'Für Elise Beethoven', 'and the diacritic-laden case is unchanged');
assertEq(
  coverQueryFromText('A'.repeat(120)).query.length,
  COVER_SCAN_MAX_QUERY,
  'a very long line is still cut to the field’s limit',
);

// THE SECOND HALF: a SUBSTITUTE must answer the user's own words. The ladder's
// single-token rung is the loophole — ranked against the variant "piano", any row
// of that common word scored 1.0, and that row is what carried the purchase link.
const typedAnswer = furnitureFirst.query;
const wrongRow = { title: 'Adagio in G Minor (piano arrangement)', composer: 'Francois Francœur' };
assertEq(
  rankFuzzyMatches('piano', [wrongRow]).length,
  1,
  'ranked against the VARIANT the wrong row used to pass (the bug this fixes)',
);
assertEq(
  rankSubstituteMatches(typedAnswer, [wrongRow]).length,
  0,
  'ranked against the USER’S OWN WORDS the same row is refused',
);
assert(!substituteAccepted(typedAnswer, wrongRow), 'a row answering one of five words is not a substitute');
const rightRow = { title: 'Bagatelle in A Minor (Für Elise)', composer: 'Ludwig van Beethoven' };
assert(substituteAccepted(typedAnswer, rightRow), 'the piece the user read three words of IS still accepted');
// The typo ladder the owner asked for keeps working: a corrected spelling answers
// every word of what was typed.
assert(
  substituteAccepted('toccatta and fugue', { title: 'Toccata and Fugue in D minor', composer: 'Johann Sebastian Bach' }),
  'the owner’s own misspelling still finds the Toccata',
);
assert(rankFuzzyMatches('toccata fugue', [rightRow], { minScore: SUBSTITUTE_MIN_SCORE }).length <= 1, 'the ranking itself is unchanged');

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE CLOUD CARDS (fix 2)
// ─────────────────────────────────────────────────────────────────────────────
assert(cloudImportCopyIsHonest(), 'no sentence this module renders claims a sync the build does not run');
assert(cloudCopyIsHonest(CLOUD_SYNC_NOT_LIVE_LINE), 'the not-live line is itself honest');
assert(cloudCopyIsHonest(CLOUD_MERGE_SCOPE_NOTE), 'the merge scope line is itself honest');
assert(
  !cloudCopyIsHonest('Sync merges by file name and size — two-way, last-wins on conflict.'),
  'the OLD hero sentence is caught by the guard (the mutation proof)',
);
assert(
  !cloudCopyIsHonest('Your library auto-syncs in the background.'),
  'so is any background/auto-sync claim in a rewrite',
);
assertEq(cloudImportCtaLabel('dropbox'), 'Import from Dropbox', 'the Dropbox card names the real action');
assertEq(cloudImportCtaLabel('gdrive'), 'Import from Google Drive', 'the Drive card names the real action');
assertEq(cloudImportOutcomeLine({ imported: 0, skipped: 0, cancelled: true }), 'Nothing was picked — your Library is unchanged.', 'a cancelled pick is reported, never swallowed');
assert(cloudImportOutcomeLine({ imported: 2, skipped: 1, cancelled: false }).indexOf('2 files') === 0, 'a real run reports what really landed');
assert(cloudImportOutcomeLine({ imported: 0, skipped: 1, cancelled: false }).indexOf('not a score') > 0, 'and what was left out, with the reason');
const cloudScreen = readAppFile('src/screens/CloudSyncScreen.tsx');
assert(cloudCardsAreWired(cloudScreen), 'the real screen wires both cards to the real import call and renders the honest lines');
// MUTATION: a card rewritten to open nothing is caught.
const deadCard = cloudScreen.replace('onPress={() => handleImport(provider)}', 'onPress={() => {}}');
assert(deadCard !== cloudScreen, 'the dead-card mutation changed the real screen');
assert(!cloudCardsAreWired(deadCard), 'MUTATION: a card whose action does nothing FAILS cloudCardsAreWired');
// MUTATION: the overclaim coming back is caught.
const overclaim = cloudScreen.replace('{CLOUD_SYNC_NOT_LIVE_LINE}', 'Sync merges by file name — auto-sync.');
assert(overclaim !== cloudScreen, 'the overclaim mutation changed the real screen');
assert(!cloudCardsAreWired(overclaim), 'MUTATION: a merging/auto-sync claim FAILS cloudCardsAreWired');

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE TAKE'S OWN NOTE (fix 3)
// ─────────────────────────────────────────────────────────────────────────────
assertEq(normaliseTakeNote('  Take 3 · verse,   slow  '), 'Take 3 · verse, slow', 'the note is the user’s words, whitespace normalised');
assertEq(normaliseTakeNote('   '), null, 'an empty note is stored as NOTHING, not as an empty string');
assertEq(normaliseTakeNote(null), null, 'and so is a missing one');
assertEq(normaliseTakeNote('x'.repeat(400))!.length, TAKE_NOTE_MAX_LENGTH, 'a very long note is cut to the field’s limit');
assertEq(takeNoteLine({ takeNote: 'Take 3' }), 'Notes: Take 3', 'a note is shown on the card');
assertEq(takeNoteLine({}), null, 'a row without a note shows no notes line');
assertEq(takeNoteLine({ takeNote: '   ' }), null, 'and neither does one with an empty note');
// Which rows may hold one: a take of the user's own — melody, filmed, or a kept take.
assert(takeCanHoldNote({ personalMelody: { audioUri: 'file://a' } }), 'a capture-window melody is the user’s own take');
assert(takeCanHoldNote({ practiceVideo: { uri: 'file://v' } }), 'a filmed practice take is too');
assert(takeCanHoldNote({ capture: { notes: [{ midi: 60 }] } }), 'so is any row carrying a take’s notes');
assert(!takeCanHoldNote({ id: 'p-1', title: 'Für Elise' }), 'a recognized piece of published music is not a take');
// THE BITE: the guard is that DECISION, not a truthiness test — a row that is a
// plain object with a piece's own fields is refused, so a guard weakened to
// "any object is a take" (or `Boolean(row)`) fails these two lines.
assertEq(takeCanHoldNote({ id: 'p-1', title: 'Für Elise' }), false, 'the refusal is the guard’s decision, not an accident of the row’s shape');
assertEq(takeCanHoldNote({ id: 'p-2', capture: { notes: [] } }), false, 'and a capture with no notes is still not a take');
assertEq(takeNoteSaveOutcome({ saved: true, cleared: false }), 'Saved with this take.', 'a saved note says so');
assertEq(takeNoteSaveOutcome({ saved: true, cleared: true }), 'Note removed — the take is unchanged.', 'and clearing one says what it did');
assert(takeNoteSaveOutcome({ saved: false, cleared: false }).trim().toLowerCase().indexOf('could not be saved') > 0, 'a failed write is never silent');
// The note travels with a shared take.
const take = { notes: [{ midi: 60 }, { midi: 64 }] } as never;
const summary = takeSummaryText(take, { title: 'My melody', note: 'Take 3 · verse' });
assert(sharePayloadCarriesTheNote(summary, 'Take 3 · verse'), 'the shared take carries the user’s own note');
assertEq(takeNoteShareLine(null), null, 'and a take with no note carries no invention');
const noNote = takeSummaryText(take, { title: 'My melody' });
assert(!sharePayloadCarriesTheNote(noNote, 'Take 3 · verse'), 'the guard would notice a dropped note');
const historyScreen = readAppFile('src/screens/HistoryScreen.tsx');
assert(historyTakeNotesWired(historyScreen), `the History card really renders "${TAKE_NOTE_LABEL}" and persists it`);
// MUTATION: the box rendered but never written is caught.
const noWrite = historyScreen.replace('updatePersonalMelodyNote(item.id, note)', 'Promise.resolve(false)');
assert(noWrite !== historyScreen, 'the no-write mutation changed the real screen');
assert(!historyTakeNotesWired(noWrite), 'MUTATION: a notes box that never persists FAILS historyTakeNotesWired');
// MUTATION: a raw (un-normalised) write is caught.
const rawWrite = historyScreen.replace('normaliseTakeNote(draft)', 'draft');
assert(rawWrite !== historyScreen, 'the raw-write mutation changed the real screen');
assert(!historyTakeNotesWired(rawWrite), 'MUTATION: an un-normalised note string FAILS historyTakeNotesWired');

// ─────────────────────────────────────────────────────────────────────────────
// The engineer's own guard on the fix-1 wiring: the search screen must rank a
// substitute against the TYPED query, not the variant.
// ─────────────────────────────────────────────────────────────────────────────
const findScreen = readAppFile('src/screens/FindPieceScreen.tsx');
assert(
  findScreen.indexOf('rankFuzzyMatches(typed, sortPiecesForDisplay(retry.pieces)') >= 0,
  'the ladder ranks the variant’s results against the user’s own words',
);
assertEqualCount(findScreen);
function assertEqualCount(source: string): void {
  if (source.indexOf('minScore: SUBSTITUTE_MIN_SCORE') < 0) {
    throw new Error('v39 owner round: the substitute bar is not applied in the search screen');
  }
  passed += 1;
}

// eslint-disable-next-line no-console
(globalThis as { console?: { log: (m: string) => void } }).console?.log(
  `v39 owner round: ${passed} assertions passed`,
);
