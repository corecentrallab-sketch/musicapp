// ---------------------------------------------------------------------------
// melody-seeds.ts — bundled public-domain ABC reference seeds for the
// hum-to-search melody database (Phase 1). These mirror the app's
// PUBLIC_DOMAIN_ABC_SCORES (notation-editor bundle) so the algorithm is
// self-contained and testable without a DB. All content is public domain.
// ---------------------------------------------------------------------------
export interface AbcSeed {
  pieceId: string;
  title: string;
  composer: string;
  abc: string;
}

export const MELODY_SEEDS: AbcSeed[] = [
  {
    pieceId: 'fur-elise',
    title: 'Für Elise',
    composer: 'Ludwig van Beethoven',
    abc: ['X:1', 'T:Für Elise (excerpt)', 'C:Ludwig van Beethoven', 'M:3/8', 'L:1/8', 'K:Am', 'e ^d e | ^d e B | d c A | A, z z |]'].join('\n'),
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
    abc: ['X:1', 'T:Twinkle, Twinkle, Little Star', 'C:Traditional', 'M:4/4', 'L:1/8', 'K:C', 'C C G G A A G2 | F F E E D D C2 |]'].join('\n'),
  },
  {
    pieceId: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional English',
    abc: ['X:1', 'T:Greensleeves (what child is this)', 'C:Traditional English', 'M:6/8', 'L:1/8', 'K:Am', 'A B c d c A | B4 G2 | A B c d e d | c4 A2 |]'].join('\n'),
  },
  {
    pieceId: 'jingle-bells',
    title: 'Jingle Bells',
    composer: 'James Lord Pierpont',
    abc: ['X:1', 'T:Jingle Bells', 'C:James Lord Pierpont', 'M:4/4', 'L:1/8', 'K:C', 'E E E2 E E E2 | E G C2 D2 D2 | G G G2 G G G2 | G G G2 E2 C2 |]'].join('\n'),
  },
  {
    pieceId: 'canon-in-d',
    title: 'Canon in D',
    composer: 'Johann Pachelbel',
    abc: ['X:1', 'T:Canon in D (melody)', 'C:Johann Pachelbel', 'M:4/4', 'L:1/8', 'K:D', "d ^f a ^f | a ^f a d' | ^f a d' a | d' a ^f d |]"].join('\n'),
  },
  {
    pieceId: 'happy-birthday',
    title: 'Happy Birthday',
    composer: 'Mildred & Patty Hill',
    abc: ['X:1', 'T:Happy Birthday to You', 'C:Mildred & Patty Hill (1893, public domain)', 'M:3/4', 'L:1/8', 'K:G', 'G G A G C2 | B2 B2 A B D2 | C2 C2 B C E2 | D4 D2 |]'].join('\n'),
  },
  {
    pieceId: 'anvil-chorus',
    title: 'Anvil Chorus',
    composer: 'Giuseppe Verdi',
    abc: ['X:1', 'T:Anvil Chorus (Il Trovatore)', 'C:Giuseppe Verdi', 'M:4/4', 'L:1/8', 'K:G', 'G c c c c2 | c d e d c B A B | G4 z4 |]'].join('\n'),
  },
];
