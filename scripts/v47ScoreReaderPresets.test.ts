/**
 * Tests for THE v47 SCORE-READER PRESET GUARD — src/services/v47ScoreReaderPresets.ts
 * against the REAL sources, plus the proof that the shipped v39 guard cannot see
 * any of it.
 *
 * WHY A NEW SUITE. `v39UiContract.pageTurnerViewersShareThePresets()` takes three
 * inputs — the PDF viewer, the scanned viewer and the hook — and asserts
 * `usePageTurnSpeed(itemId, autoScroll)` and `speedProfiles={speedProfiles}` in
 * **`PdfViewerScreen` only**. `components/ScoreViewer.tsx` is not one of its
 * inputs, so no mutation of the score viewer can turn it red. That is asserted
 * below as a fact, not a claim: the v39 predicate is run against the SAME mutated
 * score-viewer sources and stays green while this suite's guard fails.
 *
 * WHAT IT PROVES:
 *   • the shipped score viewer hosts the presets (id prop + hook call + prop
 *     passed to the AutoScrollControl element);
 *   • all three hosts hand over a real piece identity;
 *   • every one of those facts FAILS when the corresponding line is removed from
 *     the real bytes (mutation probes), and the v39 guard still passes — the
 *     "hosting, not wiring" blind spot, closed.
 *
 * Plain Node, no react-native, no network. Run with: `npm run test:tier1`.
 */
import {
  EXPECTED_HOST_ITEM_ID,
  HOME_FILE,
  PIECE_PAGE_FILE,
  RESULT_CARD_FILE,
  SCORE_VIEWER_FILE,
  elementSource,
  hostPassesTheExpectedId,
  hostPassesThePieceIdToTheScoreViewer,
  scoreReaderHostsThePresets,
  scoreViewerCallsThePresetHookWithTheId,
  scoreViewerDeclaresTheIdProp,
  scoreViewerDestructuresTheId,
  scoreViewerImportsThePresetHook,
  scoreViewerPassesProfilesToTheControl,
} from '../src/services/v47ScoreReaderPresets';
import { pageTurnerViewersShareThePresets } from '../src/services/v39UiContract';

let passes = 0;
let failures = 0;

declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };

function assert(ok: boolean, label: string): void {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const ok = actual === expected;
  if (!ok) {
    console.log(`     expected ${String(expected)}, got ${String(actual)}`);
  }
  assert(ok, label);
}

// ─── helpers ────────────────────────────────────────────────────

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

/** The v39 predicate over the REAL pdf/scanned/hook sources (score viewer absent). */
function v39SaysThePresetsAreFine(): boolean {
  return pageTurnerViewersShareThePresets(
    readAppFile('src/screens/PdfViewerScreen.tsx'),
    readAppFile('src/screens/ScannedViewerScreen.tsx'),
    readAppFile('src/hooks/usePageTurnSpeed.ts'),
  );
}

// ─── 1. the file map ────────────────────────────────────────────

function fileMapTests(): void {
  console.log('\nthe guard names the real files');
  assertEq(SCORE_VIEWER_FILE, 'src/components/ScoreViewer.tsx', 'the score reader is guarded on its own file');
  assertEq(PIECE_PAGE_FILE, 'src/screens/PieceDetailScreen.tsx', 'host 1: the piece page');
  assertEq(HOME_FILE, 'src/screens/HomeScreen.tsx', "host 2: Home's Today's Piece");
  assertEq(RESULT_CARD_FILE, 'src/components/RecognitionResultView.tsx', 'host 3: the recognition result card');
  assertEq(EXPECTED_HOST_ITEM_ID[PIECE_PAGE_FILE], 'piece.id', 'the piece page hands over piece.id');
  assertEq(EXPECTED_HOST_ITEM_ID[HOME_FILE], 'dailyChallenge.id', 'Home hands over dailyChallenge.id');
  assertEq(
    EXPECTED_HOST_ITEM_ID[RESULT_CARD_FILE],
    'selectedMatch?.piece_id ?? topMatch.piece_id',
    'the result card hands over the matched piece id',
  );
}

// ─── 2. floors: a broken read must not pass ────────────────────

function floorTests(): void {
  console.log('\nfloors — an empty or truncated read fails every guard');
  assertEq(scoreViewerDeclaresTheIdProp(''), false, 'empty viewer source → prop guard fails');
  assertEq(scoreViewerDestructuresTheId(''), false, 'empty viewer source → destructure guard fails');
  assertEq(scoreViewerImportsThePresetHook(''), false, 'empty viewer source → import guard fails');
  assertEq(scoreViewerCallsThePresetHookWithTheId(''), false, 'empty viewer source → hook guard fails');
  assertEq(scoreViewerPassesProfilesToTheControl(''), false, 'empty viewer source → control guard fails');
  assertEq(scoreReaderHostsThePresets(''), false, 'empty viewer source → whole-viewer guard fails');
  assertEq(hostPassesThePieceIdToTheScoreViewer(''), false, 'empty host source → host guard fails');
  assertEq(hostPassesThePieceIdToTheScoreViewer('x'.repeat(4000)), false, 'a long host with no viewer → fails');
  assertEq(elementSource('', 'ScoreViewer'), null, 'no source, no element');
}

