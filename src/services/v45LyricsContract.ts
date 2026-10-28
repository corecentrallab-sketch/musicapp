/**
 * v45LyricsContract.ts — THE SOURCE GUARDS for v45 slice 6 (LYRIC SHEETS under
 * the owner's THREE-WAY LYRICS SCOPE, ratified 2026-10-26).
 *
 * WHY A SOURCE GUARD AND NOT A LOGIC TEST. `test:tier1` compiles pure services,
 * not screens — and every ban in this slice is a property of what the APP IS
 * ALLOWED TO REACH, not of a return value:
 *   • a lyric sheet that really exists on the take surface (not a card that
 *     renders and saves nothing),
 *   • words arriving ONLY from the three legal sources — never a lyrics database,
 *     never a lyric API, never a network call,
 *   • no audio → lyrics path of any kind (no speech-to-text, no vocal ASR),
 *   • no generated words for an instrumental,
 *   • the user's own words never described as an official text,
 *   • no lyric corpus of our own quietly shipped inside the source,
 *   • and the money path on the surface that HOSTS a saved take still intact —
 *     the take→official-sheet-music offer must survive this slice.
 *
 * PURE: string in, boolean out. `scripts/v45Lyrics.test.ts` feeds each predicate
 * a MUTATED copy of the real source and requires it to FAIL, because a guard that
 * survives a mutation is a tautology, not a guard.
 *
 * BAN STRINGS ARE IMPORTED, NOT RE-TYPED: the retailer hostname pattern comes
 * from `services/purchaseCta.ts` (the owner of that registry) and the external
 * open call from `LOCKING_OPEN_URL_CALL`, so this file adds no second copy of the
 * money path's own vocabulary.
 */
import { LOCKING_OPEN_URL_CALL, RETAILER_HOSTNAME_PATTERN } from './purchaseCta';
import {
  LYRICS_INSTRUMENTAL_LINE,
  LYRICS_MAX_CHARS,
  LYRICS_NOT_OFFICIAL_LINE,
  LYRICS_SAVE_CTA,
  LYRICS_SOURCE_KINDS,
} from './lyricsSheet';

/** The four files this slice adds/changes (one source of truth for the gate). */
export const LYRICS_CARD_PATH = 'src/components/LyricsSheetCard.tsx';
export const LYRICS_MODEL_PATH = 'src/services/lyricsSheet.ts';
export const LYRICS_STORE_PATH = 'src/services/lyricsStore.ts';
export const TAKE_EDITOR_PATH = 'src/components/TakeCorrectionEditor.tsx';
/** The screen whose History row hosts a saved take (and its purchase action). */
export const HISTORY_SCREEN_PATH = 'src/screens/HistoryScreen.tsx';

