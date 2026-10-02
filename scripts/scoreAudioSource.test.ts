/**
 * Tests for the piece page's practice audio (RC-v28 fix acfb6a57).
 *
 * THE REPORTED DEFECT: the owner opened Air on the G String, tapped the sheet
 * viewer's Preview button, and heard FÜR ELISE — because PieceDetailScreen fell
 * back to a bundled Für Elise preview for ANY public-domain piece without a
 * curated `audioUrl`. "Never play a different piece's audio" is a rule no
 * live-logic test could catch and no emulator is available, so this suite does
 * two things:
 *
 *   1. DECISIONS — the pure `scoreAudioDecision` / `curatedScoreAudioUrl` from
 *      src/services/scoreAudioSource.ts, including the pre-fix ternary written
 *      out so the bug is reproduced in a test (and can never be "fixed" by a
 *      future change that quietly restores the fallback);
 *   2. LIVE SCAN — the real PieceDetailScreen / ScoreViewer source off disk,
 *      with mutation probes that must FAIL the contract (a guard that only ever
 *      sees a healthy file proves nothing).
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  RETIRED_NO_SCORE_AUDIO_HINT,
  RETIRED_BUNDLED_PREVIEW,
  SCORE_AUDIO_LABEL,
  curatedScoreAudioUrl,
  hasCuratedScoreAudio,
  pieceDetailPlaysOnlyCuratedAudio,
  scoreAudioDecision,
  viewerRendersNoAudioChrome,
  type ScoreAudioPieceLike,
} from '../src/services/scoreAudioSource';
import { maskComments } from '../src/services/modalBackContract';

declare const process: { exit(code: number): never; cwd(): string };
declare const require: (moduleName: string) => any;

/** A piece page's piece, with the fields the audit cares about. */
interface PieceLike extends ScoreAudioPieceLike {
  title?: string;
  composer?: string;
  isPublicDomain?: boolean;
}

let failures = 0;
let passes = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}

function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

// ─── the repo root (the live scan reads the app's own source) ───

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    'could not find the repo root from ' +
      process.cwd() +
      ' — run this suite with `npm run test:tier1` from the repo root',
  );
}

function readAppFile(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8') as string;
}

function listAppDir(rel: string): string[] {
  const fs = require('fs');
  const path = require('path');
  return (fs.readdirSync(path.join(repoRoot(), rel)) as string[]).filter((f) =>
    f.endsWith('.tsx'),
  );
}

// ─── 1. the decision ────────────────────────────────────────────

const CURATED = 'https://scores.example/air-on-the-g-string.m4a';

/** A public-domain piece page with NO curated audio — the reported case. */
const PD_PIECE_NO_AUDIO: PieceLike = {
  title: 'Air on the G String',
  composer: 'J.S. Bach',
  isPublicDomain: true,
};

function decisionTests(): void {
  console.log('\nthe practice-audio decision (a piece plays its OWN audio or nothing)');

  assertEq(
    curatedScoreAudioUrl({ audioUrl: CURATED }),
    CURATED,
    'a piece with curated audio yields its own URL',
  );
  assertEq(
    curatedScoreAudioUrl({}),
    null,
    'a piece WITHOUT audioUrl produces NO fallback source (the fix)',
  );
  assertEq(
    curatedScoreAudioUrl(PD_PIECE_NO_AUDIO),
    null,
    'a PUBLIC-DOMAIN piece without audioUrl produces NO source either (the reported bug)',
  );
  assertEq(curatedScoreAudioUrl(null), null, 'a missing piece produces no source');
  assertEq(curatedScoreAudioUrl(undefined), null, 'an undefined piece produces no source');
  assertEq(
    curatedScoreAudioUrl({ audioUrl: '   ' }),
    null,
    'a blank audioUrl is not a source (it would be a broken player)',
  );
  assertEq(
    curatedScoreAudioUrl({ audioUrl: 42 } as unknown as PieceLike),
    null,
    'a non-string audioUrl is not a source',
  );
  assertEq(
    curatedScoreAudioUrl({ audioUrl: ` ${CURATED} ` }),
    CURATED,
    'a padded URL is trimmed, not rejected',
  );

  assertEq(hasCuratedScoreAudio({ audioUrl: CURATED }), true, 'hasCuratedScoreAudio: curated → true');
  assertEq(hasCuratedScoreAudio({}), false, 'hasCuratedScoreAudio: absent → false');

  const withAudio = scoreAudioDecision({ audioUrl: CURATED });
  assertEq(withAudio.source, CURATED, 'decision: the piece’s own audio is what plays');
  assertEq(withAudio.label, SCORE_AUDIO_LABEL, 'decision: the curated audio is labelled “Score audio”');
  assertEq(withAudio.showPlayer, true, 'decision: a player renders for curated audio');

  const withoutAudio = scoreAudioDecision(PD_PIECE_NO_AUDIO);
  assertEq(withoutAudio.source, null, 'decision: no audioUrl → source is null, never a placeholder');
  assertEq(
    withoutAudio.label,
    undefined,
    'decision: no audioUrl → no label (nothing may claim to be playing)',
  );
  assertEq(withoutAudio.showPlayer, false, 'decision: no audioUrl → NO player, only the honest hint');
  assertEq(
    Object.keys(withoutAudio).length,
    3,
    'decision: exactly {source,label,showPlayer} — no second, hidden audio path',
  );
}