// ─── 3. the real sources pass ──────────────────────────────────

function liveScanTests(): void {
  console.log('\nlive scan — the shipped score reader HOSTS the presets');
  const viewer = readAppFile(SCORE_VIEWER_FILE);

  assertEq(scoreViewerDeclaresTheIdProp(viewer), true, 'ScoreViewerProps declares `itemId?: string | null`');
  assertEq(scoreViewerDestructuresTheId(viewer), true, 'the component actually reads `itemId`');
  assertEq(scoreViewerImportsThePresetHook(viewer), true, 'it imports usePageTurnSpeed from ../hooks/usePageTurnSpeed');
  assertEq(
    scoreViewerCallsThePresetHookWithTheId(viewer),
    true,
    'it calls `usePageTurnSpeed(itemId ?? null, autoScroll)` — the PDF reader’s exact shape',
  );
  assertEq(
    scoreViewerPassesProfilesToTheControl(viewer),
    true,
    'it passes `speedProfiles={speedProfiles}` to the AutoScrollControl element (still fed autoScroll)',
  );
  assertEq(scoreReaderHostsThePresets(viewer), true, 'THE WHOLE VIEWER: the score reader hosts the preset row');

  console.log('\nlive scan — every host hands over a real piece identity');
  for (const file of [PIECE_PAGE_FILE, HOME_FILE, RESULT_CARD_FILE]) {
    const host = readAppFile(file);
    assert(hostPassesThePieceIdToTheScoreViewer(host), `${file}: <ScoreViewer itemId={…}> is a real identity`);
    assertEq(
      hostPassesTheExpectedId(host, EXPECTED_HOST_ITEM_ID[file]),
      true,
      `${file}: passes exactly ${EXPECTED_HOST_ITEM_ID[file]}`,
    );
  }
}

// ─── 4. fixtures: the fixed shape passes, its near-misses fail ─

const PAD = (n: number, ch: string): string => '\n/*' + ch.repeat(n) + '*/';

const FIXTURE_VIEWER = `
import { AutoScrollControl } from './AutoScrollControl';
import { usePageTurnSpeed } from '../hooks/usePageTurnSpeed';

interface ScoreViewerProps {
  url: string;
  title: string;
  onClose: () => void;
  itemId?: string | null;
}

export const ScoreViewer: React.FC<ScoreViewerProps> = ({
  url,
  title,
  onClose,
  itemId,
}) => {
  const autoScroll = useAutoScroll({ currentPage: 1, pageCount: 3 });
  const speedProfiles = usePageTurnSpeed(itemId ?? null, autoScroll);
  return (
    <View>
      <AutoScrollControl
        autoScroll={autoScroll}
        disabled={false}
        speedProfiles={speedProfiles}
      />
    </View>
  );
};` + PAD(6000, 'v');

const FIXTURE_HOST = `
export const Page = ({ piece }) => (
  <View>
    <ScoreViewer url={piece.sheetMusicUrl} title={piece.title} composer={piece.composer}
      onClose={close} itemId={piece.id} />
  </View>
);` + PAD(3500, 'h');

function fixtureTests(): void {
  console.log('\nfixtures — the fixed shape passes, its near-misses fail');
  assertEq(scoreReaderHostsThePresets(FIXTURE_VIEWER), true, 'fixture: a fully hosted viewer passes');
  assertEq(hostPassesThePieceIdToTheScoreViewer(FIXTURE_HOST), true, 'fixture: a host passing piece.id passes');

  assertEq(
    scoreReaderHostsThePresets(FIXTURE_VIEWER.replace('  itemId?: string | null;\n', '')),
    false,
    'fixture: no id prop → fails',
  );
  assertEq(
    scoreReaderHostsThePresets(FIXTURE_VIEWER.replace('  itemId,\n', '')),
    false,
    'fixture: prop declared but never read → fails',
  );
  assertEq(
    scoreReaderHostsThePresets(
      FIXTURE_VIEWER.replace(
        'const speedProfiles = usePageTurnSpeed(itemId ?? null, autoScroll);',
        'const speedProfiles = { presets: [] };',
      ),
    ),
    false,
    'fixture: a hand-rolled speedProfiles object instead of the hook → fails',
  );
  assertEq(
    scoreReaderHostsThePresets(FIXTURE_VIEWER.replace('        speedProfiles={speedProfiles}\n', '')),
    false,
    'fixture: control without speedProfiles → fails',
  );
  assertEq(
    scoreReaderHostsThePresets(FIXTURE_VIEWER.replace('usePageTurnSpeed(itemId ?? null, autoScroll)', 'usePageTurnSpeed(null, autoScroll)')),
    false,
    'fixture: hook called without the piece id → fails',
  );

  assertEq(
    hostPassesThePieceIdToTheScoreViewer(FIXTURE_HOST.replace(' itemId={piece.id}', '')),
    false,
    'fixture: host that forgets the id → fails',
  );
  assertEq(
    hostPassesThePieceIdToTheScoreViewer(FIXTURE_HOST.replace('itemId={piece.id}', 'itemId={null}')),
    false,
    'fixture: a literal null id (every piece shares one memory) → fails',
  );
  assertEq(
    hostPassesThePieceIdToTheScoreViewer(FIXTURE_HOST.replace('itemId={piece.id}', "itemId={''}")),
    false,
    'fixture: an empty-string id → fails',
  );
  assertEq(
    hostPassesTheExpectedId(
      FIXTURE_HOST.replace('itemId={piece.id}', 'itemId={piece.title}'),
      'piece.id',
    ),
    false,
    'fixture: the right shape but the wrong field → fails the exact-expression check',
  );
}

