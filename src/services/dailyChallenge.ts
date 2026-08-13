/**
 * Daily challenge piece rotation.
 * Selects a piece deterministically based on the current date — no server needed.
 */
import type { DailyChallengePiece } from '../types';
import { getDateStr } from './storage';

/**
 * Static pool of ~20 pieces representing the "500 list".
 * In production this would be the full 500.
 */
const PIECE_POOL: DailyChallengePiece[] = [
  {
    id: 'furt-elise',
    title: 'Für Elise',
    composer: 'Ludwig van Beethoven',
    genre: 'Classical',
    difficulty: 'Intermediate',
    description: 'Bagatelle No. 25 in A minor — one of the most recognizable piano pieces ever written.',
  },
  {
    id: 'clair-de-lune',
    title: 'Clair de Lune',
    composer: 'Claude Debussy',
    genre: 'Classical',
    difficulty: 'Intermediate',
    description: 'The third movement of Suite bergamasque, evoking moonlight and reflection.',
  },
  {
    id: 'nocturne-op9-no2',
    title: 'Nocturne Op. 9 No. 2',
    composer: 'Frédéric Chopin',
    genre: 'Classical',
    difficulty: 'Intermediate',
    description: 'A lyrical, flowing nocturne — one of Chopin\'s most beloved works.',
  },
  {
    id: 'moonlight-sonata',
    title: 'Moonlight Sonata (1st Mvt)',
    composer: 'Ludwig van Beethoven',
    genre: 'Classical',
    difficulty: 'Intermediate',
    description: 'The haunting Adagio sostenuto that captivates listeners from the first note.',
  },
  {
    id: 'prelude-c-major',
    title: 'Prelude in C Major',
    composer: 'J.S. Bach',
    genre: 'Classical',
    difficulty: 'Beginner',
    description: 'The iconic prelude from The Well-Tempered Clavier — perfect for beginners.',
  },
  {
    id: 'gymnopedie-no1',
    title: 'Gymnopédie No. 1',
    composer: 'Erik Satie',
    genre: 'Classical',
    difficulty: 'Beginner',
    description: 'A gentle, melancholic piano piece with a dreamlike quality.',
  },
  {
    id: 'canon-in-d',
    title: 'Canon in D',
    composer: 'Johann Pachelbel',
    genre: 'Classical',
    difficulty: 'Intermediate',
    description: 'The timeless canon — instantly recognizable and deeply satisfying to play.',
  },
  {
    id: 'the-entertainer',
    title: 'The Entertainer',
    composer: 'Scott Joplin',
    genre: 'Jazz/Ragtime',
    difficulty: 'Intermediate',
    description: 'The quintessential ragtime piece — bouncy, syncopated, and pure joy.',
  },
  {
    id: 'maple-leaf-rag',
    title: 'Maple Leaf Rag',
    composer: 'Scott Joplin',
    genre: 'Jazz/Ragtime',
    difficulty: 'Advanced',
    description: 'Joplin\'s first major hit — a rhythmic workout for the intermediate+ pianist.',
  },
  {
    id: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional English',
    genre: 'Folk/Traditional',
    difficulty: 'Beginner',
    description: 'The beautiful 16th-century English folk melody — simple and elegant.',
  },
  {
    id: 'scarborough-fair',
    title: 'Scarborough Fair',
    composer: 'Traditional English',
    genre: 'Folk/Traditional',
    difficulty: 'Beginner',
    description: 'A haunting folk ballad made famous by Simon & Garfunkel.',
  },
  {
    id: 'minuet-in-g',
    title: 'Minuet in G Major',
    composer: 'J.S. Bach (attr. Petzold)',
    genre: 'Classical',
    difficulty: 'Beginner',
    description: 'The beloved minuet from the Anna Magdalena Notebook — a beginner\'s rite of passage.',
  },
  {
    id: 'ave-maria',
    title: 'Ave Maria',
    composer: 'Franz Schubert',
    genre: 'Classical',
    difficulty: 'Intermediate',
    description: 'Schubert\'s celestial melody — serene and uplifting.',
  },
  {
    id: 'rondo-alla-turca',
    title: 'Rondo alla Turca',
    composer: 'W.A. Mozart',
    genre: 'Classical',
    difficulty: 'Advanced',
    description: 'The "Turkish March" from Piano Sonata No. 11 — lively and virtuosic.',
  },
  {
    id: 'arabesque-no1',
    title: 'Arabesque No. 1',
    composer: 'Claude Debussy',
    genre: 'Classical',
    difficulty: 'Intermediate',
    description: 'Debussy\'s flowing, impressionistic arabesque — a cascade of arpeggios.',
  },
  {
    id: 'waltz-op64-no2',
    title: 'Waltz in C# Minor',
    composer: 'Frédéric Chopin',
    genre: 'Classical',
    difficulty: 'Advanced',
    description: 'A passionate waltz with a lyrical middle section — pure Romanticism.',
  },
  {
    id: 'solace',
    title: 'Solace (A Mexican Serenade)',
    composer: 'Scott Joplin',
    genre: 'Jazz/Ragtime',
    difficulty: 'Intermediate',
    description: 'Joplin\'s most tender rag — a slow, habanera-tinged serenade.',
  },
  {
    id: 'danny-boy',
    title: 'Danny Boy',
    composer: 'Traditional Irish',
    genre: 'Folk/Traditional',
    difficulty: 'Beginner',
    description: 'The beloved Irish air — emotional and timeless.',
  },
  {
    id: 'in-the-hall-of-the-mountain-king',
    title: 'In the Hall of the Mountain King',
    composer: 'Edvard Grieg',
    genre: 'Classical',
    difficulty: 'Intermediate',
    description: 'The thrilling, accelerating finale from Peer Gynt Suite No. 1.',
  },
  {
    id: 'pathetique-adagio',
    title: 'Pathétique Sonata (Adagio)',
    composer: 'Ludwig van Beethoven',
    genre: 'Classical',
    difficulty: 'Advanced',
    description: 'The deeply moving slow movement from Piano Sonata No. 8.',
  },
];

/**
 * Deterministic hash of a date string, returns a number 0–(poolSize-1).
 * Uses a simple djb2-like hash seeded by YYYY-MM-DD.
 */
function dateSeed(dateStr: string, poolSize: number): number {
  let hash = 5381;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) + hash) + dateStr.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % poolSize;
}

/**
 * Returns today's daily challenge piece.
 * Deterministic — same date always returns the same piece.
 */
export function getTodayChallenge(): DailyChallengePiece {
  const today = getDateStr(new Date());
  const index = dateSeed(today, PIECE_POOL.length);
  return PIECE_POOL[index];
}

/** Returns the full pool (for reference). */
export function getPiecePool(): DailyChallengePiece[] {
  return PIECE_POOL;
}