/** Strip comments, so a guard is never satisfied by prose and never fails on one. */
function maskComments(source: string): string {
  return (typeof source === 'string' ? source : '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

/** A URL scheme, assembled so this file's own defence is not a URL in a grep. */
const URL_SCHEME_PATTERN = new RegExp('ht' + 'tps?://', 'i');

// ─── A. The surface really has the sheet ────────────────────────

/**
 * THE TAKE SURFACE MOUNTS A REAL LYRIC SHEET. The card is in the page, it is the
 * USER'S OWN kind (`take` — source 3), it is bound to the page's own state, its
 * save goes through the store seam with the History row id, and the words are
 * READ BACK on open (a sheet that never loads is a dead card).
 */
export function takeSurfaceMountsTheLyricSheet(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 20000) return false;
  // The card is mounted …
  if (src.indexOf('<LyricsSheetCard') < 0) return false;
  // … as the user's own captured take (source 3 of the three) …
  if (src.indexOf('kind="take"') < 0) return false;
  // … bound to the page's state (both directions) …
  if (src.indexOf('value={lyricsText}') < 0) return false;
  if (src.indexOf('onChangeText={setLyricsText}') < 0) return false;
  // … with its write routed through the one store seam, for this row …
  if (src.indexOf('onSave={() => void saveWords()}') < 0) return false;
  if (src.indexOf('loadTakeLyrics(rowId)') < 0) return false;
  if (src.indexOf('saveTakeLyrics(rowId, lyricsText)') < 0) return false;
  // … and it is only offered a write when there is a row to attach words to.
  return src.indexOf('canSave={!!rowId}') >= 0;
}

/**
 * THE FIELD IS A REAL, USABLE TEXT INPUT. A multiline input carrying the
 * accessible name and hint from the model, the model's own cap, the user's words
 * as its value, and a save control that is honestly disabled while a write is in
 * flight or while there is no row to write to.
 */
export function lyricsFieldIsARealTextInput(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 800) return false;
  if (src.indexOf('<TextInput') < 0) return false;
  if (!/^\s*multiline\s*$/m.test(src)) return false;
  if (src.indexOf('value={value}') < 0) return false;
  if (src.indexOf('onChangeText={onChangeText}') < 0) return false;
  if (src.indexOf('accessibilityLabel={LYRICS_INPUT_LABEL}') < 0) return false;
  if (src.indexOf('maxLength={LYRICS_MAX_CHARS}') < 0) return false;
  if (src.indexOf('onPress={onSave}') < 0) return false;
  if (src.indexOf('disabled={!!saving || !canSave}') < 0) return false;
  // The heading, the honest hint and the not-official line all come from the
  // model — this card types none of them.
  if (src.indexOf('lyricSheetFor({ kind, text: value })') < 0) return false;
  if (src.indexOf('{LYRICS_NOT_OFFICIAL_LINE}') < 0) return false;
  return src.indexOf('{sheet.hint}') >= 0;
}

// ─── B. Words come only from the three legal sources ───────────

/**
 * NO NETWORK, NO DATABASE: a lyric sheet's words can only be text the caller
 * already holds — a verified public-domain text, or the user's own typing. There
 * is no fetch, no client, no socket and no shell-out on any lyric path, and the
 * sheet is composed through the model's one entry point.
 */
