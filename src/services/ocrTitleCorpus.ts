/**
 * ocrTitleCorpus.ts — THE SUGGESTIONS A COVER READ IS RANKED AGAINST (v43 item C2).
 *
 * This is DATA, not logic. `services/ocrTitleCandidates` does the deciding; this
 * file only says which titles the app can suggest when it has no live catalog in
 * hand (a cover read happens on the scan screen, which never fetches the catalog).
 * A caller that DOES have the live catalog passes its own rows and they are ranked
 * alongside these (see `ScanFindSection`'s optional `corpus` prop).
 *
 * WHAT IS IN IT: public-domain pieces the app can actually open, plus a small set
 * of modern songs whose honest destination is the licensed retailers (the money
 * path), marked `source: 'modern'`. Nothing here claims we hold a copyrighted
 * score: a `modern` entry only ever routes to "Get the official sheet music".
 *
 * PURE DATA: no imports, no logic. Compiled by tsconfig.tier1.json.
 */
import type { OcrTitleCorpusEntry } from './ocrTitleCandidates';

/** `[id, title, composer]` — the public-domain pieces the app holds a score for. */
const PD_PIECES: ReadonlyArray<readonly [string, string, string]> = [
  ['bach-air', 'Air on the G String', 'Johann Sebastian Bach'],
  ['bach-bourree-em', 'Bourrée in E minor', 'Johann Sebastian Bach'],
  ['bach-goldberg-aria', 'Goldberg Variations Aria', 'Johann Sebastian Bach'],
  ['bach-jesu-joy', 'Jesu, Joy of Man\u2019s Desiring', 'Johann Sebastian Bach'],
  ['bach-minuet-g', 'Minuet in G', 'Johann Sebastian Bach'],
  ['bach-prelude-c', 'Prelude in C major BWV 846', 'Johann Sebastian Bach'],
  ['bach-toccata-dm', 'Toccata and Fugue in D minor BWV 565', 'Johann Sebastian Bach'],
  ['beethoven-elise', 'Für Elise', 'Ludwig van Beethoven'],
  ['beethoven-moonlight', 'Moonlight Sonata', 'Ludwig van Beethoven'],
  ['beethoven-moonlight-1', 'Piano Sonata No. 14 Moonlight 1st movement', 'Ludwig van Beethoven'],
  ['beethoven-ode', 'Ode to Joy', 'Ludwig van Beethoven'],
  ['beethoven-pathetique', 'Pathétique Sonata', 'Ludwig van Beethoven'],
  ['beethoven-symphony5', 'Symphony No. 5', 'Ludwig van Beethoven'],
  ['beethoven-g-minuet', 'Minuet in G major', 'Ludwig van Beethoven'],
  ['bizet-habanera', 'Habanera from Carmen', 'Georges Bizet'],
  ['borodin-polovtsian', 'Polovtsian Dances', 'Alexander Borodin'],
  ['brahms-hungarian5', 'Hungarian Dance No. 5', 'Johannes Brahms'],
  ['brahms-lullaby', 'Wiegenlied Lullaby', 'Johannes Brahms'],
  ['chopin-fantaisie', 'Fantaisie-Impromptu', 'Frédéric Chopin'],
  ['chopin-mazurka', 'Mazurka in A minor', 'Frédéric Chopin'],
  ['chopin-nocturne-eb', 'Nocturne in E flat major Op. 9 No. 2', 'Frédéric Chopin'],
  ['chopin-nocturne-op9-1', 'Nocturne in B flat minor Op. 9 No. 1', 'Frédéric Chopin'],
  ['chopin-prelude-24', 'Prelude in D minor Op. 28 No. 24', 'Frédéric Chopin'],
  ['chopin-prelude-e', 'Prelude in E minor Op. 28 No. 4', 'Frédéric Chopin'],
  ['chopin-revolutionary', 'Revolutionary Etude', 'Frédéric Chopin'],
  ['chopin-waltz-csm', 'Waltz in C sharp minor Op. 64 No. 2', 'Frédéric Chopin'],
  ['debussy-arabesque', 'Arabesque No. 1', 'Claude Debussy'],
  ['debussy-clair', 'Clair de Lune', 'Claude Debussy'],
  ['debussy-reverie', 'Rêverie', 'Claude Debussy'],
  ['dvorak-humoresque', 'Humoresque', 'Antonín Dvořák'],
  ['dvorak-new-world', 'Symphony No. 9 From the New World', 'Antonín Dvořák'],
  ['elgar-nimrod', 'Nimrod from Enigma Variations', 'Edward Elgar'],
  ['faure-pavane', 'Pavane', 'Gabriel Fauré'],
  ['grieg-morning', 'Morning Mood from Peer Gynt', 'Edvard Grieg'],
  ['grieg-hall-mountain', 'In the Hall of the Mountain King', 'Edvard Grieg'],
  ['handel-arrival', 'Arrival of the Queen of Sheba', 'George Frideric Handel'],
  ['handel-hallelujah', 'Hallelujah Chorus', 'George Frideric Handel'],
  ['handel-sarabande', 'Sarabande', 'George Frideric Handel'],
  ['handel-water-music', 'Water Music', 'George Frideric Handel'],
  ['haydn-surprise', 'Surprise Symphony', 'Joseph Haydn'],
  ['haydn-trumpet', 'Trumpet Concerto', 'Joseph Haydn'],
  ['holst-jupiter', 'Jupiter from The Planets', 'Gustav Holst'],
  ['liszt-liebestraum', 'Liebesträume', 'Franz Liszt'],
  ['liszt-hungarian6', 'Hungarian Rhapsody No. 2', 'Franz Liszt'],
  ['mendelssohn-wedding', 'Wedding March', 'Felix Mendelssohn'],
  ['mendelssohn-spring', 'Spring Song', 'Felix Mendelssohn'],
  ['mozart-ah-vous', 'Ah vous dirai-je maman', 'Wolfgang Amadeus Mozart'],
  ['mozart-ave-verum', 'Ave verum corpus', 'Wolfgang Amadeus Mozart'],
  ['mozart-eine-kleine', 'Eine kleine Nachtmusik', 'Wolfgang Amadeus Mozart'],
  ['mozart-fantasia-dm', 'Fantasia in D minor', 'Wolfgang Amadeus Mozart'],
  ['mozart-k545', 'Piano Sonata No. 16 in C major K. 545', 'Wolfgang Amadeus Mozart'],
  ['mozart-lacrimosa', 'Lacrimosa from Requiem', 'Wolfgang Amadeus Mozart'],
  ['mozart-turkish', 'Turkish March', 'Wolfgang Amadeus Mozart'],
  ['mussorgsky-gnomes', 'Gnomus from Pictures at an Exhibition', 'Modest Mussorgsky'],
  ['offenbach-barcarolle', 'Barcarolle from The Tales of Hoffmann', 'Jacques Offenbach'],
  ['pachelbel-canon', 'Canon in D', 'Johann Pachelbel'],
  ['paradies-toccata', 'Toccata in A major', 'Pietro Domenico Paradies'],
  ['rachmaninoff-prelude', 'Prelude in C sharp minor Op. 3 No. 2', 'Sergei Rachmaninoff'],
  ['ravel-bolero', 'Boléro', 'Maurice Ravel'],
  ['ravel-pavane', 'Pavane pour une infante défunte', 'Maurice Ravel'],
  ['rimsky-flight', 'Flight of the Bumblebee', 'Nikolai Rimsky-Korsakov'],
  ['saint-saens-swan', 'The Swan from Carnival of the Animals', 'Camille Saint-Saëns'],
  ['sat-gymnopedie1', 'Gymnopédie No. 1', 'Erik Satie'],
  ['sat-gnossienne1', 'Gnossienne No. 1', 'Erik Satie'],
  ['schubert-ave-maria', 'Ave Maria', 'Franz Schubert'],
  ['schubert-serende', 'Ständchen Serenade', 'Franz Schubert'],
  ['schubert-trout', 'Trout Quintet', 'Franz Schubert'],
  ['schumann-traumerei', 'Träumerei', 'Robert Schumann'],
  ['schumann-happy-farmer', 'The Happy Farmer', 'Robert Schumann'],
  ['sibelius-finlandia', 'Finlandia', 'Jean Sibelius'],
  ['strauss-blue-danube', 'The Blue Danube', 'Johann Strauss II'],
  ['tchaikovsky-swan', 'Swan Lake', 'Pyotr Ilyich Tchaikovsky'],
  ['tchaikovsky-dance-sugar', 'Dance of the Sugar Plum Fairy', 'Pyotr Ilyich Tchaikovsky'],
  ['tchaikovsky-nutcracker', 'Nutcracker Suite', 'Pyotr Ilyich Tchaikovsky'],
  ['verdi-la-donna', 'La donna è mobile', 'Giuseppe Verdi'],
  ['vivaldi-spring', 'Spring from The Four Seasons', 'Antonio Vivaldi'],
  ['vivaldi-winter', 'Winter from The Four Seasons', 'Antonio Vivaldi'],
  ['wagner-bridal', 'Bridal Chorus', 'Richard Wagner'],
  ['wagner-ride', 'Ride of the Valkyries', 'Richard Wagner'],
];

