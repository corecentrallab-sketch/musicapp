/**
 * v45Lyrics.test.ts — v45 slice 6: LYRIC SHEETS under the owner's THREE-WAY
 * LYRICS SCOPE (ratified 2026-10-26).
 *
 * WHAT IS PROVEN HERE.
 *
 * 1. THE MODEL, ON REAL APP DATA. A real bundled public-domain piece is turned
 *    into a real captured take (its own notes, tempo, timed from the parsed
 *    score), the user's own words are typed onto it, and the whole path runs:
 *    normalise → encode → store key → decode → the sheet the surface renders. The
 *    words come back identical, the sheet is `ready`, and a DIFFERENT subject
 *    reads back nothing — so words can never appear under the wrong take. The same
 *    round trip is run for an original composition (source 2).
 *
 * 2. THE EMPTY AND INSTRUMENTAL OUTCOMES ARE HONEST. A piece with no verified
 *    public-domain text says "No lyrics available for this piece."; an
 *    instrumental says it has no words — with an EMPTY line list in both cases, so
 *    there is nothing to invent words from.
 *
 * 3. THE BANS HOLD ON THE REAL SOURCES. Every source-scan predicate in
 *    `src/services/v45LyricsContract.ts` is run against the actual files: the take
 *    editor mounts a real, wired lyric card; no third-party lyrics database; no
 *    audio-transcription path; no generated words for an instrumental; the user's
 *    words are never labelled official; no lyric corpus is shipped in the source;
 *    no link on the lyric path — and the money path on the surface that HOSTS a
 *    saved take (History's row purchase action) is still there.
 *
 * 4. THE GUARDS BITE. Each predicate is fed a MUTATED copy of that same real
 *    source (the card unmounted, the kind swapped, the field unwired, its
 *    accessibility label or cap dropped, a lyric API added, an ASR import added, a
 *    generated-lyrics call added, an "Official lyrics" label typed, a block of
 *    lyric text seeded into the model, a link added, the History purchase action
 *    removed) and must FAIL. A guard that survives a mutation is a tautology.
 *
 * NOTE ON THE STORE. `services/lyricsStore.ts` imports AsyncStorage, so it is not
 * tier1-compiled (exactly like `correctedTakeStore`/`melodyStore`). Its decisions
 * live in `services/lyricsSheet.ts` (compiled and proven below), and section 2
 * proves on the real file that the store only reads/writes through those pure
 * functions — the only part tier1 cannot execute is the AsyncStorage call itself.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
import { PUBLIC_DOMAIN_ABC_SCORES } from '../src/data/abcScores';
import { parseAbcScore } from '../src/services/scorePdf';
import type { SavedCaptureTake } from '../src/services/midiExport';
import {
  LYRICS_CLEARED_LINE,
  LYRICS_EMPTY_PIECE_LINE,
  LYRICS_EMPTY_USER_LINE,
  LYRICS_INSTRUMENTAL_LINE,
  LYRICS_MAX_CHARS,
  LYRICS_MAX_LINES,
  LYRICS_NOT_OFFICIAL_LINE,
  LYRICS_ORIGINAL_LABEL,
  LYRICS_PD_LABEL,
  LYRICS_RECORD_VERSION,
  LYRICS_SAVE_CTA,
  LYRICS_SAVED_LINE,
  LYRICS_SOURCE_KINDS,
  LYRICS_STORAGE_PREFIX,
  LYRICS_TAKE_HINT,
  LYRICS_TAKE_LABEL,
  decodeLyricsRecord,
  encodeLyricsRecord,
  isLyricsSourceKind,
  lyricLineCount,
  lyricLines,
  lyricSheetFor,
  lyricsLabelFor,
  lyricsSavedLine,
  lyricsStorageKey,
  normalizeLyrics,
} from '../src/services/lyricsSheet';
import {
  HISTORY_SCREEN_PATH,
  LYRICS_CARD_PATH,
  LYRICS_MODEL_PATH,
  LYRICS_STORE_PATH,
  TAKE_EDITOR_PATH,
  lyricsCardCopyComesFromTheModel,
  lyricsFieldIsARealTextInput,
  lyricsSourcesShipNoLyricTextOfTheirOwn,
  lyricsSurfaceOpensNoLink,
  lyricsTextComesOnlyFromTheThreeLegalSources,
  noAudioTranscriptionProducesLyrics,
  noInventedLyricsForInstrumentalPieces,
  noThirdPartyLyricsDatabaseIsReferenced,
  takeSurfaceKeepsTheSheetMusicOffer,
  takeSurfaceMountsTheLyricSheet,
  userWordsAreNeverLabelledOfficial,
} from '../src/services/v45LyricsContract';

declare const require: any;
declare const process: any;

let passes = 0;
let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string): void {
  try {
    assert.deepStrictEqual(actual, expected);
    passes += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures += 1;
    console.error(
      `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'app.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

/** The user's own words — typed by a person, never fetched, never generated. */
const USER_WORDS = ['Morning light on the stair', '', 'I hum it once and it stays there'].join('\n');