export function lyricsTextComesOnlyFromTheThreeLegalSources(source: string): boolean {
  const src = maskComments(source);
  if (src === '') return false;
  if (/\bfetch\s*\(/.test(src)) return false;
  if (/\baxios\b|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/.test(src)) return false;
  if (URL_SCHEME_PATTERN.test(src)) return false;
  if (/\brequire\s*\(\s*['"](?:http|https|net)['"]\s*\)/.test(src)) return false;
  // …and the words really do come from the model: this either IS the producer,
  // or it reaches the sheet through the model / the store seam the model owns.
  return (
    src.indexOf('lyricSheetFor(') >= 0 ||
    src.indexOf("from '../services/lyricsSheet'") >= 0 ||
    src.indexOf("from './lyricsSheet'") >= 0 ||
    src.indexOf("from '../services/lyricsStore'") >= 0
  );
}

/**
 * THE THIRD-PARTY LYRICS BAN, as executable proof. None of these may be named
 * anywhere in the lyric path (masked comments excepted, so documentation of the
 * ban is allowed but a client never is).
 */
export const BANNED_LYRIC_SOURCE_PATTERNS: readonly RegExp[] = [
  /\bgenius\b/i,
  /\bmusixmatch\b/i,
  /\blyricfind\b/i,
  /\bazlyrics\b/i,
  /\blyricsfreak\b/i,
  /\bchartlyrics\b/i,
  /\bkaraoke[-_ ]?text\b/i,
  /\blyrics?\s*\.\s*ovh\b/i,
  /\blyrics?[-_ ]?api\b/i,
  /\bapi\s*\.\s*lyrics\b/i,
  /\blyricsdb\b/i,
];

/** No third-party lyric database or lyric API is referenced on any lyric path. */
export function noThirdPartyLyricsDatabaseIsReferenced(source: string): boolean {
  const src = maskComments(source);
  if (src === '') return false;
  for (const pattern of BANNED_LYRIC_SOURCE_PATTERNS) {
    if (pattern.test(src)) return false;
  }
  return true;
}

// ─── C. No audio → lyrics, ever ────────────────────────────────

/**
 * NO AUDIO-TRANSCRIPTION LYRIC ENGINE. The owner's ban is absolute: no
 * speech-to-text over a vocal, no ASR wiring, no "listen and write the words"
 * feature. A lyric sheet only ever holds text a person typed or a verified
 * public-domain text we hold — never something derived from audio.
 */
export const BANNED_TRANSCRIPTION_PATTERNS: readonly RegExp[] = [
  /speech[-_ ]?recognition/i,
  /\bspeechrecognition\b/i,
  /\bspeechrecognizer\b/i,
  /\btranscri(?:be|bed|bing|ption|pt)\b/i,
  /\bwhisper\b/i,
  /\bvoice[-_ ]?to[-_ ]?text\b/i,
  /\bautomatic[-_ ]?speech[-_ ]?recognition\b/i,
  /\bonresult\b/i,
  /\basr[-_ ]?(?:engine|model|service)\b/i,
];

/** No audio-transcription path exists on any lyric surface or in its store. */
export function noAudioTranscriptionProducesLyrics(source: string): boolean {
  const src = maskComments(source);
  if (src === '') return false;
  for (const pattern of BANNED_TRANSCRIPTION_PATTERNS) {
    if (pattern.test(src)) return false;
  }
  return true;
}

// ─── D. Instrumentals get no invented words ────────────────────

/** Anything that would MANUFACTURE words instead of showing real ones. */
export const BANNED_LYRIC_SYNTHESIS_PATTERNS: readonly RegExp[] = [
  /\bgenerate[a-z]*lyric/i,
  /\bgenerated?[-_ ]?lyrics?\b/i,
  /\bsynth(?:esised?|esized?)[-_ ]?lyrics?/i,
  /\binvent(?:ed)?[-_ ]?lyrics?/i,
  /\bplaceholder[-_ ]?lyrics?/i,
  /\bmock[-_ ]?lyrics?/i,
  /\bfallback[-_ ]?lyrics?/i,
  /\bfill[-_ ]?lyrics?/i,
  /\bauto[-_ ]?lyrics?\b/i,
  /\blorem ipsum\b/i,
];

/**
 * AN INSTRUMENTAL IS TOLD IT HAS NO WORDS — never given some. No synthesis call
 * exists anywhere on the path, and the model's public-domain branch must carry
 * the instrumental outcome explicitly (`hasWords === false` → the instrumental
 * line), so the empty case can never fall through to generated text.
 */
export function noInventedLyricsForInstrumentalPieces(source: string): boolean {
  const src = maskComments(source);
  if (src === '') return false;
  for (const pattern of BANNED_LYRIC_SYNTHESIS_PATTERNS) {
    if (pattern.test(src)) return false;
  }
  // When this is the model itself, the instrumental branch must really be there.
  if (src.indexOf('export function lyricSheetFor(') >= 0) {
    if (src.indexOf('input.hasWords === false') < 0) return false;
    if (src.indexOf('line: LYRICS_INSTRUMENTAL_LINE') < 0) return false;
  }
  return LYRICS_INSTRUMENTAL_LINE.length > 0;
}

// ─── E. Never "official" ───────────────────────────────────────

/**
 * THE USER'S WORDS ARE NEVER LABELLED OFFICIAL. Every occurrence of the word on a
 * lyric surface must be a DENIAL (the model's own "never labelled official" line,
 * or a prose/identifier form of it). A positive label — "Official lyrics",
 * "official version" — fails, which is exactly the copy the owner banned.
 */
export function userWordsAreNeverLabelledOfficial(source: string): boolean {
  const src = maskComments(source);
  if (src === '') return false;
  const lower = src.toLowerCase();
  const needle = 'official';
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    const before = lower.slice(Math.max(0, at - 24), at);
    // A denial in prose ("are never labelled …") or in an identifier
    // (LYRICS_NOT_OFFICIAL_LINE) is the ONLY allowed form.
    const denied = /(?:^|[^a-z])(?:not|never|no)[\s_-]+[a-z]*\s*$/.test(before);
    if (!denied) return false;
    from = at + needle.length;
  }
  // …and the one line the surface shows about it IS that denial.
  if (LYRICS_NOT_OFFICIAL_LINE.toLowerCase().indexOf(needle) < 0) return false;
  // Every kind the model offers is the user's own or a verified PD text — none
  // of the three is described as an official publication.
  return LYRICS_SOURCE_KINDS.length === 3;
}

// ─── F. No lyric text of our own, and no link ──────────────────

/**
 * Every string literal in the source — single-quoted, double-quoted AND
 * template literals (a block of words hidden in a backtick string is exactly the
 * kind of thing this guard is for, so all three forms are read).
 */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  const pattern = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\\n]|\\.)*)`/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(src)) !== null) {
    out.push(match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3] ?? '');
  }
  return out;
}

/**
 * WE SHIP NO LYRIC TEXT OF OUR OWN. We hold no verified public-domain lyric
 * corpus yet, so nothing on the lyric path may carry a block of prose: no literal
 * longer than one UI sentence and none spanning lines. This is the guard against
 * someone "helpfully" seeding words into the source, which would be exactly the
 * fabricated-lyrics failure the scope forbids.
 */
export function lyricsSourcesShipNoLyricTextOfTheirOwn(source: string): boolean {
  const src = maskComments(source);
  if (src === '') return false;
  for (const literal of stringLiterals(src)) {
    // One UI sentence is the ceiling for a literal on this path …
    if (literal.length > 160) return false;
    // … and no literal may hold a BLOCK of text. The bare '\n' a split() call
    // uses is ordinary code; a line break INSIDE words is a lyric sheet.
    const breaks = (literal.match(/\\n/g) || []).length;
    if (breaks >= 1 && literal.length > 8) return false;
  }
  return src.indexOf('LYRICS_') >= 0;
}

/**
 * A LYRIC SHEET IS TEXT, NOT A DOOR. Nothing on the lyric path may open a link,
 * a retailer, a browser or a web view: the take→official-sheet-music offer lives
 * on the History row that hosts the take (predicate J), never inside the words.
 */
export function lyricsSurfaceOpensNoLink(source: string): boolean {
  const src = maskComments(source);
  if (src === '') return false;
  if (URL_SCHEME_PATTERN.test(src)) return false;
  if (RETAILER_HOSTNAME_PATTERN.test(src)) return false;
  if (src.indexOf(LOCKING_OPEN_URL_CALL) >= 0) return false;
  if (/\bWebView\b|\bLinking\s*\./.test(src)) return false;
  return src.indexOf('LYRICS_') >= 0;
}

// ─── G. The money path on the hosting surface survives ─────────

/**
 * THE TAKE→OFFICIAL-SHEET-MUSIC OFFER MUST SURVIVE. A saved take lives on a
 * History row, and that row carries the app's purchase action for the licensed
 * retailer — resolved through `primaryPurchaseUrl()` (never a hand-written link)
 * and opened in the app's own shell, not the OS browser. This slice adds a card
 * to the take editor; the sale lever it holds must still be there afterwards.
 */
export function takeSurfaceKeepsTheSheetMusicOffer(historySource: string): boolean {
  const src = maskComments(historySource);
  if (src.length < 20000) return false;
  if (src.indexOf('primaryPurchaseUrl(item.purchaseUrls)') < 0) return false;
  if (src.indexOf('setPurchaseWebUrl(rowPurchaseUrl)') < 0) return false;
  // The offer's own title says what it is, and it opens IN APP.
  if (src.indexOf('— official sheet music`') < 0) return false;
  // …and this action never hands the URL to the OS browser.
  return src.indexOf('openURL(rowPurchaseUrl)') < 0;
}

/**
 * The card's own copy is the model's: no sentence about lyrics is typed twice,
 * and the save control's words are the model's constant.
 */
export function lyricsCardCopyComesFromTheModel(source: string): boolean {
  const src = maskComments(source);
  if (src.length < 800) return false;
  if (src.indexOf('{LYRICS_SAVE_CTA}') < 0 && src.indexOf('LYRICS_SAVE_CTA') < 0) return false;
  if (src.indexOf('LYRICS_SAVE_BUSY_LABEL') < 0) return false;
  if (src.indexOf(LYRICS_SAVE_CTA) >= 0) return false; // the literal may not be typed
  return src.indexOf('LYRICS_MAX_CHARS') >= 0;
}