// ─── 2. the owner's exact case, in the pre-fix code ─────────────

function regressionTests(): void {
  console.log('\nthe reported case: Air on the G String must never play Für Elise');

  const air: PieceLike = {
    title: 'Air on the G String',
    composer: 'J.S. Bach',
    isPublicDomain: true,
  };

  // The pre-fix decision, verbatim from PieceDetailScreen.tsx:199-205. Written
  // out here as evidence of the root cause, and as a fixture the new decision
  // must differ from.
  const bundledScoreAudio = RETIRED_BUNDLED_PREVIEW;
  const preFixDecision = (piece: PieceLike): string | null =>
    piece.audioUrl
      ? piece.audioUrl
      : piece.isPublicDomain !== false
      ? bundledScoreAudio
      : null;

  assertEq(
    preFixDecision(air),
    RETIRED_BUNDLED_PREVIEW,
    'PRE-FIX: the retired ternary handed Air on the G String the Für Elise asset (the bug)',
  );
  assertEq(
    scoreAudioDecision(air).source,
    null,
    'FIXED: the same piece now yields no source at all — no cross-piece audio',
  );
  assertEq(
    scoreAudioDecision(air).source === RETIRED_BUNDLED_PREVIEW,
    false,
    'the retired Für Elise asset can never be the source for a piece without curated audio',
  );
}

// ─── 3. live scan: the real piece page ──────────────────────────