/**
 * Modern songs: we hold no score and claim no edition — a suggestion for one of
 * these exists only to reach the licensed retailers (`source: 'modern'`).
 */
const MODERN_SONGS: ReadonlyArray<readonly [string, string, string]> = [
  ['bohemian-rhapsody', 'Bohemian Rhapsody', 'Queen'],
  ['fields-of-gold', 'Fields of Gold', 'Sting'],
  ['hallelujah-leonard', 'Hallelujah', 'Leonard Cohen'],
  ['imagine-lennon', 'Imagine', 'John Lennon'],
  ['let-it-be', 'Let It Be', 'The Beatles'],
  ['moon-river', 'Moon River', 'Henry Mancini'],
  ['over-the-rainbow', 'Over the Rainbow', 'Harold Arlen'],
  ['river-flows-you', 'River Flows in You', 'Yiruma'],
  ['someone-like-you', 'Someone Like You', 'Adele'],
  ['your-song', 'Your Song', 'Elton John'],
];

/** The bundled alias list, in the corpus shape `readTitleCandidates` expects. */
export const OCR_TITLE_CORPUS: readonly OcrTitleCorpusEntry[] = [
  ...PD_PIECES.map(([id, title, composer]) => ({
    id,
    title,
    composer,
    source: 'catalog' as const,
  })),
  ...MODERN_SONGS.map((song) => ({
    id: null,
    title: song[1],
    composer: song[2],
    source: 'modern' as const,
  })),
];
