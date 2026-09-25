/**
 * pieceAbc.ts — where the practice coach's REFERENCE melody comes from.
 *
 * The coach scores a performance against the written melody, so it needs the
 * piece as note-level data. In this app that data is ABC notation: slice 2's
 * `abcToReference()` / `parseAbcMelody()` turn it into ReferenceNote[] and read
 * its tempo. This module is the single resolver that decides WHICH abc string
 * belongs to the piece being practiced.
 *
 * Resolution order (first hit wins):
 *   1. `piece.abc` — an abc string supplied with the piece payload (the app
 *      prefers server data the moment the catalog can provide it; the backend
 *      already stores abc in `melody_skeletons.abc`, so a `/api/pieces/:id`
 *      field is a one-line addition).
 *   2. `ABC_SEEDS` — the public-domain practice seeds bundled below.
 *   3. none — the caller shows the honest "reference melody coming soon" state.
 *
 * `ABC_SEEDS` is deliberately a MIRROR of the backend's
 * `src/services/hum/melody-seeds.ts` MELODY_SEEDS (same pieces, same abc
 * strings, all public domain) so the hum recogniser and the practice coach
 * agree about what a piece's melody is. They are short practice phrases
 * (~2–4 bars), not full scores — the UI says so, and the honest empty state
 * covers every piece not in this list until the catalog serves abc.
 *
 * Pure logic, no react-native / expo imports (plain Node tests).
 */

export interface AbcSeed {
  /** Stable slug, shared with the backend's seed list. */
  pieceId: string;
  title: string;
  composer: string;
  abc: string;
}

/** Practice phrases for public-domain pieces (see the mirror note above). */
export const ABC_SEEDS: AbcSeed[] = [
  {
    pieceId: 'fur-elise',
    title: 'Für Elise',
    composer: 'Ludwig van Beethoven',
    abc: ['X:1', 'T:Für Elise (excerpt)', 'C:Ludwig van Beethoven', 'M:3/8', 'L:1/8', 'K:Am', 'e ^d e | ^d e B | d c A | A, z z |'].join('\n'),
  },
  {
    pieceId: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'Ludwig van Beethoven',
    abc: ['X:1', 'T:Ode to Joy', 'C:Ludwig van Beethoven', 'M:4/4', 'L:1/8', 'K:C', 'E E F G G F E D C C D E E D D2 |'].join('\n'),
  },
  {
    pieceId: 'twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    composer: 'Traditional (K. 265 by Mozart)',
    abc: ['X:1', 'T:Twinkle, Twinkle, Little Star', 'C:Traditional', 'M:4/4', 'L:1/8', 'K:C', 'C C G G A A G2 | F F E E D D C2 |'].join('\n'),
  },
  {
    pieceId: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional English',
    abc: ['X:1', 'T:Greensleeves (what child is this)', 'C:Traditional English', 'M:6/8', 'L:1/8', 'K:Am', 'A B c d c A | B4 G2 | A B c d e d | c4 A2 |'].join('\n'),
  },
  {
    pieceId: 'jingle-bells',
    title: 'Jingle Bells',
    composer: 'James Lord Pierpont',
    abc: ['X:1', 'T:Jingle Bells', 'C:James Lord Pierpont', 'M:4/4', 'L:1/8', 'K:C', 'E E E2 E E E2 | E G C2 D2 D2 | G G G2 G G G2 | G G G2 E2 C2 |'].join('\n'),
  },
  {
    pieceId: 'canon-in-d',
    title: 'Canon in D',
    composer: 'Johann Pachelbel',
    abc: ['X:1', 'T:Canon in D (melody)', 'C:Johann Pachelbel', 'M:4/4', 'L:1/8', 'K:D', "d ^f a ^f | a ^f a d' | ^f a d' a | d' a ^f d |"].join('\n'),
  },
  {
    pieceId: 'happy-birthday',
    title: 'Happy Birthday',
    composer: 'Mildred & Patty Hill',
    abc: ['X:1', 'T:Happy Birthday to You', 'C:Mildred & Patty Hill (1893, public domain)', 'M:3/4', 'L:1/8', 'K:G', 'G G A G C2 | B2 B2 A B D2 | C2 C2 B C E2 | D4 D2 |'].join('\n'),
  },
  {
    pieceId: 'anvil-chorus',
    title: 'Anvil Chorus',
    composer: 'Giuseppe Verdi',
    abc: ['X:1', 'T:Anvil Chorus (Il Trovatore)', 'C:Giuseppe Verdi', 'M:4/4', 'L:1/8', 'K:G', 'G c c c c2 | c d e d c B A B | G4 z4 |'].join('\n'),
  },
  {
    // Seed #9 (build #3; owner-reported gap — the Air piece page showed
    // "reference melody coming soon" because only 8 seeds existed). The phrase is
    // the violin I opening of the Air (BWV 1068/2, D major): the held F#, the
    // descending 16ths to the A4 cadence, and the chromatic C natural in bar 3.
    // Read from the public-domain Mutopia typeset of the Bach-Gesellschaft score
    // (mutopiaproject.org .../BWV1068/bach-air/bach-air-lys/bach-air-notes.ly),
    // cross-checked against bach-air-jlh-35.mid. Four bars, no grace notes; ties
    // written as repeated notes — a practice phrase, not the full movement.
    // Byte-identical to the site's MELODY_SEEDS entry and the /api/hum store.
    pieceId: 'air-on-the-g-string',
    title: 'Air on the G String',
    composer: 'Johann Sebastian Bach',
    abc: ['X:1', 'T:Air on the G String (practice phrase)', 'C:Johann Sebastian Bach', 'M:4/4', 'L:1/8', 'K:D', '^f8 | ^f b/2 g/2 e/2 d/2 ^c/2 d/2 ^c2 A2 | a4 a/2 ^f/2 =c/2 B/2 e/2 ^d/2 a/2 g/2 | g4 g/2 e/2 B/2 A/2 d/2 ^c/2 g/2 ^f/2 |]'].join('\n'),
  },
];

