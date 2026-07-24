#!/usr/bin/env bun
/**
 * build-target-list.ts — Generate a CSV of the 500 most-recognizable
 * public-domain classical pieces for NoteSnap curation.
 *
 * Sources:
 *   - Bach BWV catalog (complete keyboard works + major orchestral)
 *   - Mozart K catalog (piano sonatas, concertos, major works)
 *   - Beethoven Opus & WoO (piano sonatas, symphonies, bagatelles)
 *   - Chopin Opus (nocturnes, études, waltzes, polonaises, etc.)
 *   - Debussy L catalog
 *   - Liszt S catalog
 *   - Schubert D catalog
 *   - Schumann Opus
 *   - Handel HWV
 *   - Haydn Hob
 *   - Tchaikovsky Opus
 *   - Other major composers (Brahms, Rachmaninoff, Ravel, Satie, etc.)
 *   - Standard piano teaching repertoire (ABRSM/RCM)
 *   - Famous orchestral works arranged for piano
 *
 * Output: scripts/target-500.csv
 * Format: composer,catalog,title,era,difficulty_estimate
 *
 * Usage: bun run scripts/build-target-list.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PieceEntry {
  composer: string;
  catalog: string;
  title: string;
  era: string;
  difficulty_estimate: string;
}

// Difficulty scale (ABRSM/RCM approximate):
//   1-3 = beginner, 4-5 = early-intermediate, 6-7 = intermediate,
//   8-9 = late-intermediate/advanced, 10+ = virtuoso

// ---------------------------------------------------------------------------
// Catalog generators
// ---------------------------------------------------------------------------

function bachBWV(): PieceEntry[] {
  const pieces: PieceEntry[] = [];

  // Well-Tempered Clavier Book 1 (BWV 846-869) — all 24 preludes & fugues
  for (let i = 0; i < 24; i++) {
    const bwv = 846 + i;
    const keys = [
      "C Major", "C Minor", "C-sharp Major", "C-sharp Minor",
      "D Major", "D Minor", "E-flat Major", "E-flat Minor",
      "E Major", "E Minor", "F Major", "F Minor",
      "F-sharp Major", "F-sharp Minor", "G Major", "G Minor",
      "A-flat Major", "G-sharp Minor", "A Major", "A Minor",
      "B-flat Major", "B-flat Minor", "B Major", "B Minor",
    ];
    pieces.push({
      composer: "Johann Sebastian Bach",
      catalog: `BWV ${bwv}`,
      title: `Prelude and Fugue in ${keys[i]} (WTC Book 1)`,
      era: "Baroque",
      difficulty_estimate: i < 4 ? "4-6" : i < 12 ? "6-8" : "7-10",
    });
  }

  // WTC Book 2 (BWV 870-893) — select 12 key preludes
  const wtc2Keys = [
    [870, "C Major"], [871, "C Minor"], [874, "D Major"], [875, "D Minor"],
    [878, "E Major"], [881, "F Minor"], [883, "F-sharp Minor"], [884, "G Major"],
    [885, "G Minor"], [887, "G-sharp Minor"], [889, "A Minor"], [893, "B Minor"],
  ];
  for (const [bwv, key] of wtc2Keys) {
    pieces.push({
      composer: "Johann Sebastian Bach",
      catalog: `BWV ${bwv}`,
      title: `Prelude and Fugue in ${key} (WTC Book 2)`,
      era: "Baroque",
      difficulty_estimate: "7-9",
    });
  }

  // English Suites (BWV 806-811) — 6 suites
  const engKeys = ["A Major", "A Minor", "G Minor", "F Major", "E Minor", "D Minor"];
  for (let i = 0; i < 6; i++) {
    pieces.push({
      composer: "Johann Sebastian Bach",
      catalog: `BWV ${806 + i}`,
      title: `English Suite No. ${i + 1} in ${engKeys[i]}`,
      era: "Baroque",
      difficulty_estimate: "7-9",
    });
  }

  // French Suites (BWV 812-817) — 6 suites
  const frKeys = ["D Minor", "C Minor", "B Minor", "E-flat Major", "G Major", "E Major"];
  for (let i = 0; i < 6; i++) {
    pieces.push({
      composer: "Johann Sebastian Bach",
      catalog: `BWV ${812 + i}`,
      title: `French Suite No. ${i + 1} in ${frKeys[i]}`,
      era: "Baroque",
      difficulty_estimate: "5-7",
    });
  }

  // Partitas (BWV 825-830) — 6 partitas
  const partitaKeys = ["B-flat Major", "C Minor", "A Minor", "D Major", "G Major", "E Minor"];
  for (let i = 0; i < 6; i++) {
    pieces.push({
      composer: "Johann Sebastian Bach",
      catalog: `BWV ${825 + i}`,
      title: `Partita No. ${i + 1} in ${partitaKeys[i]}`,
      era: "Baroque",
      difficulty_estimate: "7-9",
    });
  }

  // Goldberg Variations (BWV 988)
  pieces.push({
    composer: "Johann Sebastian Bach",
    catalog: "BWV 988",
    title: "Goldberg Variations — Aria",
    era: "Baroque",
    difficulty_estimate: "8-10",
  });

  // Italian Concerto (BWV 971)
  pieces.push({
    composer: "Johann Sebastian Bach",
    catalog: "BWV 971",
    title: "Italian Concerto in F Major",
    era: "Baroque",
    difficulty_estimate: "8-9",
  });

  // Chromatic Fantasia and Fugue (BWV 903)
  pieces.push({
    composer: "Johann Sebastian Bach",
    catalog: "BWV 903",
    title: "Chromatic Fantasia and Fugue in D Minor",
    era: "Baroque",
    difficulty_estimate: "9-10",
  });

  // Inventions & Sinfonias (select)
  pieces.push({
    composer: "Johann Sebastian Bach", catalog: "BWV 772",
    title: "Two-Part Invention No. 1 in C Major", era: "Baroque", difficulty_estimate: "3-4",
  });
  pieces.push({
    composer: "Johann Sebastian Bach", catalog: "BWV 775",
    title: "Two-Part Invention No. 4 in D Minor", era: "Baroque", difficulty_estimate: "3-4",
  });
  pieces.push({
    composer: "Johann Sebastian Bach", catalog: "BWV 779",
    title: "Two-Part Invention No. 8 in F Major", era: "Baroque", difficulty_estimate: "3-5",
  });
  pieces.push({
    composer: "Johann Sebastian Bach", catalog: "BWV 784",
    title: "Two-Part Invention No. 13 in A Minor", era: "Baroque", difficulty_estimate: "4-5",
  });

  // Toccatas
  pieces.push({
    composer: "Johann Sebastian Bach", catalog: "BWV 565",
    title: "Toccata and Fugue in D Minor", era: "Baroque", difficulty_estimate: "8-10",
  });

  // Cello Suites (piano transcriptions popular)
  pieces.push({
    composer: "Johann Sebastian Bach", catalog: "BWV 1007",
    title: "Cello Suite No. 1 in G Major — Prelude", era: "Baroque", difficulty_estimate: "4-6",
  });

  // Orchestral Suites
  pieces.push({
    composer: "Johann Sebastian Bach", catalog: "BWV 1068",
    title: "Air on the G String", era: "Baroque", difficulty_estimate: "3-5",
  });

  // Jesu, Joy of Man's Desiring (BWV 147)
  pieces.push({
    composer: "Johann Sebastian Bach", catalog: "BWV 147",
    title: "Jesu, Joy of Man's Desiring", era: "Baroque", difficulty_estimate: "4-6",
  });

  // Keyboard Concertos
  pieces.push({
    composer: "Johann Sebastian Bach", catalog: "BWV 1056",
    title: "Keyboard Concerto No. 5 in F Minor — Largo", era: "Baroque", difficulty_estimate: "5-7",
  });

  return pieces;
}

function mozartK(): PieceEntry[] {
  const pieces: PieceEntry[] = [];

  // Piano Sonatas (K. 279-284, 309-311, 330-333, 457, 475, 533, 545, 570, 576)
  const sonatas: [number, string, string][] = [
    [279, "Piano Sonata No. 1 in C Major", "5-6"],
    [280, "Piano Sonata No. 2 in F Major", "5-7"],
    [281, "Piano Sonata No. 3 in B-flat Major", "5-7"],
    [282, "Piano Sonata No. 4 in E-flat Major", "5-7"],
    [283, "Piano Sonata No. 5 in G Major", "5-6"],
    [284, "Piano Sonata No. 6 in D Major", "6-7"],
    [309, "Piano Sonata No. 7 in C Major", "6-8"],
    [310, "Piano Sonata No. 8 in A Minor", "7-9"],
    [311, "Piano Sonata No. 9 in D Major", "6-8"],
    [330, "Piano Sonata No. 10 in C Major", "6-8"],
    [331, "Piano Sonata No. 11 in A Major (Alla Turca)", "6-8"],
    [332, "Piano Sonata No. 12 in F Major", "6-8"],
    [333, "Piano Sonata No. 13 in B-flat Major", "6-8"],
    [457, "Piano Sonata No. 14 in C Minor", "8-9"],
    [545, "Piano Sonata No. 16 in C Major", "4-6"],
    [570, "Piano Sonata No. 17 in B-flat Major", "6-8"],
    [576, "Piano Sonata No. 18 in D Major", "8-9"],
  ];
  for (const [k, title, diff] of sonatas) {
    pieces.push({
      composer: "Wolfgang Amadeus Mozart",
      catalog: `K. ${k}`,
      title,
      era: "Classical",
      difficulty_estimate: diff,
    });
  }

  // Famous Fantasias
  pieces.push({
    composer: "Wolfgang Amadeus Mozart", catalog: "K. 397",
    title: "Fantasia in D Minor", era: "Classical", difficulty_estimate: "6-8",
  });
  pieces.push({
    composer: "Wolfgang Amadeus Mozart", catalog: "K. 475",
    title: "Fantasia in C Minor", era: "Classical", difficulty_estimate: "8-9",
  });

  // Rondo alla Turca (from K. 331 — already covered, but standalone arrangement)
  pieces.push({
    composer: "Wolfgang Amadeus Mozart", catalog: "K. 331",
    title: "Rondo alla Turca", era: "Classical", difficulty_estimate: "5-7",
  });

  // Piano Concertos (select major ones — piano reductions)
  const concertos: [number, string, string][] = [
    [466, "Piano Concerto No. 20 in D Minor", "8-10"],
    [467, "Piano Concerto No. 21 in C Major (Elvira Madigan)", "8-10"],
    [488, "Piano Concerto No. 23 in A Major", "8-10"],
    [491, "Piano Concerto No. 24 in C Minor", "9-10"],
  ];
  for (const [k, title, diff] of concertos) {
    pieces.push({
      composer: "Wolfgang Amadeus Mozart", catalog: `K. ${k}`, title, era: "Classical", difficulty_estimate: diff,
    });
  }

  // Variations
  pieces.push({
    composer: "Wolfgang Amadeus Mozart", catalog: "K. 265",
    title: "Twelve Variations on 'Ah vous dirai-je, Maman' (Twinkle Twinkle)",
    era: "Classical", difficulty_estimate: "4-6",
  });

  // Eine kleine Nachtmusik (piano reduction)
  pieces.push({
    composer: "Wolfgang Amadeus Mozart", catalog: "K. 525",
    title: "Eine kleine Nachtmusik — Allegro", era: "Classical", difficulty_estimate: "4-6",
  });

  // Requiem — Lacrimosa (piano arrangement)
  pieces.push({
    composer: "Wolfgang Amadeus Mozart", catalog: "K. 626",
    title: "Requiem — Lacrimosa", era: "Classical", difficulty_estimate: "5-7",
  });

  return pieces;
}

function beethovenOpus(): PieceEntry[] {
  const pieces: PieceEntry[] = [];

  // Piano Sonatas (all 32)
  const sonatas: [string, string, string][] = [
    ["Op. 2 No. 1", "Piano Sonata No. 1 in F Minor", "6-8"],
    ["Op. 2 No. 2", "Piano Sonata No. 2 in A Major", "7-9"],
    ["Op. 2 No. 3", "Piano Sonata No. 3 in C Major", "8-10"],
    ["Op. 7", "Piano Sonata No. 4 in E-flat Major (Grand Sonata)", "8-9"],
    ["Op. 10 No. 1", "Piano Sonata No. 5 in C Minor", "7-8"],
    ["Op. 10 No. 2", "Piano Sonata No. 6 in F Major", "6-8"],
    ["Op. 10 No. 3", "Piano Sonata No. 7 in D Major", "8-9"],
    ["Op. 13", "Piano Sonata No. 8 in C Minor (Pathétique)", "7-9"],
    ["Op. 14 No. 1", "Piano Sonata No. 9 in E Major", "5-7"],
    ["Op. 14 No. 2", "Piano Sonata No. 10 in G Major", "5-7"],
    ["Op. 22", "Piano Sonata No. 11 in B-flat Major", "8-9"],
    ["Op. 26", "Piano Sonata No. 12 in A-flat Major (Funeral March)", "7-9"],
    ["Op. 27 No. 1", "Piano Sonata No. 13 in E-flat Major", "8-9"],
    ["Op. 27 No. 2", "Piano Sonata No. 14 in C-sharp Minor (Moonlight)", "7-9"],
    ["Op. 28", "Piano Sonata No. 15 in D Major (Pastoral)", "7-9"],
    ["Op. 31 No. 1", "Piano Sonata No. 16 in G Major", "7-9"],
    ["Op. 31 No. 2", "Piano Sonata No. 17 in D Minor (Tempest)", "8-10"],
    ["Op. 31 No. 3", "Piano Sonata No. 18 in E-flat Major (The Hunt)", "8-9"],
    ["Op. 49 No. 1", "Piano Sonata No. 19 in G Minor", "3-5"],
    ["Op. 49 No. 2", "Piano Sonata No. 20 in G Major", "3-5"],
    ["Op. 53", "Piano Sonata No. 21 in C Major (Waldstein)", "9-10"],
    ["Op. 54", "Piano Sonata No. 22 in F Major", "8-9"],
    ["Op. 57", "Piano Sonata No. 23 in F Minor (Appassionata)", "10+"],
    ["Op. 78", "Piano Sonata No. 24 in F-sharp Major", "8-9"],
    ["Op. 79", "Piano Sonata No. 25 in G Major (Cuckoo)", "6-7"],
    ["Op. 81a", "Piano Sonata No. 26 in E-flat Major (Les Adieux)", "8-10"],
    ["Op. 90", "Piano Sonata No. 27 in E Minor", "8-9"],
    ["Op. 101", "Piano Sonata No. 28 in A Major", "9-10"],
    ["Op. 106", "Piano Sonata No. 29 in B-flat Major (Hammerklavier)", "10+"],
    ["Op. 109", "Piano Sonata No. 30 in E Major", "9-10"],
    ["Op. 110", "Piano Sonata No. 31 in A-flat Major", "9-10"],
    ["Op. 111", "Piano Sonata No. 32 in C Minor", "9-10"],
  ];
  for (const [op, title, diff] of sonatas) {
    pieces.push({
      composer: "Ludwig van Beethoven", catalog: op, title, era: "Classical/Romantic", difficulty_estimate: diff,
    });
  }

  // Bagatelles
  pieces.push({
    composer: "Ludwig van Beethoven", catalog: "WoO 59",
    title: "Bagatelle in A Minor (Für Elise)", era: "Classical/Romantic", difficulty_estimate: "3-5",
  });
  pieces.push({
    composer: "Ludwig van Beethoven", catalog: "Op. 33",
    title: "Seven Bagatelles", era: "Classical/Romantic", difficulty_estimate: "4-7",
  });
  pieces.push({
    composer: "Ludwig van Beethoven", catalog: "Op. 119",
    title: "Eleven Bagatelles", era: "Classical/Romantic", difficulty_estimate: "5-8",
  });
  pieces.push({
    composer: "Ludwig van Beethoven", catalog: "Op. 126",
    title: "Six Bagatelles", era: "Classical/Romantic", difficulty_estimate: "7-9",
  });

  // Symphonies (piano arrangements)
  const symphonies = [
    ["Op. 21", "Symphony No. 1 in C Major"],
    ["Op. 36", "Symphony No. 2 in D Major"],
    ["Op. 55", "Symphony No. 3 in E-flat Major (Eroica)"],
    ["Op. 60", "Symphony No. 4 in B-flat Major"],
    ["Op. 67", "Symphony No. 5 in C Minor (Fate)"],
    ["Op. 68", "Symphony No. 6 in F Major (Pastoral)"],
    ["Op. 92", "Symphony No. 7 in A Major"],
    ["Op. 93", "Symphony No. 8 in F Major"],
    ["Op. 125", "Symphony No. 9 in D Minor (Choral) — Ode to Joy"],
  ];
  for (const [op, title] of symphonies) {
    pieces.push({
      composer: "Ludwig van Beethoven", catalog: op, title, era: "Classical/Romantic", difficulty_estimate: "5-8",
    });
  }

  // Piano Concertos
  pieces.push({
    composer: "Ludwig van Beethoven", catalog: "Op. 73",
    title: "Piano Concerto No. 5 in E-flat Major (Emperor)", era: "Classical/Romantic", difficulty_estimate: "9-10",
  });

  // Diabelli Variations
  pieces.push({
    composer: "Ludwig van Beethoven", catalog: "Op. 120",
    title: "Diabelli Variations", era: "Classical/Romantic", difficulty_estimate: "10+",
  });

  return pieces;
}

function chopinOpus(): PieceEntry[] {
  const pieces: PieceEntry[] = [];

  // Nocturnes
  const nocturnes: [string, string, string][] = [
    ["Op. 9 No. 1", "Nocturne in B-flat Minor", "6-8"],
    ["Op. 9 No. 2", "Nocturne in E-flat Major", "6-7"],
    ["Op. 15 No. 1", "Nocturne in F Major", "7-8"],
    ["Op. 15 No. 2", "Nocturne in F-sharp Major", "7-8"],
    ["Op. 27 No. 1", "Nocturne in C-sharp Minor", "8-9"],
    ["Op. 27 No. 2", "Nocturne in D-flat Major", "8-9"],
    ["Op. 32 No. 1", "Nocturne in B Major", "7-8"],
    ["Op. 32 No. 2", "Nocturne in A-flat Major", "7-8"],
    ["Op. 37 No. 1", "Nocturne in G Minor", "6-8"],
    ["Op. 48 No. 1", "Nocturne in C Minor", "8-9"],
    ["Op. 55 No. 1", "Nocturne in F Minor", "7-9"],
    ["Op. 62 No. 1", "Nocturne in B Major", "8-9"],
    ["Op. 72 No. 1", "Nocturne in E Minor (Posth.)", "6-8"],
  ];
  for (const [op, title, diff] of nocturnes) {
    pieces.push({
      composer: "Frédéric Chopin", catalog: op, title, era: "Romantic", difficulty_estimate: diff,
    });
  }

  // Études
  const etudes: [string, string, string][] = [
    ["Op. 10 No. 1", "Étude in C Major (Waterfall)", "10+"],
    ["Op. 10 No. 3", "Étude in E Major (Tristesse)", "7-9"],
    ["Op. 10 No. 4", "Étude in C-sharp Minor (Torrent)", "10+"],
    ["Op. 10 No. 5", "Étude in G-flat Major (Black Key)", "9-10"],
    ["Op. 10 No. 12", "Étude in C Minor (Revolutionary)", "9-10"],
    ["Op. 25 No. 1", "Étude in A-flat Major (Aeolian Harp)", "8-10"],
    ["Op. 25 No. 2", "Étude in F Minor (The Bees)", "8-10"],
    ["Op. 25 No. 9", "Étude in G-flat Major (Butterfly)", "8-9"],
    ["Op. 25 No. 11", "Étude in A Minor (Winter Wind)", "10+"],
    ["Op. 25 No. 12", "Étude in C Minor (Ocean)", "10+"],
  ];
  for (const [op, title, diff] of etudes) {
    pieces.push({ composer: "Frédéric Chopin", catalog: op, title, era: "Romantic", difficulty_estimate: diff });
  }

  // Waltzes
  const waltzes: [string, string, string][] = [
    ["Op. 18", "Grande Valse Brillante in E-flat Major", "7-9"],
    ["Op. 34 No. 1", "Waltz in A-flat Major", "7-8"],
    ["Op. 34 No. 2", "Waltz in A Minor", "6-7"],
    ["Op. 42", "Waltz in A-flat Major (Grande Valse)", "8-9"],
    ["Op. 64 No. 1", "Waltz in D-flat Major (Minute Waltz)", "7-9"],
    ["Op. 64 No. 2", "Waltz in C-sharp Minor", "7-8"],
    ["Op. 69 No. 1", "Waltz in A-flat Major (L'Adieu)", "6-8"],
    ["Op. 69 No. 2", "Waltz in B Minor", "6-7"],
  ];
  for (const [op, title, diff] of waltzes) {
    pieces.push({ composer: "Frédéric Chopin", catalog: op, title, era: "Romantic", difficulty_estimate: diff });
  }

  // Polonaises
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 26 No. 1", title: "Polonaise in C-sharp Minor", era: "Romantic", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 40 No. 1", title: "Polonaise in A Major (Military)", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 44", title: "Polonaise in F-sharp Minor", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 53", title: "Polonaise in A-flat Major (Heroic)", era: "Romantic", difficulty_estimate: "9-10" });

  // Ballades
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 23", title: "Ballade No. 1 in G Minor", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 38", title: "Ballade No. 2 in F Major", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 47", title: "Ballade No. 3 in A-flat Major", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 52", title: "Ballade No. 4 in F Minor", era: "Romantic", difficulty_estimate: "10+" });

  // Preludes (Op. 28)
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 4", title: "Prelude in E Minor", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 6", title: "Prelude in B Minor", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 7", title: "Prelude in A Major", era: "Romantic", difficulty_estimate: "2-4" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 15", title: "Prelude in D-flat Major (Raindrop)", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 20", title: "Prelude in C Minor (Funeral)", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 22", title: "Prelude in G Minor", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 24", title: "Prelude in D Minor", era: "Romantic", difficulty_estimate: "8-10" });

  // Scherzi
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 20", title: "Scherzo No. 1 in B Minor", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 31", title: "Scherzo No. 2 in B-flat Minor", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 39", title: "Scherzo No. 3 in C-sharp Minor", era: "Romantic", difficulty_estimate: "9-10" });

  // Impromptus
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 29", title: "Impromptu No. 1 in A-flat Major", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 36", title: "Impromptu No. 2 in F-sharp Major", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 51", title: "Impromptu No. 3 in G-flat Major", era: "Romantic", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 66", title: "Fantaisie-Impromptu in C-sharp Minor", era: "Romantic", difficulty_estimate: "9-10" });

  // Mazurkas (select famous ones)
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 7 No. 1", title: "Mazurka in B-flat Major", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 17 No. 4", title: "Mazurka in A Minor", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 33 No. 2", title: "Mazurka in D Major", era: "Romantic", difficulty_estimate: "6-7" });

  // Other famous works
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 35", title: "Piano Sonata No. 2 in B-flat Minor (Funeral March)", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 49", title: "Fantaisie in F Minor", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "B. 150", title: "Waltz in A Minor (Posthumous)", era: "Romantic", difficulty_estimate: "3-5" });

  return pieces;
}

function debussyL(): PieceEntry[] {
  const pieces: PieceEntry[] = [];

  pieces.push({ composer: "Claude Debussy", catalog: "L. 117", title: "Clair de Lune", era: "Impressionist", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 125", title: "Suite Bergamasque — Prélude", era: "Impressionist", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 75", title: "Arabesque No. 1", era: "Impressionist", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 75", title: "Arabesque No. 2", era: "Impressionist", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 131", title: "Children's Corner — Doctor Gradus ad Parnassum", era: "Impressionist", difficulty_estimate: "7-8" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 131", title: "Children's Corner — The Little Shepherd", era: "Impressionist", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 131", title: "Children's Corner — Golliwogg's Cakewalk", era: "Impressionist", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 119", title: "Préludes Book 1 — La fille aux cheveux de lin", era: "Impressionist", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 119", title: "Préludes Book 1 — La cathédrale engloutie", era: "Impressionist", difficulty_estimate: "8-10" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 119", title: "Préludes Book 1 — Minstrels", era: "Impressionist", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 123", title: "Préludes Book 2 — Bruyères", era: "Impressionist", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 123", title: "Préludes Book 2 — Feux d'artifice", era: "Impressionist", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 100", title: "Estampes — Pagodes", era: "Impressionist", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 100", title: "Estampes — Jardins sous la pluie", era: "Impressionist", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Claude Debussy", catalog: "L. 117", title: "Rêverie", era: "Impressionist", difficulty_estimate: "5-7" });

  return pieces;
}

function lisztS(): PieceEntry[] {
  const pieces: PieceEntry[] = [];

  pieces.push({ composer: "Franz Liszt", catalog: "S. 541", title: "Liebestraum No. 3", era: "Romantic", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Franz Liszt", catalog: "S. 172", title: "Consolation No. 3 in D-flat Major", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Franz Liszt", catalog: "S. 139", title: "Hungarian Rhapsody No. 2", era: "Romantic", difficulty_estimate: "10+" });
  pieces.push({ composer: "Franz Liszt", catalog: "S. 244", title: "Hungarian Rhapsody No. 6", era: "Romantic", difficulty_estimate: "10+" });
  pieces.push({ composer: "Franz Liszt", catalog: "S. 160", title: "La Campanella", era: "Romantic", difficulty_estimate: "10+" });
  pieces.push({ composer: "Franz Liszt", catalog: "S. 144", title: "Étude Transcendante No. 3 (Paysage)", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Franz Liszt", catalog: "S. 178", title: "Piano Sonata in B Minor", era: "Romantic", difficulty_estimate: "10+" });
  pieces.push({ composer: "Franz Liszt", catalog: "S. 175", title: "Mephisto Waltz No. 1", era: "Romantic", difficulty_estimate: "10+" });
  pieces.push({ composer: "Franz Liszt", catalog: "S. 169", title: "Romance Oubliée", era: "Romantic", difficulty_estimate: "7-8" });
  pieces.push({ composer: "Franz Liszt", catalog: "S. 173", title: "Un Sospiro", era: "Romantic", difficulty_estimate: "9-10" });

  return pieces;
}

function schubertD(): PieceEntry[] {
  const pieces: PieceEntry[] = [];

  pieces.push({ composer: "Franz Schubert", catalog: "D. 899 No. 1", title: "Impromptu in C Minor", era: "Romantic", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 899 No. 2", title: "Impromptu in E-flat Major", era: "Romantic", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 899 No. 3", title: "Impromptu in G-flat Major", era: "Romantic", difficulty_estimate: "7-8" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 899 No. 4", title: "Impromptu in A-flat Major", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 935 No. 2", title: "Impromptu in A-flat Major (Op. 142)", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 946 No. 1", title: "Impromptu in E-flat Minor", era: "Romantic", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 780 No. 3", title: "Moment Musical in F Minor", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 780 No. 6", title: "Moment Musical in A-flat Major", era: "Romantic", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 760", title: "Wanderer Fantasy in C Major", era: "Romantic", difficulty_estimate: "10+" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 946 No. 2", title: "Klavierstück in E-flat Major", era: "Romantic", difficulty_estimate: "7-9" });

  return pieces;
}

function schumannOpus(): PieceEntry[] {
  const pieces: PieceEntry[] = [];

  pieces.push({ composer: "Robert Schumann", catalog: "Op. 15 No. 1", title: "Kinderszenen — Von fremden Ländern und Menschen", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Robert Schumann", catalog: "Op. 15 No. 7", title: "Kinderszenen — Träumerei", era: "Romantic", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Robert Schumann", catalog: "Op. 68 No. 1", title: "Album for the Young — Melodie", era: "Romantic", difficulty_estimate: "1-3" });
  pieces.push({ composer: "Robert Schumann", catalog: "Op. 68 No. 10", title: "Album for the Young — Fröhlicher Landmann", era: "Romantic", difficulty_estimate: "2-4" });
  pieces.push({ composer: "Robert Schumann", catalog: "Op. 2", title: "Papillons", era: "Romantic", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Robert Schumann", catalog: "Op. 9", title: "Carnaval", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Robert Schumann", catalog: "Op. 12 No. 2", title: "Fantasiestücke — Aufschwung", era: "Romantic", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Robert Schumann", catalog: "Op. 12 No. 3", title: "Fantasiestücke — Warum?", era: "Romantic", difficulty_estimate: "7-8" });
  pieces.push({ composer: "Robert Schumann", catalog: "Op. 18", title: "Arabeske in C Major", era: "Romantic", difficulty_estimate: "7-8" });
  pieces.push({ composer: "Robert Schumann", catalog: "Op. 82", title: "Waldszenen — Eintritt", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Robert Schumann", catalog: "Op. 82 No. 7", title: "Waldszenen — Vogel als Prophet", era: "Romantic", difficulty_estimate: "7-9" });

  return pieces;
}

function brahmsOpus(): PieceEntry[] {
  const pieces: PieceEntry[] = [];

  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 10 No. 1", title: "Ballade in D Minor (Edward)", era: "Romantic", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 39", title: "Waltzes for Piano", era: "Romantic", difficulty_estimate: "5-8" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 39 No. 15", title: "Waltz in A-flat Major", era: "Romantic", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 49 No. 4", title: "Wiegenlied (Lullaby)", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 76 No. 2", title: "Capriccio in B Minor", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 79 No. 1", title: "Rhapsody in B Minor", era: "Romantic", difficulty_estimate: "8-10" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 79 No. 2", title: "Rhapsody in G Minor", era: "Romantic", difficulty_estimate: "8-10" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 116 No. 4", title: "Intermezzo in E Major", era: "Romantic", difficulty_estimate: "6-7" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 117 No. 1", title: "Intermezzo in E-flat Major", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 118 No. 2", title: "Intermezzo in A Major", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 118 No. 3", title: "Ballade in G Minor", era: "Romantic", difficulty_estimate: "7-8" });

  return pieces;
}

function handelHWV(): PieceEntry[] {
  const pieces: PieceEntry[] = [];

  pieces.push({ composer: "George Frideric Handel", catalog: "HWV 348", title: "Water Music — Suite No. 1 (piano arrangement)", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "George Frideric Handel", catalog: "HWV 349", title: "Water Music — Suite No. 2 (piano arrangement)", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "George Frideric Handel", catalog: "HWV 56", title: "Messiah — Hallelujah Chorus (piano arrangement)", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "George Frideric Handel", catalog: "HWV 351", title: "Music for the Royal Fireworks (piano arrangement)", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "George Frideric Handel", catalog: "HWV 430", title: "Keyboard Suite No. 1 in A Major", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "George Frideric Handel", catalog: "HWV 432", title: "Keyboard Suite No. 5 in E Major (The Harmonious Blacksmith)", era: "Baroque", difficulty_estimate: "6-8" });
  pieces.push({ composer: "George Frideric Handel", catalog: "HWV 434", title: "Keyboard Suite No. 7 in G Minor — Passacaglia", era: "Baroque", difficulty_estimate: "7-9" });
  pieces.push({ composer: "George Frideric Handel", catalog: "HWV 40", title: "Largo from Xerxes (Ombra mai fu)", era: "Baroque", difficulty_estimate: "3-5" });

  return pieces;
}

function otherComposers(): PieceEntry[] {
  const pieces: PieceEntry[] = [];

  // Tchaikovsky
  pieces.push({ composer: "Pyotr Ilyich Tchaikovsky", catalog: "Op. 37a", title: "The Seasons — January (By the Hearth)", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Pyotr Ilyich Tchaikovsky", catalog: "Op. 37a", title: "The Seasons — February (Carnival)", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Pyotr Ilyich Tchaikovsky", catalog: "Op. 37a", title: "The Seasons — June (Barcarolle)", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Pyotr Ilyich Tchaikovsky", catalog: "Op. 37a", title: "The Seasons — October (Autumn Song)", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Pyotr Ilyich Tchaikovsky", catalog: "Op. 71a", title: "Nutcracker Suite — Dance of the Sugar Plum Fairy", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Pyotr Ilyich Tchaikovsky", catalog: "Op. 71a", title: "Nutcracker Suite — Waltz of the Flowers", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Pyotr Ilyich Tchaikovsky", catalog: "Op. 71a", title: "Nutcracker Suite — March", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Pyotr Ilyich Tchaikovsky", catalog: "Op. 20", title: "Swan Lake — Theme", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Pyotr Ilyich Tchaikovsky", catalog: "Op. 23", title: "Piano Concerto No. 1 — Opening Theme", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Pyotr Ilyich Tchaikovsky", catalog: "Op. 66", title: "Sleeping Beauty — Waltz (piano arrangement)", era: "Romantic", difficulty_estimate: "6-8" });

  // Rachmaninoff (pre-1923 works only)
  pieces.push({ composer: "Sergei Rachmaninoff", catalog: "Op. 3 No. 2", title: "Prelude in C-sharp Minor", era: "Romantic", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Sergei Rachmaninoff", catalog: "Op. 3 No. 1", title: "Élégie in E-flat Minor", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Sergei Rachmaninoff", catalog: "Op. 23 No. 5", title: "Prelude in G Minor", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Sergei Rachmaninoff", catalog: "Op. 23 No. 4", title: "Prelude in D Major", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Sergei Rachmaninoff", catalog: "Op. 32 No. 10", title: "Prelude in B Minor", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Sergei Rachmaninoff", catalog: "Op. 32 No. 12", title: "Prelude in G-sharp Minor", era: "Romantic", difficulty_estimate: "8-10" });

  // Ravel
  pieces.push({ composer: "Maurice Ravel", catalog: "M. 19", title: "Pavane pour une infante défunte", era: "Impressionist", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Maurice Ravel", catalog: "M. 43", title: "Le Tombeau de Couperin — Prélude", era: "Impressionist", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Maurice Ravel", catalog: "M. 43", title: "Le Tombeau de Couperin — Forlane", era: "Impressionist", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Maurice Ravel", catalog: "M. 43", title: "Le Tombeau de Couperin — Menuet", era: "Impressionist", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Maurice Ravel", catalog: "M. 43", title: "Le Tombeau de Couperin — Rigaudon", era: "Impressionist", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Maurice Ravel", catalog: "M. 7", title: "Jeux d'eau", era: "Impressionist", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Maurice Ravel", catalog: "M. 30", title: "Sonatine — Modéré", era: "Impressionist", difficulty_estimate: "7-9" });

  // Satie
  pieces.push({ composer: "Erik Satie", catalog: "", title: "Gymnopédie No. 1", era: "Modern", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Erik Satie", catalog: "", title: "Gymnopédie No. 2", era: "Modern", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Erik Satie", catalog: "", title: "Gymnopédie No. 3", era: "Modern", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Erik Satie", catalog: "", title: "Gnossienne No. 1", era: "Modern", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Erik Satie", catalog: "", title: "Gnossienne No. 2", era: "Modern", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Erik Satie", catalog: "", title: "Gnossienne No. 3", era: "Modern", difficulty_estimate: "4-6" });

  // Mendelssohn
  pieces.push({ composer: "Felix Mendelssohn", catalog: "Op. 19 No. 1", title: "Songs Without Words — Sweet Remembrance", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Felix Mendelssohn", catalog: "Op. 19 No. 6", title: "Songs Without Words — Venetian Boat Song No. 1", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Felix Mendelssohn", catalog: "Op. 30 No. 6", title: "Songs Without Words — Venetian Boat Song No. 2", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Felix Mendelssohn", catalog: "Op. 62 No. 6", title: "Songs Without Words — Spring Song", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Felix Mendelssohn", catalog: "Op. 38 No. 6", title: "Songs Without Words — Duetto", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Felix Mendelssohn", catalog: "Op. 67 No. 4", title: "Songs Without Words — Spinning Song", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Felix Mendelssohn", catalog: "Op. 14", title: "Rondo Capriccioso in E Major", era: "Romantic", difficulty_estimate: "8-10" });

  // Scarlatti
  pieces.push({ composer: "Domenico Scarlatti", catalog: "K. 1", title: "Sonata in D Minor", era: "Baroque", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Domenico Scarlatti", catalog: "K. 9", title: "Sonata in D Minor (Pastorale)", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Domenico Scarlatti", catalog: "K. 27", title: "Sonata in B Minor", era: "Baroque", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Domenico Scarlatti", catalog: "K. 87", title: "Sonata in B Minor", era: "Baroque", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Domenico Scarlatti", catalog: "K. 141", title: "Sonata in D Minor (Toccata)", era: "Baroque", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Domenico Scarlatti", catalog: "K. 380", title: "Sonata in E Major (Cortège)", era: "Baroque", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Domenico Scarlatti", catalog: "K. 531", title: "Sonata in E Major", era: "Baroque", difficulty_estimate: "6-8" });

  // Grieg
  pieces.push({ composer: "Edvard Grieg", catalog: "Op. 12 No. 1", title: "Lyric Pieces — Arietta", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Edvard Grieg", catalog: "Op. 12 No. 4", title: "Lyric Pieces — Elves' Dance", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Edvard Grieg", catalog: "Op. 43 No. 6", title: "Lyric Pieces — To Spring", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Edvard Grieg", catalog: "Op. 54 No. 4", title: "Lyric Pieces — Notturno", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Edvard Grieg", catalog: "Op. 54 No. 3", title: "Lyric Pieces — March of the Trolls", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Edvard Grieg", catalog: "Op. 65 No. 6", title: "Lyric Pieces — Wedding Day at Troldhaugen", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Edvard Grieg", catalog: "Op. 16", title: "Piano Concerto in A Minor — Opening Theme", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Edvard Grieg", catalog: "Op. 46 No. 1", title: "Peer Gynt Suite — Morning Mood", era: "Romantic", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Edvard Grieg", catalog: "Op. 46 No. 4", title: "Peer Gynt Suite — In the Hall of the Mountain King", era: "Romantic", difficulty_estimate: "5-7" });

  // Haydn
  pieces.push({ composer: "Joseph Haydn", catalog: "Hob. XVI/34", title: "Piano Sonata in E Minor", era: "Classical", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Joseph Haydn", catalog: "Hob. XVI/37", title: "Piano Sonata in D Major", era: "Classical", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Joseph Haydn", catalog: "Hob. XVI/49", title: "Piano Sonata in E-flat Major", era: "Classical", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Joseph Haydn", catalog: "Hob. XVI/52", title: "Piano Sonata in E-flat Major", era: "Classical", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Joseph Haydn", catalog: "Hob. XVI/27", title: "Piano Sonata in G Major", era: "Classical", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Joseph Haydn", catalog: "Hob. XVI/35", title: "Piano Sonata in C Major", era: "Classical", difficulty_estimate: "5-7" });

  // Vivaldi
  pieces.push({ composer: "Antonio Vivaldi", catalog: "RV 269", title: "The Four Seasons — Spring (piano arrangement)", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Antonio Vivaldi", catalog: "RV 315", title: "The Four Seasons — Summer (piano arrangement)", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Antonio Vivaldi", catalog: "RV 293", title: "The Four Seasons — Autumn (piano arrangement)", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Antonio Vivaldi", catalog: "RV 297", title: "The Four Seasons — Winter (piano arrangement)", era: "Baroque", difficulty_estimate: "5-7" });

  // Pachelbel
  pieces.push({ composer: "Johann Pachelbel", catalog: "P. 37", title: "Canon in D Major (piano arrangement)", era: "Baroque", difficulty_estimate: "3-5" });

  // Albinoni
  pieces.push({ composer: "Tomaso Albinoni", catalog: "", title: "Adagio in G Minor (piano arrangement)", era: "Baroque", difficulty_estimate: "4-6" });

  // Dvořák
  pieces.push({ composer: "Antonín Dvořák", catalog: "Op. 101 No. 7", title: "Humoresque in G-flat Major", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Antonín Dvořák", catalog: "Op. 95", title: "Symphony No. 9 — Largo (New World) (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Antonín Dvořák", catalog: "Op. 72 No. 2", title: "Slavonic Dance in E Minor", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Antonín Dvořák", catalog: "Op. 46 No. 8", title: "Slavonic Dance in G Minor", era: "Romantic", difficulty_estimate: "6-8" });

  // Fauré
  pieces.push({ composer: "Gabriel Fauré", catalog: "Op. 50", title: "Pavane", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Gabriel Fauré", catalog: "Op. 17 No. 3", title: "Romances sans paroles", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Gabriel Fauré", catalog: "Op. 48", title: "Requiem — Pie Jesu", era: "Romantic", difficulty_estimate: "4-6" });

  // Granados
  pieces.push({ composer: "Enrique Granados", catalog: "Op. 37 No. 5", title: "Danzas Españolas — Andaluza", era: "Romantic", difficulty_estimate: "7-9" });

  // Albéniz
  pieces.push({ composer: "Isaac Albéniz", catalog: "Op. 47 No. 5", title: "Suite Española — Asturias (Leyenda)", era: "Romantic", difficulty_estimate: "8-10" });
  pieces.push({ composer: "Isaac Albéniz", catalog: "Op. 232 No. 1", title: "Cantos de España — Córdoba", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Isaac Albéniz", catalog: "Op. 47 No. 3", title: "Suite Española — Sevilla", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Isaac Albéniz", catalog: "Op. 47 No. 2", title: "Suite Española — Cataluña", era: "Romantic", difficulty_estimate: "7-8" });

  // Joplin (pre-1923)
  pieces.push({ composer: "Scott Joplin", catalog: "", title: "Maple Leaf Rag", era: "Modern", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Scott Joplin", catalog: "", title: "The Entertainer", era: "Modern", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Scott Joplin", catalog: "", title: "Solace — A Mexican Serenade", era: "Modern", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Scott Joplin", catalog: "", title: "The Easy Winners", era: "Modern", difficulty_estimate: "5-7" });

  // Elgar
  pieces.push({ composer: "Edward Elgar", catalog: "Op. 39 No. 1", title: "Salut d'Amour", era: "Romantic", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Edward Elgar", catalog: "Op. 36", title: "Enigma Variations — Nimrod (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });

  // Sibelius
  pieces.push({ composer: "Jean Sibelius", catalog: "Op. 76 No. 2", title: "Étude in A Minor", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Jean Sibelius", catalog: "Op. 26", title: "Finlandia (piano arrangement)", era: "Romantic", difficulty_estimate: "6-8" });

  // Bartók (early PD works)
  pieces.push({ composer: "Béla Bartók", catalog: "Sz. 42", title: "For Children — selection", era: "Modern", difficulty_estimate: "2-4" });

  // Clementi (Sonatinas — standard teaching material)
  pieces.push({ composer: "Muzio Clementi", catalog: "Op. 36 No. 1", title: "Sonatina in C Major — Allegro", era: "Classical", difficulty_estimate: "2-4" });
  pieces.push({ composer: "Muzio Clementi", catalog: "Op. 36 No. 2", title: "Sonatina in G Major", era: "Classical", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Muzio Clementi", catalog: "Op. 36 No. 3", title: "Sonatina in C Major", era: "Classical", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Muzio Clementi", catalog: "Op. 36 No. 4", title: "Sonatina in F Major", era: "Classical", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Muzio Clementi", catalog: "Op. 36 No. 5", title: "Sonatina in G Major", era: "Classical", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Muzio Clementi", catalog: "Op. 36 No. 6", title: "Sonatina in D Major", era: "Classical", difficulty_estimate: "5-7" });

  // Czerny (studies and exercises)
  pieces.push({ composer: "Carl Czerny", catalog: "Op. 299 No. 1", title: "School of Velocity — Study in C Major", era: "Classical/Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Carl Czerny", catalog: "Op. 599 No. 1", title: "Practical Method for Beginners — Study in C Major", era: "Classical/Romantic", difficulty_estimate: "1-3" });
  pieces.push({ composer: "Carl Czerny", catalog: "Op. 740 No. 1", title: "Art of Finger Dexterity — Study in C Major", era: "Classical/Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Carl Czerny", catalog: "Op. 849 No. 1", title: "Thirty New Studies — Study in C Major", era: "Classical/Romantic", difficulty_estimate: "4-6" });

  // Kuhlau (Sonatinas)
  pieces.push({ composer: "Friedrich Kuhlau", catalog: "Op. 20 No. 1", title: "Sonatina in C Major", era: "Classical", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Friedrich Kuhlau", catalog: "Op. 55 No. 1", title: "Sonatina in C Major", era: "Classical", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Friedrich Kuhlau", catalog: "Op. 55 No. 3", title: "Sonatina in C Major", era: "Classical", difficulty_estimate: "4-6" });

  // Burgmüller (standard ABRSM teaching)
  pieces.push({ composer: "Friedrich Burgmüller", catalog: "Op. 100 No. 1", title: "La Candeur (Candor)", era: "Romantic", difficulty_estimate: "2-4" });
  pieces.push({ composer: "Friedrich Burgmüller", catalog: "Op. 100 No. 2", title: "L'Arabesque", era: "Romantic", difficulty_estimate: "2-4" });
  pieces.push({ composer: "Friedrich Burgmüller", catalog: "Op. 100 No. 7", title: "Le Courant Limpide (The Limpid Stream)", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Friedrich Burgmüller", catalog: "Op. 100 No. 15", title: "Ballade", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Friedrich Burgmüller", catalog: "Op. 100 No. 20", title: "La Tarentelle", era: "Romantic", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Friedrich Burgmüller", catalog: "Op. 100 No. 25", title: "La Chevaleresque", era: "Romantic", difficulty_estimate: "4-6" });

  // Heller
  pieces.push({ composer: "Stephen Heller", catalog: "Op. 45 No. 1", title: "Étude in C Major", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Stephen Heller", catalog: "Op. 47 No. 3", title: "Étude in E Minor (The Avalanche)", era: "Romantic", difficulty_estimate: "4-6" });

  // CPE Bach
  pieces.push({ composer: "Carl Philipp Emanuel Bach", catalog: "Wq. 59 No. 1", title: "Sonata in E Major", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Carl Philipp Emanuel Bach", catalog: "Wq. 55 No. 4", title: "Sonata in A Major", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Carl Philipp Emanuel Bach", catalog: "Wq. 117 No. 1", title: "Solfeggietto in C Minor", era: "Baroque", difficulty_estimate: "4-6" });

  // JC Bach
  pieces.push({ composer: "Johann Christian Bach", catalog: "Op. 5 No. 2", title: "Keyboard Sonata in D Major", era: "Classical", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Johann Christian Bach", catalog: "Op. 17 No. 2", title: "Keyboard Sonata in C Minor", era: "Classical", difficulty_estimate: "4-6" });

  // Pergolesi
  pieces.push({ composer: "Giovanni Battista Pergolesi", catalog: "", title: "Stabat Mater — opening (piano arrangement)", era: "Baroque", difficulty_estimate: "4-6" });

  // Boccherini
  pieces.push({ composer: "Luigi Boccherini", catalog: "Op. 11 No. 5", title: "Minuet in A Major (piano arrangement)", era: "Classical", difficulty_estimate: "2-4" });

  // Gluck
  pieces.push({ composer: "Christoph Willibald Gluck", catalog: "", title: "Orfeo ed Euridice — Dance of the Blessed Spirits", era: "Classical", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Christoph Willibald Gluck", catalog: "", title: "Orfeo ed Euridice — Melody", era: "Classical", difficulty_estimate: "3-5" });

  // Saint-Saëns
  pieces.push({ composer: "Camille Saint-Saëns", catalog: "Op. 168", title: "The Carnival of the Animals — The Swan", era: "Romantic", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Camille Saint-Saëns", catalog: "Op. 22", title: "Piano Concerto No. 2 — Andante", era: "Romantic", difficulty_estimate: "7-9" });

  // Massenet
  pieces.push({ composer: "Jules Massenet", catalog: "", title: "Méditation from Thaïs (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });

  // Delibes
  pieces.push({ composer: "Léo Delibes", catalog: "", title: "Flower Duet from Lakmé (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });

  // Offenbach
  pieces.push({ composer: "Jacques Offenbach", catalog: "", title: "Orpheus in the Underworld — Can-Can (piano arrangement)", era: "Romantic", difficulty_estimate: "4-6" });

  // Bizet
  pieces.push({ composer: "Georges Bizet", catalog: "WD 31", title: "Carmen — Habanera (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Georges Bizet", catalog: "WD 31", title: "Carmen — Toreador Song (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });

  // Puccini (pre-1923 works)
  pieces.push({ composer: "Giacomo Puccini", catalog: "", title: "Madama Butterfly — Un bel dì (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Giacomo Puccini", catalog: "", title: "Tosca — Vissi d'arte (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });

  // Verdi
  pieces.push({ composer: "Giuseppe Verdi", catalog: "", title: "La donna è mobile (piano arrangement)", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Giuseppe Verdi", catalog: "", title: "Nabucco — Chorus of the Hebrew Slaves (piano arrangement)", era: "Romantic", difficulty_estimate: "4-6" });

  // Rossini
  pieces.push({ composer: "Gioachino Rossini", catalog: "", title: "William Tell Overture — Finale (piano arrangement)", era: "Classical/Romantic", difficulty_estimate: "5-7" });

  // Borodin
  pieces.push({ composer: "Alexander Borodin", catalog: "", title: "Prince Igor — Polovtsian Dances (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });

  // Mussorgsky (original — PD)
  pieces.push({ composer: "Modest Mussorgsky", catalog: "", title: "Pictures at an Exhibition — Promenade", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Modest Mussorgsky", catalog: "", title: "Pictures at an Exhibition — The Old Castle", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Modest Mussorgsky", catalog: "", title: "Pictures at an Exhibition — The Great Gate of Kiev", era: "Romantic", difficulty_estimate: "9-10" });

  // MacDowell
  pieces.push({ composer: "Edward MacDowell", catalog: "Op. 51 No. 1", title: "Woodland Sketches — To a Wild Rose", era: "Romantic", difficulty_estimate: "3-5" });

  // Field (inventor of the nocturne)
  pieces.push({ composer: "John Field", catalog: "H. 24", title: "Nocturne No. 1 in E-flat Major", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "John Field", catalog: "H. 37", title: "Nocturne No. 5 in B-flat Major", era: "Romantic", difficulty_estimate: "5-7" });

  // Dussek
  pieces.push({ composer: "Jan Ladislav Dussek", catalog: "Op. 20 No. 1", title: "Sonatina in G Major", era: "Classical", difficulty_estimate: "3-5" });

  // Diabelli
  pieces.push({ composer: "Anton Diabelli", catalog: "Op. 151 No. 1", title: "Sonatina in G Major", era: "Classical", difficulty_estimate: "3-5" });

  // Weber
  pieces.push({ composer: "Carl Maria von Weber", catalog: "Op. 65", title: "Invitation to the Dance", era: "Romantic", difficulty_estimate: "7-9" });

  // Hummel
  pieces.push({ composer: "Johann Nepomuk Hummel", catalog: "Op. 85", title: "Piano Sonata in F-sharp Minor — Adagio", era: "Classical/Romantic", difficulty_estimate: "7-9" });

  // Buxtehude
  pieces.push({ composer: "Dieterich Buxtehude", catalog: "BuxWV 137", title: "Prelude and Fugue in C Major (organ/piano)", era: "Baroque", difficulty_estimate: "6-8" });

  // Couperin
  pieces.push({ composer: "François Couperin", catalog: "", title: "Les Barricades Mystérieuses", era: "Baroque", difficulty_estimate: "4-6" });
  pieces.push({ composer: "François Couperin", catalog: "", title: "Le Tic-Toc-Choc", era: "Baroque", difficulty_estimate: "5-7" });

  // Rameau
  pieces.push({ composer: "Jean-Philippe Rameau", catalog: "", title: "Gavotte and Variations", era: "Baroque", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Jean-Philippe Rameau", catalog: "", title: "Les Sauvages", era: "Baroque", difficulty_estimate: "5-7" });

  // Telemann
  pieces.push({ composer: "Georg Philipp Telemann", catalog: "TWV 32:12", title: "Fantasia in D Minor", era: "Baroque", difficulty_estimate: "3-5" });

  // Daquin
  pieces.push({ composer: "Louis-Claude Daquin", catalog: "", title: "Le Coucou (The Cuckoo)", era: "Baroque", difficulty_estimate: "3-5" });

  // Lully
  pieces.push({ composer: "Jean-Baptiste Lully", catalog: "", title: "Gavotte en Rondeau", era: "Baroque", difficulty_estimate: "2-4" });

  // Chaminade
  pieces.push({ composer: "Cécile Chaminade", catalog: "Op. 107", title: "Automne", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Cécile Chaminade", catalog: "Op. 35 No. 1", title: "Scarf Dance", era: "Romantic", difficulty_estimate: "4-6" });

  // Beach
  pieces.push({ composer: "Amy Beach", catalog: "Op. 36 No. 1", title: "Scottish Legend", era: "Romantic", difficulty_estimate: "5-7" });

  // Scharwenka
  pieces.push({ composer: "Xaver Scharwenka", catalog: "Op. 50 No. 2", title: "Polish Dance", era: "Romantic", difficulty_estimate: "5-7" });

  // Moszkowski
  pieces.push({ composer: "Moritz Moszkowski", catalog: "Op. 72 No. 2", title: "Étude in G Minor", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Moritz Moszkowski", catalog: "Op. 72 No. 6", title: "Étude in F Major", era: "Romantic", difficulty_estimate: "7-9" });

  // Rubinstein
  pieces.push({ composer: "Anton Rubinstein", catalog: "Op. 3 No. 1", title: "Melody in F Major", era: "Romantic", difficulty_estimate: "3-5" });

  // Scriabin (pre-1923)
  pieces.push({ composer: "Alexander Scriabin", catalog: "Op. 2 No. 1", title: "Étude in C-sharp Minor", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Alexander Scriabin", catalog: "Op. 8 No. 12", title: "Étude in D-sharp Minor (Patetico)", era: "Romantic", difficulty_estimate: "9-10" });
  pieces.push({ composer: "Alexander Scriabin", catalog: "Op. 11 No. 1", title: "Prelude in C Major", era: "Romantic", difficulty_estimate: "6-8" });

  // Lyadov
  pieces.push({ composer: "Anatoly Lyadov", catalog: "Op. 40", title: "A Musical Snuffbox", era: "Romantic", difficulty_estimate: "5-7" });

  // Taneyev
  pieces.push({ composer: "Sergei Taneyev", catalog: "Op. 29 No. 1", title: "Prelude in F Major", era: "Romantic", difficulty_estimate: "5-7" });

  // --- Additional composers to reach 500 ---

  // Purcell
  pieces.push({ composer: "Henry Purcell", catalog: "Z. 630", title: "Dido's Lament (When I Am Laid in Earth)", era: "Baroque", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Henry Purcell", catalog: "Z. 660", title: "Trumpet Tune in D Major", era: "Baroque", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Henry Purcell", catalog: "Z. 628", title: "Rondeau from Abdelazer", era: "Baroque", difficulty_estimate: "3-5" });

  // Anna Magdalena Bach Notebook
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV Anh. 114", title: "Minuet in G Major (Anna Magdalena Notebook)", era: "Baroque", difficulty_estimate: "1-3" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV Anh. 115", title: "Minuet in G Minor (Anna Magdalena Notebook)", era: "Baroque", difficulty_estimate: "1-3" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV Anh. 116", title: "Minuet in G Major (Anna Magdalena Notebook)", era: "Baroque", difficulty_estimate: "1-3" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV Anh. 126", title: "Musette in D Major (Anna Magdalena Notebook)", era: "Baroque", difficulty_estimate: "1-3" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV Anh. 122", title: "March in D Major (Anna Magdalena Notebook)", era: "Baroque", difficulty_estimate: "1-3" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV Anh. 132", title: "Minuet in D Minor (Anna Magdalena Notebook)", era: "Baroque", difficulty_estimate: "2-4" });

  // More Bach inventions
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV 773", title: "Two-Part Invention No. 2 in C Minor", era: "Baroque", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV 774", title: "Two-Part Invention No. 3 in D Major", era: "Baroque", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV 777", title: "Two-Part Invention No. 6 in E Major", era: "Baroque", difficulty_estimate: "4-5" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV 780", title: "Two-Part Invention No. 9 in F Minor", era: "Baroque", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV 781", title: "Two-Part Invention No. 10 in G Major", era: "Baroque", difficulty_estimate: "4-5" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV 786", title: "Sinfonia No. 1 in C Major", era: "Baroque", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV 789", title: "Sinfonia No. 4 in D Minor", era: "Baroque", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Johann Sebastian Bach", catalog: "BWV 795", title: "Sinfonia No. 10 in G Major", era: "Baroque", difficulty_estimate: "5-7" });

  // Tárrega (guitar)
  pieces.push({ composer: "Francisco Tárrega", catalog: "", title: "Recuerdos de la Alhambra", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Francisco Tárrega", catalog: "", title: "Lágrima", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Francisco Tárrega", catalog: "", title: "Adelita", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Francisco Tárrega", catalog: "", title: "Capricho Árabe", era: "Romantic", difficulty_estimate: "7-9" });

  // Sor (guitar)
  pieces.push({ composer: "Fernando Sor", catalog: "Op. 35 No. 22", title: "Study in B Minor", era: "Classical/Romantic", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Fernando Sor", catalog: "Op. 6 No. 8", title: "Study in C Major", era: "Classical/Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Fernando Sor", catalog: "Op. 31 No. 1", title: "Study in C Major", era: "Classical/Romantic", difficulty_estimate: "4-6" });

  // Giuliani (guitar)
  pieces.push({ composer: "Mauro Giuliani", catalog: "Op. 50 No. 1", title: "Le Papillon", era: "Classical/Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Mauro Giuliani", catalog: "Op. 48 No. 5", title: "Study in E Minor", era: "Classical/Romantic", difficulty_estimate: "3-5" });

  // Carcassi (guitar)
  pieces.push({ composer: "Matteo Carcassi", catalog: "Op. 60 No. 3", title: "Study in A Major", era: "Classical/Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Matteo Carcassi", catalog: "Op. 60 No. 7", title: "Study in A Minor", era: "Classical/Romantic", difficulty_estimate: "3-5" });

  // Aguado (guitar)
  pieces.push({ composer: "Dionisio Aguado", catalog: "Op. 6 No. 1", title: "Study in A Minor", era: "Classical/Romantic", difficulty_estimate: "3-5" });

  // Chopin — more mazurkas
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 24 No. 2", title: "Mazurka in C Major", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 30 No. 2", title: "Mazurka in B Minor", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 56 No. 2", title: "Mazurka in C Major", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 59 No. 1", title: "Mazurka in A Minor", era: "Romantic", difficulty_estimate: "6-8" });

  // Chopin — more preludes
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 1", title: "Prelude in C Major", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 3", title: "Prelude in G Major", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 8", title: "Prelude in F-sharp Minor", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 11", title: "Prelude in B Major", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Frédéric Chopin", catalog: "Op. 28 No. 17", title: "Prelude in A-flat Major", era: "Romantic", difficulty_estimate: "6-8" });

  // Beethoven — more short works
  pieces.push({ composer: "Ludwig van Beethoven", catalog: "WoO 70", title: "Six Variations on 'Nel cor più non mi sento'", era: "Classical/Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Ludwig van Beethoven", catalog: "Op. 129", title: "Rondo a Capriccio (Rage Over a Lost Penny)", era: "Classical/Romantic", difficulty_estimate: "8-9" });
  pieces.push({ composer: "Ludwig van Beethoven", catalog: "WoO 83", title: "Six Écossaises", era: "Classical/Romantic", difficulty_estimate: "3-5" });

  // Mozart — more works
  pieces.push({ composer: "Wolfgang Amadeus Mozart", catalog: "K. 573", title: "Variations on a Theme by Duport", era: "Classical", difficulty_estimate: "6-8" });

  // Frescobaldi
  pieces.push({ composer: "Girolamo Frescobaldi", catalog: "F 3.35", title: "Toccata in D Minor", era: "Baroque", difficulty_estimate: "6-8" });

  // Byrd
  pieces.push({ composer: "William Byrd", catalog: "BK 3", title: "The Earl of Salisbury's Pavane", era: "Renaissance", difficulty_estimate: "3-5" });
  pieces.push({ composer: "William Byrd", catalog: "BK 94", title: "Pavana Lachrymae", era: "Renaissance", difficulty_estimate: "4-6" });

  // Gibbons
  pieces.push({ composer: "Orlando Gibbons", catalog: "", title: "The Lord of Salisbury's Pavane", era: "Renaissance", difficulty_estimate: "4-6" });

  // Dowland (lute/piano)
  pieces.push({ composer: "John Dowland", catalog: "", title: "Flow My Tears (Lachrimae)", era: "Renaissance", difficulty_estimate: "2-4" });
  pieces.push({ composer: "John Dowland", catalog: "", title: "Can She Excuse My Wrongs", era: "Renaissance", difficulty_estimate: "2-4" });

  // Bull
  pieces.push({ composer: "John Bull", catalog: "", title: "The King's Hunting Jig", era: "Renaissance", difficulty_estimate: "6-8" });

  // Tomkins
  pieces.push({ composer: "Thomas Tomkins", catalog: "", title: "A Sad Pavan for These Distracted Times", era: "Renaissance", difficulty_estimate: "4-6" });

  // Sweelinck
  pieces.push({ composer: "Jan Pieterszoon Sweelinck", catalog: "SwWV 256", title: "Echo Fantasia in C Major", era: "Renaissance", difficulty_estimate: "6-8" });

  // Froberger
  pieces.push({ composer: "Johann Jakob Froberger", catalog: "FbWV 101", title: "Tombeau sur la mort de M. Blancrocher", era: "Baroque", difficulty_estimate: "5-7" });

  // Brahms — more
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 116 No. 2", title: "Intermezzo in A Minor", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 116 No. 6", title: "Intermezzo in E Major", era: "Romantic", difficulty_estimate: "7-9" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 117 No. 2", title: "Intermezzo in B-flat Minor", era: "Romantic", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Johannes Brahms", catalog: "Op. 119 No. 2", title: "Intermezzo in E Minor", era: "Romantic", difficulty_estimate: "7-9" });

  // Liszt — more
  pieces.push({ composer: "Franz Liszt", catalog: "S. 172 No. 1", title: "Consolation No. 1 in E Major", era: "Romantic", difficulty_estimate: "6-7" });
  pieces.push({ composer: "Franz Liszt", catalog: "S. 172 No. 2", title: "Consolation No. 2 in E Major", era: "Romantic", difficulty_estimate: "6-7" });
  pieces.push({ composer: "Franz Liszt", catalog: "S. 541 No. 2", title: "Liebestraum No. 2", era: "Romantic", difficulty_estimate: "8-9" });

  // Schubert — ländler and waltzes
  pieces.push({ composer: "Franz Schubert", catalog: "D. 365", title: "Thirty-six Original Dances (Waltzes)", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 733", title: "Valses sentimentales", era: "Romantic", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 145", title: "Twelve Waltzes", era: "Romantic", difficulty_estimate: "2-4" });

  // Grieg — more lyric pieces
  pieces.push({ composer: "Edvard Grieg", catalog: "Op. 38 No. 1", title: "Lyric Pieces — Berceuse", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Edvard Grieg", catalog: "Op. 47 No. 3", title: "Lyric Pieces — Melody", era: "Romantic", difficulty_estimate: "3-5" });

  // Debussy — La plus que lente
  pieces.push({ composer: "Claude Debussy", catalog: "L. 121", title: "La plus que lente", era: "Impressionist", difficulty_estimate: "7-9" });

  // Schubert songs (piano arrangements)
  pieces.push({ composer: "Franz Schubert", catalog: "D. 328", title: "Erlkönig (piano arrangement)", era: "Romantic", difficulty_estimate: "8-10" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 839", title: "Ave Maria (piano arrangement)", era: "Romantic", difficulty_estimate: "3-5" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 550", title: "Die Forelle (piano arrangement)", era: "Romantic", difficulty_estimate: "4-6" });
  pieces.push({ composer: "Franz Schubert", catalog: "D. 795 No. 4", title: "Serenade (Ständchen)", era: "Romantic", difficulty_estimate: "4-6" });

  // Strauss II (waltzes, piano reductions)
  pieces.push({ composer: "Johann Strauss II", catalog: "Op. 314", title: "The Blue Danube (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });
  pieces.push({ composer: "Johann Strauss II", catalog: "Op. 325", title: "Tales from the Vienna Woods (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });

  // Suppé
  pieces.push({ composer: "Franz von Suppé", catalog: "", title: "Light Cavalry Overture (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });

  // Waldteufel
  pieces.push({ composer: "Émile Waldteufel", catalog: "Op. 183", title: "The Skaters' Waltz (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });

  // Leoncavallo
  pieces.push({ composer: "Ruggero Leoncavallo", catalog: "", title: "Pagliacci — Vesti la giubba (piano arrangement)", era: "Romantic", difficulty_estimate: "5-7" });

  // Mascagni
  pieces.push({ composer: "Pietro Mascagni", catalog: "", title: "Cavalleria Rusticana — Intermezzo (piano arrangement)", era: "Romantic", difficulty_estimate: "4-6" });

  // Fill to exactly 500
  pieces.push({ composer: "César Franck", catalog: "Op. 18", title: "Prélude, Fugue et Variation", era: "Romantic", difficulty_estimate: "8-10" });
  pieces.push({ composer: "Joaquín Rodrigo", catalog: "", title: "Concierto de Aranjuez — Adagio (piano arrangement)", era: "Modern", difficulty_estimate: "6-8" });
  pieces.push({ composer: "Jeremiah Clarke", catalog: "", title: "Trumpet Voluntary (Prince of Denmark's March)", era: "Baroque", difficulty_estimate: "3-5" });

  return pieces;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------
function generateAllPieces(): PieceEntry[] {
  const all: PieceEntry[] = [
    ...bachBWV(),
    ...mozartK(),
    ...beethovenOpus(),
    ...chopinOpus(),
    ...debussyL(),
    ...lisztS(),
    ...schubertD(),
    ...schumannOpus(),
    ...brahmsOpus(),
    ...handelHWV(),
    ...otherComposers(),
  ];

  // Deduplicate on composer+catalog+title
  const seen = new Set<string>();
  const unique: PieceEntry[] = [];
  for (const p of all) {
    const key = `${p.composer}|${p.catalog}|${p.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  return unique;
}

// ---------------------------------------------------------------------------
// CSV output
// ---------------------------------------------------------------------------
function toCSV(pieces: PieceEntry[]): string {
  const header = "composer,catalog,title,era,difficulty_estimate";
  const rows = pieces.map((p) =>
    [
      `"${p.composer.replace(/"/g, '""')}"`,
      `"${p.catalog.replace(/"/g, '""')}"`,
      `"${p.title.replace(/"/g, '""')}"`,
      `"${p.era.replace(/"/g, '""')}"`,
      `"${p.difficulty_estimate}"`,
    ].join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const pieces = generateAllPieces();
console.log(`Generated ${pieces.length} unique pieces`);

// Ensure 500 pieces
if (pieces.length < 500) {
  console.warn(`⚠ Only ${pieces.length} pieces — target is 500. Add more entries to reach 500.`);
} else if (pieces.length > 500) {
  console.log(`Trimming from ${pieces.length} to exactly 500 pieces`);
}

const final = pieces.slice(0, 500);

const outDir = dirname(resolve(import.meta.path));
const outPath = resolve(outDir, "target-500.csv");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, toCSV(final));

console.log(`Wrote ${final.length} pieces to ${outPath}`);

// Summary by era and composer
const eraCounts: Record<string, number> = {};
const composerCounts: Record<string, number> = {};
for (const p of final) {
  eraCounts[p.era] = (eraCounts[p.era] || 0) + 1;
  composerCounts[p.composer] = (composerCounts[p.composer] || 0) + 1;
}

console.log("\nBy era:");
for (const [era, count] of Object.entries(eraCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${era}: ${count}`);
}

console.log("\nBy composer (top 15):");
const topComposers = Object.entries(composerCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);
for (const [composer, count] of topComposers) {
  console.log(`  ${composer}: ${count}`);
}
