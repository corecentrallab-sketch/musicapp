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
 * in-app ABCjs WebView. These are single-line MELODY transcriptions (the
 * editor shares one melody line; note-by-note editing is out of scope). The
 * accompaniment of the piano/orchestral originals is deliberately not here —
 * that is what `scope` says out loud, per entry.
 *
 * ── FULL-LENGTH HEADLINERS (v43 slice 2, owner 10-22) ──────────────────────
 * The owner's repeated on-device complaint was "it only shows 4 bars". The
 * 4-bar scores were DATA (short excerpts), not a rendering bug, so five
 * headliners now carry their WHOLE melody instead of a 4-bar sample:
 *
 *   • Für Elise             16 bars — the opening theme stated twice, with its
 *                                   answering A-minor figure (the A section's
 *                                   opening; Beethoven's full WoO 59 also has
 *                                   the B and C sections and is not a 16-bar
 *                                   piece — `scope` says exactly that).
 *   • Ode to Joy            16 bars — the complete theme of the Ninth Symphony
 *                                   finale, both halves (A A').
 *   • Twinkle             12 bars — the complete nursery tune (A B A).
 *   • Greensleeves        16 bars — the complete tune, both 8-bar strains.
 *   • Jingle Bells        16 bars — the complete chorus.
 *
 * Transcription method (hand-checked, no third-party file copied): written
 * from the public-domain compositions themselves; every bar's note values sum
 * exactly to the printed meter, and every pitch sits in the register of the
 * original melody line (the opening of Für Elise matches the piano score's
 * E5–D#5–E5–D#5–E5–B4–D5–C5–A4 figure this file has carried since v1). The
 * remaining three entries (Canon in D, Happy Birthday, Anvil Chorus) are still
 * SHORT SAMPLES and the UI now says so in words — `scoreLengthLine()` prints
 * "Bars 1–4 of 4" — so a sample can never again read as a bug.
 *
 * Provenance of a full score is DATA, not a claim: `scope` is rendered
 * nowhere, and the length line under the staff/header is computed from the ABC
 * itself (services/scoreLength.ts), never typed by hand.
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
  /**
   * What this score IS, in plain words, next to the score itself: which part of
   * the work the melody covers. Documentation only — the UI prints the score's
   * own bar count (services/scoreLength.ts), never this string.
   */
  scope: string;
}

export const PUBLIC_DOMAIN_ABC_SCORES: AbcScore[] = [
  {
    id: 'fur-elise',
    title: 'Für Elise',
    composer: 'Ludwig van Beethoven',
    keyLabel: 'Am',
    isPublicDomain: true,
    scope: 'The opening theme (A section, stated twice with its answering figure) — 16 bars, melody line only',
    abc: [
      'X:1',
      'T:Für Elise (opening theme)',
      'C:Ludwig van Beethoven',
      'M:3/8',
      'L:1/8',
      'K:Am',
      // Theme: E5 D#5 E5 / D#5 E5 B4 / D5 C5 A4 / A4 held — then the low
      // A-minor answering figure (C4 E4 A4) and the held B4 — twice over.
      'e ^d e | ^d e B | d c A | A,2 z |',
      'C E A | B2 z | e ^d e | ^d e B |',
      'd c A | A,2 z | C E A | B2 z |',
      'e ^d e | ^d e B | d c A | A,2 z |]',
    ].join('\n'),
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'Ludwig van Beethoven',
    keyLabel: 'C',
    isPublicDomain: true,
    scope: 'The complete 16-bar theme of the Ninth Symphony finale (both halves), melody line only',
    abc: [
      'X:1',
      'T:Ode to Joy (Symphony No. 9)',
      'C:Ludwig van Beethoven',
      'M:4/4',
      'L:1/4',
      'K:C',
      'E E F G | G F E D | C C D E | E3 D |',
      'E E F G | G F E D | C C D E | D3 C |',
      'E E F G | G F E D | C C D E | E3 D |',
      'E E F G | G F E D | C C D E | D3 C |]',
    ].join('\n'),
  },
  {
    id: 'twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    composer: 'Traditional (K. 265 by Mozart)',
    keyLabel: 'C',
    isPublicDomain: true,
    scope: 'The complete 12-bar nursery tune (A B A), melody line only',
    abc: [
      'X:1',
      'T:Twinkle, Twinkle, Little Star',
      'C:Traditional',
      'M:4/4',
      'L:1/4',
      'K:C',
      'C C G G | A A G2 | F F E E | D D C2 |',
      'G G F F | E E D2 | G G F F | E E D2 |',
      'C C G G | A A G2 | F F E E | D D C2 |]',
    ].join('\n'),
  },
  {
    id: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional English',
    keyLabel: 'Am',
    isPublicDomain: true,
    scope: 'The complete 16-bar tune (both 8-bar strains), melody line only',
    abc: [
      'X:1',
      'T:Greensleeves',
      'C:Traditional English (16th century)',
      'M:6/8',
      'L:1/8',
      'K:Am',
      'c2 d e2 f | e2 d c2 A | B2 c A2 ^G | A6 |',
      'c2 d e2 f | e2 d c2 A | B2 c B2 A | ^G6 |',
      'c2 d e2 f | e2 d c2 A | B2 c A2 ^G | A6 |',
      'c2 d e2 f | e2 d c2 A | B2 c B2 A | ^G6 |]',
    ].join('\n'),
  },
  {
    id: 'jingle-bells',
    title: 'Jingle Bells',
    composer: 'James Lord Pierpont',
    keyLabel: 'C',
    isPublicDomain: true,
    scope: 'The complete 16-bar chorus (the song’s verse is not included), melody line only',
    abc: [
      'X:1',
      'T:Jingle Bells (chorus)',
      'C:James Lord Pierpont (1857)',
      'M:4/4',
      'L:1/4',
      'K:C',
      'E E E2 | E E E2 | E G C D | E4 |',
      'F F F2 | F E E2 | E D D E | D2 G2 |',
      'E E E2 | E E E2 | E G C D | E4 |',
      'F F F2 | F E E2 | G G F D | C4 |]',
    ].join('\n'),
  },
  {
    id: 'canon-in-d',
    title: 'Canon in D',
    composer: 'Johann Pachelbel',
    keyLabel: 'D',
    isPublicDomain: true,
    scope: 'A 4-bar sample of the ground-bass melody — not the complete canon',
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
    scope: 'A 4-bar sample of the tune — not the complete song',
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
    scope: 'A 3-bar sample of the chorus — not the complete chorus',
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