function pieceDetailTests(): void {
  console.log('\nlive scan: PieceDetailScreen takes audio only from the curated decision');

  const pieceDetail = readAppFile('src/screens/PieceDetailScreen.tsx');
  assert(pieceDetail.length > 3000, `read PieceDetailScreen.tsx (${pieceDetail.length} chars)`);
  assert(
    pieceDetail.indexOf(RETIRED_BUNDLED_PREVIEW) < 0,
    'the retired bundled preview is gone from the piece page',
  );
  assert(
    !/require\(\s*['"][^'"]*assets\/audio[^'"]*['"]\s*\)/.test(pieceDetail),
    'the piece page requires NO bundled audio asset at all',
  );
  assertEq(
    pieceDetailPlaysOnlyCuratedAudio(pieceDetail),
    true,
    'the real piece page satisfies the no-fallback contract',
  );
  assert(
    pieceDetail.indexOf('scoreAudioDecision(') >= 0,
    'the piece page routes its audio through the curated decision',
  );

  // ── mutation probes on the REAL source ──

  // (a) the retired fallback line coming back, in its original shape.
  const withBundled = pieceDetail.replace(
    'const scoreAudio = scoreAudioDecision(piece);',
    'const scoreAudio = scoreAudioDecision(piece);\n' +
      "  const bundledScoreAudio = require('../../assets/audio/preview-fur-elise.wav');",
  );
  assert(withBundled !== pieceDetail, 'the mutation fixture changed the real source');
  assertEq(
    pieceDetailPlaysOnlyCuratedAudio(withBundled),
    false,
    'MUTATION: re-requiring the bundled preview fails the contract',
  );

  // (b) only the asset NAME left behind, in CODE (a dead reference that would
  //     still point at Für Elise). Line comments are masked by the contract's
  //     maskComments, so the probe must be real code.
  const namedAsset = pieceDetail.replace(
    'const scoreAudio = scoreAudioDecision(piece);',
    'const scoreAudio = scoreAudioDecision(piece);\n' +
      "  const legacyPreviewAsset = 'preview-fur-elise.wav';",
  );
  assert(namedAsset !== pieceDetail, 'the named-asset mutation changed the real source');
  assertEq(
    pieceDetailPlaysOnlyCuratedAudio(namedAsset),
    false,
    'MUTATION: naming the retired asset in code fails the contract',
  );

  // (c) the old public-domain branch: "any PD piece may play the bundled audio".
  const pdBranch = pieceDetail.replace(
    'audioSource={scoreAudio.source}',
    'audioSource={piece.isPublicDomain !== false ? bundledScoreAudio : null}',
  );
  assertEq(
    pieceDetailPlaysOnlyCuratedAudio(pdBranch),
    false,
    'MUTATION: the old public-domain audio branch fails the contract',
  );

  // (d) the decision detached: the props no longer come from it.
  const detached = pieceDetail.replace(
    'scoreAudioDecision(piece)',
    '(piece.audioUrl ?? null)',
  );
  assertEq(
    pieceDetailPlaysOnlyCuratedAudio(detached),
    false,
    'MUTATION: audio detached from the curated decision fails the contract',
  );
}

// ─── 4. the no-audio chrome is ABSENT (bundle E / owner Q5) ─────

function viewerTests(): void {
  console.log('\nthe viewer renders no audio chrome at all when there is no curated audio');

  const viewer = readAppFile('src/components/ScoreViewer.tsx');
  assert(viewer.length > 3000, `read ScoreViewer.tsx (${viewer.length} chars)`);
  assertEq(
    viewerRendersNoAudioChrome(viewer),
    true,
    'the real viewer gates the player on an existing audioSource and renders nothing without one',
  );
  // The RENDERED label, not the prose about it. The viewer's own doc comment on
  // the `audioSource` prop names the retired string (that is how the next reader
  // learns why the audio slot is empty), so this scans the comment-masked source
  // — the same mask `viewerRendersNoAudioChrome` above and
  // `promiseAudit.findPromiseOffenders` use. JSX text and string literals survive
  // the mask, so a label that really renders still fails here (proved by the
  // mutation below).
  const viewerMarkup = maskComments(viewer);
  assert(
    viewerMarkup.indexOf(RETIRED_NO_SCORE_AUDIO_HINT) < 0,
    'the retired "practice audio coming soon" label is gone from the viewer (Q5: absent, not muted)',
  );

  // MUTATION (a): the retired hint comes back as the else-branch — the D13 box.
  // Sliced by index so the mutation lands on the audio block itself, not on the
  // first `) : null}` in the file.
  const audioMarker = '{!immersive && audioSource ? (';
  const audioClose = ') : null}';
  const audioStart = viewer.indexOf(audioMarker);
  const audioEnd = viewer.indexOf(audioClose, audioStart);
  assert(audioStart >= 0 && audioEnd > audioStart, 'located the viewer audio block');
  const withHint =
    viewer.slice(0, audioStart) +
    `{!immersive && (audioSource ? (\n<ScorePlayer source={audioSource} label={audioLabel} />\n) : (\n<View><Text>${RETIRED_NO_SCORE_AUDIO_HINT}</Text></View>\n))}` +
    viewer.slice(audioEnd + audioClose.length);
  assert(withHint !== viewer, 'the mutation fixture changed the real viewer');
  // The mask must not blunt the check above: the SAME label, really rendered in
  // the audio slot, is still found (comments are masked, JSX text is not).
  assert(
    maskComments(withHint).indexOf(RETIRED_NO_SCORE_AUDIO_HINT) >= 0,
    'MUTATION: the label really rendered is still caught by the masked viewer scan',
  );
  assertEq(
    viewerRendersNoAudioChrome(withHint),
    false,
    'MUTATION: restoring the "practice audio coming soon" box fails the contract',
  );

  // MUTATION (b): the player is no longer gated on the audio source (a fake
  // control: it would render for a piece with no audio at all).
  const ungated = viewer.replace('!immersive && audioSource ? (', '!immersive ? (');
  assert(ungated !== viewer, 'the ungated mutation changed the real viewer');
  assertEq(
    viewerRendersNoAudioChrome(ungated),
    false,
    'MUTATION: an ungated practice player fails the contract',
  );
}

// ─── 5. no screen or component reaches for bundled audio ────────

function appScanTests(): void {
  console.log('\nlive scan: no screen or component reaches for a bundled preview');

  const dirs = ['src/screens', 'src/components'];
  let scanned = 0;
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const file of listAppDir(dir)) {
      scanned++;
      const src = readAppFile(`${dir}/${file}`);
      if (
        src.indexOf(RETIRED_BUNDLED_PREVIEW) >= 0 ||
        /require\(\s*['"][^'"]*assets\/audio[^'"]*['"]\s*\)/.test(src)
      ) {
        offenders.push(`${dir}/${file}`);
      }
    }
  }
  assert(scanned >= 20, `walked ${scanned} screens/components (floor: 20)`);
  assertEq(
    offenders.join(', '),
    '',
    'no screen/component carries the retired bundled audio reference',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== the piece page practice audio (never another piece’s recording) ===');
  decisionTests();
  regressionTests();
  pieceDetailTests();
  viewerTests();
  appScanTests();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