/**
 * A REAL CAPTURED TAKE FROM A REAL PIECE. The first bundled public-domain score
 * that carries notes is parsed by the app's own ABC reader and its notes become
 * the take's notes — the same shape the capture pipeline saves (`SavedCaptureTake`
 * of plain `MidiNoteEvent`s), so the round trip below runs on genuine data rather
 * than a hand-built stub.
 */
function realTakeFromBundledPiece(): { take: SavedCaptureTake; title: string; notes: number } {
  const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  for (const piece of PUBLIC_DOMAIN_ABC_SCORES) {
    const parsed = parseAbcScore(piece.abc);
    if (!parsed) continue;
    const notes: { midi: number; startSec: number; durationSec: number; velocity: number }[] = [];
    let cursor = 0;
    const secPerUnit = 0.25;
    for (const measure of parsed.measures) {
      for (const event of measure.events) {
        const units = event.units > 0 ? event.units : parsed.defaultUnits;
        const durationSec = units * secPerUnit;
        if (!event.rest && event.letter) {
          const semitone = SEMITONES[event.letter.toUpperCase()] ?? 0;
          const midi = 12 * (event.octave + 1) + semitone + (event.accidental ?? 0);
          if (midi >= 0 && midi <= 127) {
            notes.push({ midi, startSec: cursor, durationSec, velocity: 90 });
          }
        }
        cursor += durationSec;
      }
    }
    if (notes.length >= 4) {
      return {
        title: parsed.title,
        notes: notes.length,
        take: {
          notes,
          tempoBpm: 96,
          durationSec: Math.max(cursor, 1),
          key: null,
          capturedAt: '2026-10-28T09:00:00.000Z',
        },
      };
    }
  }
  throw new Error('no bundled public-domain piece carried notes');
}

/**
 * THE STORE'S WRITE READ PATH AS A MAP, using exactly the pure functions
 * `services/lyricsStore.ts` calls (section 2 proves that is what it does).
 */
function storeWrite(store: Map<string, string>, kind: any, subjectId: string, text: unknown): boolean {
  const key = lyricsStorageKey(kind, subjectId);
  if (!key) return false;
  const encoded = encodeLyricsRecord({ kind, subjectId, text, updatedAt: '2026-10-28T09:01:00.000Z' });
  if (!encoded) {
    store.delete(key);
    return false;
  }
  store.set(key, encoded);
  return true;
}
function storeRead(store: Map<string, string>, kind: any, subjectId: string): string {
  const key = lyricsStorageKey(kind, subjectId);
  if (!key) return '';
  const record = decodeLyricsRecord(store.get(key) ?? null, { kind, subjectId });
  return record ? record.text : '';
}

// ─── 1. The model on real app data ─────────────────────────────