// ─── 5. mutation probes on the REAL sources ───────────────────

function mutationProbes(): void {
  console.log('\nmutation probes — each guard fails on the real bytes it protects');
  const viewer = readAppFile(SCORE_VIEWER_FILE);
  const page = readAppFile(PIECE_PAGE_FILE);

  // (0) the shipped sources pass, and the v39 guard is green — the starting state.
  assertEq(scoreReaderHostsThePresets(viewer), true, 'baseline: the real score viewer hosts the presets');
  assertEq(v39SaysThePresetsAreFine(), true, 'baseline: the shipped v39 preset contract is green');

  // (1) REMOVE THE PROP — `itemId?: string | null` gone from ScoreViewerProps.
  const noProp = viewer.replace('  itemId?: string | null;\n', '');
  assert(noProp !== viewer, 'probe 1 can locate the prop declaration');
  assertEq(scoreViewerDeclaresTheIdProp(noProp), false, 'PROBE 1: id prop removed → prop guard fails');
  assertEq(scoreReaderHostsThePresets(noProp), false, 'PROBE 1: id prop removed → whole-viewer guard fails');

  // (2) DROP THE HOOK CALL — the presets are never resolved for this piece.
  const noHook = viewer.replace(
    'const speedProfiles = usePageTurnSpeed(itemId ?? null, autoScroll);',
    'const speedProfiles = { presets: [], activePresetId: null, onSelectPreset: () => {}, remembered: false };',
  );
  assert(noHook !== viewer, 'probe 2 can locate the hook call');
  assertEq(scoreViewerCallsThePresetHookWithTheId(noHook), false, 'PROBE 2: hook call dropped → hook guard fails');
  assertEq(scoreReaderHostsThePresets(noHook), false, 'PROBE 2: hook call dropped → whole-viewer guard fails');

  // (3) REMOVE speedProfiles FROM THE CONTROL — the shipped pre-v47 state.
  const noProfiles = viewer.replace('            speedProfiles={speedProfiles}\n', '');
  assert(noProfiles !== viewer, 'probe 3 can locate the prop on the control');
  assertEq(
    scoreViewerPassesProfilesToTheControl(noProfiles),
    false,
    'PROBE 3: speedProfiles off the AutoScrollControl → control guard fails (this is the v46/v47 defect)',
  );
  assertEq(scoreReaderHostsThePresets(noProfiles), false, 'PROBE 3: → whole-viewer guard fails');

  // (4) REMOVE THE HOST'S ID — the component is perfect, the host forgot the prop.
  const hostNoId = page.replace('          itemId={piece.id}\n', '');
  assert(hostNoId !== page, 'probe 4 can locate the host prop');
  assertEq(
    hostPassesThePieceIdToTheScoreViewer(hostNoId),
    false,
    'PROBE 4: host stops passing the id → host guard fails (the v46 "hosting" lesson)',
  );

  // (5) COMMENT MASKING — prose describing the wiring cannot satisfy the guard.
  const commented = viewer
    .replace('const speedProfiles = usePageTurnSpeed(itemId ?? null, autoScroll);', '/* const speedProfiles = usePageTurnSpeed(itemId ?? null, autoScroll); */')
    .replace('            speedProfiles={speedProfiles}\n', '            {/* speedProfiles={speedProfiles} */}\n');
  assertEq(scoreReaderHostsThePresets(commented), false, 'PROBE 5: commented-out wiring fails (comments are masked)');

  // (6) THE POINT OF THE ROUND — the shipped v39 guard stays GREEN through every
  //     one of the mutations above, because the score viewer is not its input.
  assertEq(
    v39SaysThePresetsAreFine(),
    true,
    'PROBE 6: v39UiContract.pageTurnerViewersShareThePresets() reads only the PDF/scanned viewers + hook — it cannot see ANY of probes 1-5',
  );

  // …and the untouched real sources still pass, so no probe proved a broken fixture.
  assertEq(scoreReaderHostsThePresets(viewer), true, 'the real score viewer still passes after every probe');
  assertEq(hostPassesThePieceIdToTheScoreViewer(page), true, 'the real piece page still passes after every probe');
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('v47 — page-turn presets in the SCORE READER (audit D1: hosting, not wiring)');
  fileMapTests();
  floorTests();
  liveScanTests();
  fixtureTests();
  mutationProbes();
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