export type AbcSource = 'piece' | 'seed' | 'none';

export interface ResolvedPieceAbc {
  /** '' when nothing matched — never a fabricated placeholder melody. */
  abc: string;
  source: AbcSource;
  /** The seed used, when source === 'seed' (for honest UI copy). */
  seed?: AbcSeed;
}

/**
 * Fold a title to a comparable key: lower-case, diacritics stripped (Für =
  * fur), punctuation dropped, whitespace collapsed. Handles the two ways our
 * own data writes these titles ("Für Elise" vs "Fur Elise").
 */
export function normalizePieceKey(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    // Combining marks (the umlaut in Für) are dropped by the strip below.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Composer surname, for a last-resort title+composer agreement check. */
function composerKey(composer: string | null | undefined): string {
  const key = normalizePieceKey(composer);
  if (!key) return '';
  const parts = key.split(' ');
  return parts[parts.length - 1] ?? '';
}

/**
 * Resolve the reference abc for a piece.
 *
 * Matching is deliberately conservative: an exact title key, then a title key
 * that contains the seed's key (or vice versa) when the composer agrees. A
 * wrong reference melody would coach the user against the wrong notes, so an
 * unmatched piece resolves to `none` instead of a best guess.
 */
export function resolvePieceAbc(input: {
  abc?: string | null;
  title?: string | null;
  composer?: string | null;
  pieceId?: string | null;
}): ResolvedPieceAbc {
  const direct = input?.abc;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return { abc: direct, source: 'piece' };
  }

  const id = normalizePieceKey(input?.pieceId);
  if (id) {
    const byId = ABC_SEEDS.find((seed) => seed.pieceId === input?.pieceId);
    if (byId) return { abc: byId.abc, source: 'seed', seed: byId };
  }

  const titleKey = normalizePieceKey(input?.title);
  if (!titleKey) return { abc: '', source: 'none' };

  const exact = ABC_SEEDS.find((seed) => normalizePieceKey(seed.title) === titleKey);
  if (exact) return { abc: exact.abc, source: 'seed', seed: exact };

  const seedComposer = composerKey(input?.composer);
  const loose = ABC_SEEDS.find((seed) => {
    const seedTitle = normalizePieceKey(seed.title);
    const related =
      seedTitle.includes(titleKey) ||
      titleKey.includes(seedTitle) ||
      // "Für Elise (WoO 59)" vs "Für Elise (excerpt)": compare the leading words.
      seedTitle.split(' ').slice(0, 2).join(' ') === titleKey.split(' ').slice(0, 2).join(' ');
    if (!related) return false;
    if (!seedComposer) return true;
    return composerKey(seed.composer) === seedComposer;
  });

  return loose ? { abc: loose.abc, source: 'seed', seed: loose } : { abc: '', source: 'none' };
}