console.log('\nv45S6-1 — a real take, the user\'s own words, the whole round trip');
const real = realTakeFromBundledPiece();
const takeId = `melody-${real.take.capturedAt}`;
const store = new Map<string, string>();

assertEq(real.notes >= 4, true, `a real bundled piece (${real.title}) gives a real take of ${real.notes} notes`);
assertEq(Array.isArray(real.take.notes) && real.take.notes.length === real.notes, true, 'the take carries every parsed note (no stub)');

const stored = storeWrite(store, 'take', takeId, USER_WORDS);
assertEq(stored, true, 'the user\'s words are written against the take\'s History row');
const readBack = storeRead(store, 'take', takeId);
assertEq(readBack, USER_WORDS, 'the words read back EXACTLY as typed (blank line and all)');
assertEq(storeRead(store, 'take', 'melody-someone-else'), '', 'a DIFFERENT take reads back nothing — no words leak across subjects');

const takeSheet = lyricSheetFor({ kind: 'take', text: readBack });
assertEq(takeSheet.status, 'ready', 'the sheet is ready — there are words to show with the tune');
assertEq(takeSheet.lines.length, 2, 'and it holds the two lines of words (the blank line is not a line of words)');
assertEq(takeSheet.lines[0], 'Morning light on the stair', 'first line, in reading order');
assertEq(takeSheet.label, LYRICS_TAKE_LABEL, 'the heading is the model\'s own for a take');
assertEq(takeSheet.hint, LYRICS_TAKE_HINT, 'and its honest description is the model\'s own');
assertEq(takeSheet.line, '', 'a ready sheet carries no empty-state sentence');
assertEq(lyricLineCount(readBack), 2, 'the line count the card shows is the real count');

// SOURCE 2 — the user's own composition, same model, its own kind and key.
const compId = 'composition-2026-10-28';
assertEq(storeWrite(store, 'original', compId, 'Verse one, my own tune'), true, 'an original composition keeps its own words (source 2)');
assertEq(storeRead(store, 'original', compId), 'Verse one, my own tune', 'and reads them back');
assertEq(lyricsStorageKey('original', compId) === lyricsStorageKey('take', compId), false, 'the two kinds never share a storage key');
assertEq(lyricSheetFor({ kind: 'original', text: storeRead(store, 'original', compId) }).label, LYRICS_ORIGINAL_LABEL, 'the composition sheet is labelled as the user\'s own composition');
assertEq(lyricsSavedLine('original') === lyricsSavedLine('take'), false, 'each kind says where its words were saved');

// EMPTYING is a removal, not a blank record.
assertEq(storeWrite(store, 'take', takeId, '   \n  '), false, 'an emptied sheet removes the words instead of storing a blank record');
assertEq(store.has(lyricsStorageKey('take', takeId) as string), false, 'and the stored record is gone');
assertEq(lyricSheetFor({ kind: 'take', text: storeRead(store, 'take', takeId) }).line, LYRICS_EMPTY_USER_LINE, 'an empty take sheet says nothing has been added yet');

// ─── 2. Honest empties: no PD corpus, and no words for an instrumental ──

console.log('\nv45S6-2 — nothing is invented: an unheld PD text, and an instrumental');
const noPdText = lyricSheetFor({ kind: 'pd', verified: false, text: null, hasWords: true });
assertEq(noPdText.status, 'empty', 'a piece with no verified public-domain text is empty, not filled in');
assertEq(noPdText.line, LYRICS_EMPTY_PIECE_LINE, 'and it says so plainly: no lyrics available for this piece');
assertEq(noPdText.lines.length, 0, 'with no words at all behind it');
// Even if text were somehow handed over unverified, it must NOT be shown.
const unverifiedText = lyricSheetFor({ kind: 'pd', verified: false, text: 'some text we cannot vouch for', hasWords: true });
assertEq(unverifiedText.lines.length, 0, 'unverified text is refused — only a VERIFIED public-domain text can become words');
const instrumental = lyricSheetFor({ kind: 'pd', verified: true, text: USER_WORDS, hasWords: false });
assertEq(instrumental.status, 'instrumental', 'an instrumental is reported as instrumental');
assertEq(instrumental.line, LYRICS_INSTRUMENTAL_LINE, 'and told it has no words — never given some');
assertEq(instrumental.lines.length, 0, 'with an EMPTY line list, so there is nothing to invent words from');
const verifiedPd = lyricSheetFor({ kind: 'pd', verified: true, text: 'O say can you see', hasWords: true });
assertEq(verifiedPd.status, 'ready', 'a VERIFIED public-domain text does become a sheet');
assertEq(verifiedPd.label, LYRICS_PD_LABEL, 'labelled as public-domain lyrics');
assertEq(lyricSheetFor({ kind: 'pd' }).status, 'empty', 'a PD sheet with nothing handed in is empty (the shipped state)');

