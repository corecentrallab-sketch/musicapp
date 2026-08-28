/**
 * PUBLIC_DOMAIN_ABC_SCORES — bundled editable ABC scores for the notation
 * editor (transpose) feature.
 *
 * ALL of these pieces are in the public domain (classical compositions whose
 * copyright has expired, plus traditional/mid-19th-century tunes). The
 * notation editor only ever offers transpose-save for public-domain pieces —
 * modern/copyrighted music is never bundled here.
 *
 * The ABC follows the standard abc v2.1 syntax so it renders cleanly in the
 * in-app ABCjs WebView. These are intentionally simple single-line melodies
 * (v1 shares a melody line; note-by-note editing is out of scope).
 */

export interface AbcScore {
  id: string;
  title: string;
  composer: string;
  /** The ABC `K:` key label (used for the UI "from key"). */
  keyLabel: string;
  /** Full ABC body, including the header. */
  abc: string;
  /** Always true for everything in this bundle; kept for defensive gating. */
  isPublicDomain: boolean;
}

export const PUBLIC_DOMAIN_ABC_SCORES: AbcScore[] = [
  {
    id: 'fur-elise',
    title: 'Für Elise',
    composer: 'Ludwig van Beethoven',
    keyLabel: 'Am',
    isPublicDomain: true,
    abc: [
      'X:1',
      'T:Für Elise (excerpt)',
      'C:Ludwig van Beethoven',
      'M:3/8',
      'L:1/8',
      'K:Am',
      'e ^d e | ^d e B | d c A | A, z z |]',
    ].join('\n'),
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'Ludwig van Beethoven',
    keyLabel: 'C',
    isPublicDomain: true,
    abc: [
      'X:1',
      'T:Ode to Joy (Symphony No. 9)',
      'C:Ludwig van Beethoven',
      'M:4/4',
      'L:1/4',
      'K:C',
      'E E F G | G F E D | C C D E | E2 D2 |]',
    ].join('\n'),
  },
  {
    id: 'twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    composer: 'Traditional (K. 265 by Mozart)',
    keyLabel: 'C',
    isPublicDomain: true,
    abc: [
      'X:1',
      'T:Twinkle, Twinkle, Little Star',
      'C:Traditional',
      'M:4/4',
      'L:1/8',
      'K:C',
      'C C G G A A G2 | F F E E D D C2 |]',
    ].join('\n'),
  },
  {
    id: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional English',
    keyLabel: 'Am',
    isPublicDomain: true,
    abc: [
      'X:1',
      'T:Greensleeves (what child is this)',
      'C:Traditional English',
      'M:6/8',
      'L:1/8',
      'K:Am',
      'A B c d c A | B4 G2 | A B c d e d | c4 A2 |]',
    ].join('\n'),
  },
  {
    id: 'jingle-bells',
    title: 'Jingle Bells',
    composer: 'James Lord Pierpont',
    keyLabel: 'C',
    isPublicDomain: true,
    abc: [
      'X:1',
      'T:Jingle Bells',
      'C:James Lord Pierpont',
      'M:4/4',
      'L:1/8',
      'K:C',
      'E E E2 E E E2 | E G C2 D2 D2 | G G G2 G G G2 | G G G2 E2 C2 |]',
    ].join('\n'),
  },
  {
    id: 'canon-in-d',
    title: 'Canon in D',
    composer: 'Johann Pachelbel',
    keyLabel: 'D',
    isPublicDomain: true,
    abc: [
      'X:1',
      'T:Canon in D (melody)',
      'C:Johann Pachelbel',
      'M:4/4',
      'L:1/8',
      'K:D',
      'd ^f a ^f | a ^f a d\x27 | ^f a d\x27 a | d\x27 a ^f d |]',
    ].join('\n'),
  },
  {
    id: 'happy-birthday',
    title: 'Happy Birthday',
    composer: 'Mildred & Patty Hill',
    keyLabel: 'G',
    isPublicDomain: true,
    abc: [
      'X:1',
      'T:Happy Birthday to You',
      'C:Mildred & Patty Hill (1893, public domain)',
      'M:3/4',
      'L:1/8',
      'K:G',
      'G G A G C2 | B2 B2 A B D2 | C2 C2 B C E2 | D4 D2 |]',
    ].join('\n'),
  },
  {
    id: 'ode-anvil-chorus',
    title: 'Anvil Chorus',
    composer: 'Giuseppe Verdi',
    keyLabel: 'G',
    isPublicDomain: true,
    abc: [
      'X:1',
      'T:Anvil Chorus (Il Trovatore)',
      'C:Giuseppe Verdi',
      'M:4/4',
      'L:1/8',
      'K:G',
      'G c c c c2 | c d e d c B A B | G4 z4 |]',
    ].join('\n'),
  },
];