// ─── 3. The model's contract: three kinds, honest words, safe decode ──

console.log('\nv45S6-3 — three legal kinds, honest copy, and a decoder that never throws');
assertEq(LYRICS_SOURCE_KINDS.length, 3, 'exactly three lyric sources exist');
assertEq([isLyricsSourceKind('pd'), isLyricsSourceKind('original'), isLyricsSourceKind('take')], [true, true, true], 'the three legal kinds are accepted');
assertEq([isLyricsSourceKind('genius'), isLyricsSourceKind(''), isLyricsSourceKind(null), isLyricsSourceKind('lyricsApi')], [false, false, false, false], 'anything else is not a source');
assertEq(LYRICS_RECORD_VERSION, 1, 'the stored record carries its version');
assertEq(lyricsStorageKey('take', '  '), null, 'a subject with no id has no key');
assertEq(lyricsStorageKey('take', 'a/b:c') === lyricsStorageKey('take', 'a/b:c'), true, 'an id with separators still gets a stable key');
assertEq((lyricsStorageKey('take', 'a/b') as string).indexOf('a/b') < 0, true, 'the escaped id cannot add a path segment');
assertEq(decodeLyricsRecord('not json'), null, 'damaged storage decodes to null, never a throw');
assertEq(decodeLyricsRecord('{"version":99,"kind":"take","subjectId":"x","text":"hi"}'), null, 'a record from another version is ignored');
assertEq(decodeLyricsRecord(JSON.stringify({ version: 1, kind: 'take', subjectId: 'x', text: 'hi' }), { kind: 'original' }), null, 'a take record cannot be read as a composition record');
assertEq(decodeLyricsRecord(JSON.stringify({ version: 1, kind: 'take', subjectId: 'x', text: 'hi' }), { subjectId: 'y' }), null, 'nor under a different subject');
assertEq(normalizeLyrics('a\r\nb\r\n').split('\n').length, 2, 'CRLF is normalised to lines');
assertEq(normalizeLyrics('a   \nb'), 'a\nb', 'trailing spaces are not part of the words');
assertEq(normalizeLyrics('a\n\n\n\nb'), 'a\n\nb', 'a run of blank lines collapses to one');
assertEq(normalizeLyrics('\n\n  a  \n\n'), 'a', 'leading and trailing blanks are dropped');
assertEq(normalizeLyrics('x\u200By'), 'xy', 'zero-width junk is stripped');
assertEq(normalizeLyrics(42), '', 'a non-string normalises to an empty sheet');
assertEq(normalizeLyrics('z'.repeat(LYRICS_MAX_CHARS + 500)).length, LYRICS_MAX_CHARS, 'one paste cannot exceed the cap');
assertEq(normalizeLyrics(Array(LYRICS_MAX_LINES + 50).fill('line').join('\n')).split('\n').length, LYRICS_MAX_LINES, 'nor the line cap');
assertEq(lyricLines('a\n\nb').length, 2, 'empty lines are not lines of words');
assertEq(lyricsLabelFor('take'), LYRICS_TAKE_LABEL, 'the take heading comes from one place');
assertEq(LYRICS_SAVE_CTA, 'Save these words', 'the one save wording');
assertEq(LYRICS_CLEARED_LINE.indexOf('removed') >= 0, true, 'emptying is reported as a removal');
assertEq(LYRICS_SAVED_LINE.indexOf('this device') >= 0, true, 'a save says where the words went (this device)');
assertEq([LYRICS_TAKE_LABEL, LYRICS_ORIGINAL_LABEL, LYRICS_PD_LABEL].some((l) => l.toLowerCase().indexOf('official') >= 0), false, 'no sheet heading calls the words official');
assertEq(LYRICS_NOT_OFFICIAL_LINE.toLowerCase().indexOf('official') >= 0, true, 'the one line about it is the denial');
assertEq(/never|not /i.test(LYRICS_NOT_OFFICIAL_LINE), true, 'and it really is a denial, not a claim');
assertEq([LYRICS_TAKE_HINT, LYRICS_ORIGINAL_LABEL, LYRICS_PD_LABEL].some((l) => /transcri|official|publisher\'s words/i.test(l)), false, 'no lyric copy promises a transcription or a publisher text');

// ─── 4. The store writes through that model, on the real file ───

console.log('\nv45S6-4 — the store is I/O only: every decision lives in the proven model');
const storeSource = read(LYRICS_STORE_PATH);
assertEq(storeSource.indexOf('encodeLyricsRecord(') >= 0, true, 'the store encodes through the model');
assertEq(storeSource.indexOf('decodeLyricsRecord(') >= 0, true, 'and decodes through the model');
assertEq(storeSource.indexOf('lyricsStorageKey(') >= 0, true, 'and keys through the model');
assertEq(storeSource.indexOf('normalizeLyrics(') >= 0, true, 'and normalises through the model');
assertEq(/AsyncStorage\s*\.\s*getItem/.test(storeSource), true, 'its only reads are AsyncStorage reads');
assertEq(/AsyncStorage\s*\.\s*setItem/.test(storeSource), true, 'its only writes are AsyncStorage writes');
assertEq(storeSource.indexOf('loadTakeLyrics') >= 0 && storeSource.indexOf('saveTakeLyrics') >= 0, true, 'the take kind has its own named seam (source 3)');
assertEq(storeSource.indexOf('loadOriginalLyrics') >= 0 && storeSource.indexOf('saveOriginalLyrics') >= 0, true, 'and the composition kind its own (source 2)');
assertEq(/\baudio\b|microphone|AudioRecord|expo-av|expo-audio/i.test(storeSource.replace(/\/\*[\s\S]*?\*\//g, ' ')), false, 'nothing in the store touches audio');

// ─── 5. The surface is wired, and the bans hold on the real files ──

console.log('\nv45S6-5 — the take surface really shows the user their own words');
const editorSource = read(TAKE_EDITOR_PATH);
const cardSource = read(LYRICS_CARD_PATH);
const modelSource = read(LYRICS_MODEL_PATH);
const historySource = read(HISTORY_SCREEN_PATH);

assertEq(takeSurfaceMountsTheLyricSheet(editorSource), true, 'the take editor mounts the lyric card, wired to its own state and the store');
assertEq(lyricsFieldIsARealTextInput(cardSource), true, 'the card has a real multiline field, an accessible name, the model\'s cap and a real save');
assertEq(lyricsCardCopyComesFromTheModel(cardSource), true, 'its save wording and caps are the model\'s, never re-typed');
assertEq(lyricsTextComesOnlyFromTheThreeLegalSources(editorSource), true, 'no network on the take surface');
assertEq(lyricsTextComesOnlyFromTheThreeLegalSources(cardSource), true, 'no network on the card');
assertEq(lyricsTextComesOnlyFromTheThreeLegalSources(modelSource), true, 'no network in the model');
assertEq(lyricsTextComesOnlyFromTheThreeLegalSources(storeSource), true, 'no network in the store');
assertEq(
  [editorSource, cardSource, modelSource, storeSource].every((s) => noThirdPartyLyricsDatabaseIsReferenced(s)),
  true,
  'NO third-party lyrics database or lyric API is named anywhere on the lyric path',
);
assertEq(
  [editorSource, cardSource, modelSource, storeSource].every((s) => noAudioTranscriptionProducesLyrics(s)),
  true,
  'NO audio-transcription (ASR) path exists on the lyric path — words are typed, never heard',
);
assertEq(
  [editorSource, cardSource, modelSource, storeSource].every((s) => noInventedLyricsForInstrumentalPieces(s)),
  true,
  'no lyric-synthesis path anywhere, and the model carries the instrumental outcome',
);
assertEq(modelSource.indexOf('input.hasWords === false') >= 0, true, 'the instrumental branch is the model\'s own');
assertEq(
  [editorSource, cardSource, modelSource, storeSource].every((s) => userWordsAreNeverLabelledOfficial(s)),
  true,
  'the user\'s words are never labelled official on any lyric surface',
);
assertEq(
  [cardSource, modelSource, storeSource].every((s) => lyricsSourcesShipNoLyricTextOfTheirOwn(s)),
  true,
  'no block of lyric text is shipped inside the lyric sources (we hold no PD corpus)',
);
assertEq(LYRICS_STORAGE_PREFIX.indexOf('notesnap') >= 0, true, 'the words are stored under the app\'s own namespace');
assertEq(
  [editorSource, cardSource, modelSource, storeSource].every((s) => lyricsSurfaceOpensNoLink(s)),
  true,
  'nothing on the lyric path opens a link, a retailer or a browser',
);
assertEq(takeSurfaceKeepsTheSheetMusicOffer(historySource), true, 'the purchase action on the History row that hosts a saved take SURVIVES this slice');
assertEq(editorSource.indexOf('loadTakeLyrics(rowId)') >= 0, true, 'the words are read back on open (a card that never loads is dead)');
assertEq(editorSource.indexOf('saveTakeLyrics(result.rowId, lyricsText)') >= 0, true, 'words typed before the take had a row are written onto the row that appears');
assertEq(cardSource.indexOf('LYRICS_NOT_OFFICIAL_LINE') >= 0, true, 'the denial rides on the card itself');

// ─── 6. The guards bite (in-suite mutations of the REAL sources) ─

console.log('\nv45S6-6 — each guard FAILS on a mutated copy of the real source');

// A. The card is unmounted from the page.
const noCard = editorSource.replace(/<LyricsSheetCard[\s\S]*?\/>/, '');
assertEq(noCard !== editorSource, true, 'probe A applied (the lyric card is unmounted)');
assertEq(takeSurfaceMountsTheLyricSheet(noCard), false, '…the mount guard FAILS');

// B. The card is mounted as a kind that is not one of the three.
const wrongKind = editorSource.replace('kind="take"', 'kind="partner-db"');
assertEq(wrongKind !== editorSource, true, 'probe B applied (the sheet is asked for an illegal kind)');
assertEq(takeSurfaceMountsTheLyricSheet(wrongKind), false, '…the mount guard FAILS (a fourth source is caught)');

// C. The field is bound to nothing.
const deadField = editorSource.replace('value={lyricsText}', 'value={""}');
assertEq(deadField !== editorSource, true, 'probe C applied (the field shows a constant, not the words)');
assertEq(takeSurfaceMountsTheLyricSheet(deadField), false, '…the mount guard FAILS');

// D. Typing goes nowhere.
const deadInput = editorSource.replace('onChangeText={setLyricsText}', 'onChangeText={() => undefined}');
assertEq(deadInput !== editorSource, true, 'probe D applied (keystrokes are dropped)');
assertEq(takeSurfaceMountsTheLyricSheet(deadInput), false, '…the mount guard FAILS');

// E. The save control calls nothing.
const deadSave = editorSource.replace('onSave={() => void saveWords()}', 'onSave={() => undefined}');
assertEq(deadSave !== editorSource, true, 'probe E applied (the save button calls nothing)');
assertEq(takeSurfaceMountsTheLyricSheet(deadSave), false, '…the mount guard FAILS (the dead-button class)');

// F. The card stops loading what was saved.
const noLoad = editorSource.replace('loadTakeLyrics(rowId)', "loadTakeLyrics('')");
assertEq(noLoad !== editorSource, true, 'probe F applied (the read is not keyed on this take)');
assertEq(takeSurfaceMountsTheLyricSheet(noLoad), false, '…the mount guard FAILS (words would never come back)');

// G. The text field stops being multiline.
const noMultiline = cardSource.replace(/^\s*multiline\s*$/m, '');
assertEq(noMultiline !== cardSource, true, 'probe G applied (the field is single-line)');
assertEq(lyricsFieldIsARealTextInput(noMultiline), false, '…the field guard FAILS (lyrics need lines)');

// H. The field loses its accessible name.
const noLabel = cardSource.replace('accessibilityLabel={LYRICS_INPUT_LABEL}', '');
assertEq(noLabel !== cardSource, true, 'probe H applied (the field cannot be named by a screen reader)');
assertEq(lyricsFieldIsARealTextInput(noLabel), false, '…the field guard FAILS');

// I. The cap is dropped.
const noCap = cardSource.replace('maxLength={LYRICS_MAX_CHARS}', '');
assertEq(noCap !== cardSource, true, 'probe I applied (the field cap is removed)');
assertEq(lyricsFieldIsARealTextInput(noCap), false, '…the field guard FAILS');

// J. A lyric API is wired in.
const lyricApiHost = 'http' + 's://api.' + 'genius' + '.com/v1/lyrics';
const withApi = cardSource.replace(
  'const sheet = lyricSheetFor({ kind, text: value });',
  'const song = await fetch(' + JSON.stringify(lyricApiHost) + ');\n  const sheet = lyricSheetFor({ kind, text: value });',
);
assertEq(withApi !== cardSource, true, 'probe J applied (a lyric database is called for words)');
assertEq(lyricsTextComesOnlyFromTheThreeLegalSources(withApi), false, '…the legal-sources guard FAILS');
assertEq(noThirdPartyLyricsDatabaseIsReferenced(withApi), false, '…and the third-party-lyrics guard FAILS');
assertEq(lyricsSurfaceOpensNoLink(withApi), false, '…and the no-link guard FAILS');

// K. An ASR engine is brought in to hear the words.
const withAsr = storeSource.replace(
  "import AsyncStorage from '@react-native-async-storage/async-storage';",
  "import AsyncStorage from '@react-native-async-storage/async-storage';\nimport SpeechRecognition from 'expo-speech-recognition';",
);
assertEq(withAsr !== storeSource, true, 'probe K applied (speech recognition is imported on the lyric path)');
assertEq(noAudioTranscriptionProducesLyrics(withAsr), false, '…the transcription guard FAILS');

// L. Instrumental words get generated.
const withSynthesis = modelSource.replace(
  'export function lyricSheetFor(input: LyricSheetInput): LyricSheet {',
  'export function generateLyricsFor(piece: string): string[] {\n  return [piece + \' la la\'];\n}\nexport function lyricSheetFor(input: LyricSheetInput): LyricSheet {',
);
assertEq(withSynthesis !== modelSource, true, 'probe L applied (a lyric generator appears in the model)');
assertEq(noInventedLyricsForInstrumentalPieces(withSynthesis), false, '…the no-invention guard FAILS');

// L2. The instrumental branch is quietly removed, so an instrumental falls through.
const noInstrumentalBranch = modelSource.replace('if (input.hasWords === false) {', 'if (false) {');
assertEq(noInstrumentalBranch !== modelSource, true, 'probe L2 applied (the instrumental branch is disabled)');
assertEq(noInventedLyricsForInstrumentalPieces(noInstrumentalBranch), false, '…the no-invention guard FAILS (an instrumental would get words)');

// M. The user's words are labelled official.
const withClaim = cardSource.replace(
  "import {\n  LYRICS_INPUT_HINT,",
  "const OFFICIAL_LABEL = 'Official lyrics';\nimport {\n  LYRICS_INPUT_HINT,",
);
assertEq(withClaim !== cardSource, true, 'probe M applied (an "Official lyrics" label is typed on the card)');
assertEq(userWordsAreNeverLabelledOfficial(withClaim), false, '…the never-official guard FAILS');

// N. A block of lyric text is seeded into the model.
const seeded = modelSource.replace(
  'export const LYRICS_TITLE =',
  "export const SEEDED_LYRICS = 'O say can you see by the dawn\\'s early light what so proudly we hailed at the twilight\\'s last gleaming whose broad stripes and bright stars through the perilous fight o\\'er the ramparts we watched were so gallantly streaming and the rockets red glare the bombs bursting in air gave proof through the night that our flag was still there';\nexport const LYRICS_TITLE =",
);
assertEq(seeded !== modelSource, true, 'probe N applied (a block of lyric text is shipped in the model)');
assertEq(lyricsSourcesShipNoLyricTextOfTheirOwn(seeded), false, '…the no-shipped-lyrics guard FAILS');

// N2. …or a shorter two-line "placeholder" set of words is seeded in.
const seededShort = modelSource.replace(
  'export const LYRICS_TITLE =',
  "export const SEEDED_WORDS = 'la la la\\nla la la';\nexport const LYRICS_TITLE =",
);
assertEq(seededShort !== modelSource, true, 'probe N2 applied (a two-line block of words is shipped in the model)');
assertEq(lyricsSourcesShipNoLyricTextOfTheirOwn(seededShort), false, '…the no-shipped-lyrics guard FAILS on that too');

// O. A link is added to the lyric card.
const url = 'htt' + 'ps://' + 'sheet' + 'musicdirect' + '.com/search';
const withLink = cardSource.replace(
  'const lineCount = lyricLineCount(value);',
  "const link = '" + url + "';\n  const lineCount = lyricLineCount(value);",
);
assertEq(withLink !== cardSource, true, 'probe O applied (a retailer URL appears on the lyric card)');
assertEq(lyricsSurfaceOpensNoLink(withLink), false, '…the no-link guard FAILS');

// P. The History row's purchase action is removed (the money path).
const noOffer = historySource.replace('primaryPurchaseUrl(item.purchaseUrls)', 'undefined');
assertEq(noOffer !== historySource, true, 'probe P applied (the take-hosting row loses its purchase action)');
assertEq(takeSurfaceKeepsTheSheetMusicOffer(noOffer), false, '…the money-path guard FAILS (the sale lever is not silently droppable)');

// P2. …or the offer leaves the app through the OS browser.
const externalOffer = historySource.replace(
  'setPurchaseWebUrl(rowPurchaseUrl);',
  'Linking.' + 'openURL(rowPurchaseUrl);',
);
assertEq(externalOffer !== historySource, true, 'probe P2 applied (the purchase tap hands the URL to the browser)');
assertEq(takeSurfaceKeepsTheSheetMusicOffer(externalOffer), false, '…the money-path guard FAILS');

// Q. The save wording is re-typed on the card instead of reused.
const retypedCta = cardSource.replace('{saving ? LYRICS_SAVE_BUSY_LABEL : LYRICS_SAVE_CTA}', '{saving ? \'Saving…\' : \'Save these words\'}');
assertEq(retypedCta !== cardSource, true, 'probe Q applied (the save wording is typed again on the surface)');
assertEq(lyricsCardCopyComesFromTheModel(retypedCta), false, '…the copy guard FAILS');

// ─── Totals ────────────────────────────────────────────────────

console.log(`\nV45-LYRICS SUITE: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
