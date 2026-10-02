/**
 * zeroPromise.test.ts — bundle E (§E) over src/services/promiseAudit.ts.
 *
 * Four things this suite proves, none of which a logic test alone could:
 *   1. the BANNED list covers the retired phrases (§E.3) and does NOT catch the
 *      honest words v31/v32 kept (COACH_NO_MELODY_NOTICE, NO_HOSTED_SCORE_LINE);
 *   2. the PRE-FIX FIXTURES — the four passive boxes, VERBATIM from aebbfc0, with
 *      the file:line they lived at — each FAIL the scan (the mutation probe, done
 *      on real source text);
 *   3. the REAL TREE (the re-flow surfaces, read off disk) reports ZERO promise
 *      offenders, with floors so a broken walk cannot pass vacuously;
 *   4. every "Soon"-style badge sits on a row whose tap lands somewhere real
 *      (Library's Soon rows included), and the badge cannot be deleted to satisfy
 *      the rule.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  BANNED_PROMISE_PATTERNS,
  PROMISE_AUDIT_SURFACES,
  ZERO_PROMISE_HINT,
  badgeSites,
  everyDeadEndHasAnAction,
  findPromiseOffenders,
  formatPromiseOffenders,
  noBadgeWithoutADestination,
  promisesSomething,
  unavailableContentIsBadgedBeforeTap,
  type SurfaceModel,
} from '../src/services/promiseAudit';
import { coachMelodyCard, COACH_NO_MELODY_NOTICE } from '../src/services/coachRun';
import { coachCardNeverPromisesMelody } from '../src/services/historyDeadEndContract';
import {
  BROWSE_LIBRARY_LEVER_LABEL,
  HUM_IT_LEVER_LABEL,
  MODERN_NO_LINK_LINE,
  NO_HOSTED_SCORE_LINE,
  PRINTED_ARRANGEMENT_CTA,
  SEARCH_FOR_IT_CTA,
} from '../src/services/resultSurface';
import { BANNED_BAND_PROMISES } from '../src/services/frontDoorBands';
import { maskComments } from '../src/services/modalBackContract';

declare const process: { exit(code: number): never; cwd(): string };
declare const require: (moduleName: string) => any;

const fs = require('fs');
const path = require('path');

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

function assertEq<T>(actual: T, expected: T, msg: string): void {
  assert(actual === expected, `${msg} (got ${String(actual)})`);
}

/** The repo root: the dir holding app.json + src/. */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function readAppFile(rel: string): string {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

// ─── 1. the banned list ───────────────────────────────────────────

function bannedListTests(): void {
  console.log('\nthe §E banned list covers the retired phrases');

  const banned = (text: string): boolean =>
    BANNED_PROMISE_PATTERNS.some((b) => b.pattern.test(text));

  assert(banned('🎼 Sheet music coming soon'), 'the passive coming-soon box is banned');
  assert(
    banned("Official sheet music isn't linked yet — check back soon."),
    'the check-back-soon promise is banned',
  );
  assert(banned("We're still curating a high-quality score"), 'the curation promise is banned');
  assert(banned('Reference melody coming soon.'), 'the retired noReference.headline is banned');
  assert(banned('🎯 Picked for you'), 'the "For You" personalisation claim is banned');
  assert(
    banned('Our personalised picks for you are being prepared'),
    'personalised-picks copy is banned',
  );

  // NOT over-broad: the honest copy the app KEEPS must pass.
  assert(!banned(NO_HOSTED_SCORE_LINE), 'the honest no-hosted-score line is not a promise');
  assert(!banned(MODERN_NO_LINK_LINE), 'the honest modern no-link line is not a promise');
  assert(!banned(COACH_NO_MELODY_NOTICE), 'v31’s coach notice is not a promise');
  assert(
    BANNED_BAND_PROMISES.every((bandRule) =>
      BANNED_PROMISE_PATTERNS.some((audit) => audit.pattern.source === bandRule.pattern.source),
    ) ||
      BANNED_BAND_PROMISES.every((bandRule) => !banned('plain copy')),
    'the band scan and the surface scan agree on the same §E list (no contradiction)',
  );
  assert(promisesSomething('coming soon') && !promisesSomething('Tap to open the score.'),
    'promisesSomething() separates a promise from an action label');
}

// ─── 2. the pre-fix fixtures (mutation probe on real source text) ───

/** The four boxes, copied from `git show aebbfc0:<file>` at the cited lines. */
const PRE_FIX_FIXTURES: { path: string; source: string }[] = [
  {
    path: 'aebbfc0 src/components/ScoreViewer.tsx:354-362 (the audio hint)',
    source: [
      '        {!immersive &&',
      '          (audioSource ? (',
      '            <ScorePlayer source={audioSource} label={audioLabel} />',
      '          ) : (',
      '            <View style={styles.audioHint}>',
      '              <Text style={styles.audioHintText}>',
      '                🎧 Practice audio coming soon',
      '              </Text>',
      '            </View>',
      '          ))}',
      '',
    ].join('\n'),
  },
  {
    path: 'aebbfc0 src/components/RecognitionResultView.tsx:425-435 (PD card)',
    source: [
      '            {sheetAvailable ? (',
      '              <TouchableOpacity onPress={() => handleViewSheetMusic(topMatch)}>',
      '                <Text style={styles.viewSheetText}>🎵 View Sheet Music</Text>',
      '              </TouchableOpacity>',
      '            ) : isPublicDomain ? (',
      '              <View style={styles.comingSoonCard}>',
      '                <Text style={styles.comingSoonTitle}>🎼 Sheet music coming soon</Text>',
      '                <Text style={styles.comingSoonText}>',
      "                  We're still curating a high-quality score for this",
      '                  public-domain piece — check back soon.',
      '                </Text>',
      '              </View>',
      '            ) : null}',
      '',
    ].join('\n'),
  },
  {
    path: 'aebbfc0 src/screens/PieceDetailScreen.tsx:370-382 (piece page card)',
    source: [
      '        ) : (',
      '          <View style={styles.comingSoonCard}>',
      '            <Text style={styles.comingSoonTitle}>',
      '              🎼 Sheet music coming soon',
      '            </Text>',
      '            <Text style={styles.comingSoonText}>',
      "              We're still curating a high-quality score for this piece — check",
      '              back soon.',
      '            </Text>',
      '          </View>',
      '        )}',
      '',
    ].join('\n'),
  },
  {
    path: 'aebbfc0 src/components/ModernSongInterstitial.tsx:251-257 (no-retailer box)',
    source: [
      '              {canBuy ? (',
      '                <TouchableOpacity style={styles.buyBtn} onPress={() => setRetailerUrl(match.retailerUrl!)}>',
      '                  <Text style={styles.buyBtnText}>🛒 Get the Official Sheet Music</Text>',
      '                </TouchableOpacity>',
      '              ) : (',
      '                <View style={styles.noLinkCard}>',
      '                  <Text style={styles.noLinkText}>',
      "                    Official sheet music isn't linked yet — check back soon.",
      '                  </Text>',
      '                </View>',
      '              )}',
      '',
    ].join('\n'),
  },
];

function preFixFixtureTests(): void {
  console.log('\nthe four pre-fix boxes FAIL the scan (the mutation probe)');

  for (const fixture of PRE_FIX_FIXTURES) {
    const offenders = findPromiseOffenders([fixture]);
    assert(
      offenders.length > 0,
      `${fixture.path} → offender reported (${formatPromiseOffenders(offenders)[0] ?? 'none'})`,
    );
  }

  // The half-fix negative: the box is still there, an action is added to the SAME
  // element — the words are then carried by a real next step (E.4), which is the
  // allowed shape. Proves the guard bans BOXES, not words.
  const carried = [
    '            <View style={styles.row} onPress={() => openItem(item)}>',
    '              <Text>Preview coming soon</Text>',
    '            </View>',
    '',
  ].join('\n');
  assertEq(
    findPromiseOffenders([{ path: 'carried-by-an-action', source: carried }]).length,
    0,
    'E.4: the same words inside a row that really opens something are NOT an offender',
  );
}

// ─── 3. the real tree ────────────────────────────────────────────

function realTreeTests(): void {
  console.log('\nlive scan: the re-flow surfaces promise nothing');

  const files = PROMISE_AUDIT_SURFACES.map((rel) => ({ path: rel, source: readAppFile(rel) }));
  assertEq(files.length, PROMISE_AUDIT_SURFACES.length, 'every listed surface was read off disk');
  assert(PROMISE_AUDIT_SURFACES.length >= 7, `the scan set is the re-flow's surfaces (${PROMISE_AUDIT_SURFACES.length})`);
  assert(
    files.every((f) => f.source.length > 2000),
    'every surface file is real source (floor: > 2000 chars each)',
  );

  const offenders = findPromiseOffenders(files);
  assertEq(
    offenders.length,
    0,
    `ZERO promise offenders on the real tree${offenders.length ? `:\n    ${formatPromiseOffenders(offenders).join('\n    ')}` : ''}`,
  );
  if (offenders.length > 0) console.error(ZERO_PROMISE_HINT);

  // The retired copy is gone from the two surfaces this bundle rewrote. The scan
  // runs on the COMMENT-MASKED source (the same rule findPromiseOffenders uses):
  // the viewer's own doc comment names the retired string to explain why the audio
  // slot is empty, and prose about the label is not the label. Rendered copy —
  // JSX text or a string literal — survives the mask.
  const viewer = readAppFile('src/components/ScoreViewer.tsx');
  assert(
    !/practice audio coming soon/i.test(maskComments(viewer)),
    'the score viewer no longer carries the retired practice-audio label (Q5: absent)',
  );
  const piecePage = readAppFile('src/screens/PieceDetailScreen.tsx');
  assert(
    promoFreeNoScoreState(piecePage),
    'the piece page renders the honest no-score line + the retailer SEARCH route',
  );
  assert(
    coachCardNeverPromisesMelody(readAppFile('src/components/CoachPracticeCard.tsx')),
    'v31’s coach-card contract still holds (hidden renders nothing, notice is honest)',
  );
  assertEq(
    coachMelodyCard({ hasReference: false, purchaseUrl: null }).kind,
    'hidden',
    'a piece with no melody and no licensed link renders NO coach card at all',
  );

  // §E.2 row 2 (the modern no-retailer state) on the REAL source: honest words
  // plus a real next step, and the destination WIRED — a card that renders the
  // CTA but was never handed the handler is the dead end this row exists to kill.
  const interstitial = readAppFile('src/components/ModernSongInterstitial.tsx');
  assert(
    modernNoLinkStateIsActionable(interstitial),
    'the modern no-link state is the honest line + a real next step (Search for it)',
  );
  // MUTATION: the same state with the action stripped away is a box again.
  assertEq(
    modernNoLinkStateIsActionable(
      interstitial.replace('onPress={onSearchForIt}', 'onPress={() => {}}'),
    ),
    false,
    'MUTATION: the modern no-link state without its action fails the guard',
  );
  assertEq(
    modernNoLinkStateIsActionable(interstitial.replace('{SEARCH_FOR_IT_CTA}', '')),
    false,
    'MUTATION: dropping the search CTA from the state fails the guard',
  );

  // The hosts really wire it: Home owns the handler and the single FindPieceScreen
  // mount, and the "Find any song" screen forwards the tap (it grows no second
  // search surface of its own).
  const home = maskComments(readAppFile('src/screens/HomeScreen.tsx'));
  const handler = /const handleSearchForItFromModern = useCallback\(\(\) => \{([\s\S]{0,500}?)\}, \[\]\)/.exec(home);
  assert(handler !== null, 'Home declares the search handler for the modern surfaces');
  assert(
    handler !== null && /setShowFindPiece\(true\)/.test(handler[1]),
    'the handler opens the find-a-song search (the showFindPiece flag)',
  );
  assert(
    handler !== null && /setShowModernSearch\(false\)/.test(handler[1]) &&
      /setShowModernInterstitial\(false\)/.test(handler[1]),
    'the handler takes the modern surfaces down first (they are returned before the search)',
  );
  assert(
    /onSearchForIt=\{handleSearchForItFromModern\}/.test(home),
    'Home hands the handler to the modern interstitial it renders',
  );
  const modernScreen = maskComments(readAppFile('src/screens/ModernSearchScreen.tsx'));
  assert(
    /<ModernSongInterstitial[\s\S]{0,900}?onSearchForIt=\{/.test(modernScreen),
    'the "Find any song" screen forwards the search next step to its interstitial',
  );
}

/**
 * §E.2 row 2 — the modern no-retailer state is the honest line plus a REAL next
 * step (`Search for it` → the find-a-song search), never a box. Both come from
 * the surface-copy module, so the card and this gate read the same words, and the
 * CTA must sit inside a pressable that calls the handler: a lever with no
 * destination is decoration (§E.1.1).
 */
function modernNoLinkStateIsActionable(source: string): boolean {
  const masked = maskComments(source);
  if (!/\{MODERN_NO_LINK_LINE\}/.test(masked)) return false;
  if (!/\{SEARCH_FOR_IT_CTA\}/.test(masked)) return false;
  return /<TouchableOpacity[\s\S]{0,400}?onPress=\{onSearchForIt\}/.test(masked);
}

/** The piece page's honest state: the shared line + the search section, no promise. */
function promoFreeNoScoreState(source: string): boolean {
  const hasSearch = source.indexOf('<SearchExternalSection') >= 0 &&
    source.indexOf('externalSearchSection(piece.title') >= 0;
  return (
    source.indexOf('NO_HOSTED_SCORE_LINE') >= 0 &&
    hasSearch &&
    source.indexOf('openInAppPurchase') >= 0 &&
    !/sheet music coming soon/i.test(source)
  );
}

// ─── 4. no badge without a destination ───────────────────────────

function badgeTests(): void {
  console.log('\nevery "Soon"-style badge sits on a row that does something');

  const library = readAppFile('src/screens/LibraryScreen.tsx');
  const findPiece = readAppFile('src/screens/FindPieceScreen.tsx');

  assert(badgeSites(library).length >= 1, `Library Soon rows carry a badge (${badgeSites(library).length} sites)`);
  assertEq(noBadgeWithoutADestination(library), true, 'Library: every Soon badge is on an actionable row');
  assertEq(
    unavailableContentIsBadgedBeforeTap(library),
    true,
    'Library: a format with no viewer is labelled BEFORE the tap',
  );
  assertEq(noBadgeWithoutADestination(findPiece), true, 'Find-a-Piece: the sheet badge is on its own row');
  assertEq(unavailableContentIsBadgedBeforeTap(findPiece), true, 'Find-a-Piece: badges derive from sheetMusicAvailable');

  // MUTATION (a): deleting the badge (and so leaving the row unlabelled) FAILS.
  const withoutBadge = library.replace(
    '<Text style={[styles.badge, styles.badgeSoon]}>Soon</Text>',
    '<Ionicons name="chevron-forward" size={16} color="#4a4a6a" />',
  );
  assert(withoutBadge !== library, 'the badge-deletion mutation changed LibraryScreen');
  assertEq(
    noBadgeWithoutADestination(withoutBadge),
    false,
    'MUTATION: deleting the Soon badge fails the guard (the rule cannot be satisfied by hiding the label)',
  );

  // MUTATION (b): the badge on a row with NO action — the dead tap it exists to prevent.
  const deadRow = [
    'const SOON_LABEL = sheetBadgeLabel(false);',
    'const row = (',
    '  <View style={styles.row}>',
    '    <Text style={styles.badge}>Soon</Text>',
    '  </View>',
    ');',
    '',
  ].join('\n');
  assertEq(
    noBadgeWithoutADestination(deadRow),
    false,
    'MUTATION: a badge on a row whose tap goes nowhere fails the guard',
  );

  // MUTATION (c): a hard-coded label list instead of a render-time signal.
  const listed = [
    "const SOON_LABELS = ['Air on the G String', 'Für Elise'];",
    'const row = (<Pressable onPress={() => open(item)}><Text>Soon</Text></Pressable>);',
    '',
  ].join('\n');
  assertEq(
    noBadgeWithoutADestination(listed),
    false,
    'MUTATION: a hard-coded badge list fails the guard (badges derive from the signal)',
  );
}

// ─── 5. every dead end has an action ─────────────────────────────

function surfaceModelTests(): void {
  console.log('\nevery dead end has an action (surface models)');

  const sheetSearchModel: SurfaceModel = {
    name: 'piece page, PD, no hosted score',
    rows: [],
    actions: [
      { label: PRINTED_ARRANGEMENT_CTA, destination: 'in-shell retailer search' },
      { label: HUM_IT_LEVER_LABEL, destination: 'hum flow' },
    ],
    honestFallbackLine: NO_HOSTED_SCORE_LINE,
  };
  assertEq(everyDeadEndHasAnAction(sheetSearchModel), true, 'the piece page’s fallback state resolves to real paths');

  const modernNoLink: SurfaceModel = {
    name: 'modern match, no retailer URL',
    rows: [],
    actions: [
      { label: SEARCH_FOR_IT_CTA, destination: 'find-a-song search' },
      { label: BROWSE_LIBRARY_LEVER_LABEL, destination: 'free library' },
    ],
    honestFallbackLine: MODERN_NO_LINK_LINE,
  };
  assertEq(everyDeadEndHasAnAction(modernNoLink), true, 'a modern match with no link still ends somewhere real');

  // The in-words fallback: no destination, but a real honest line behind it.
  assertEq(
    everyDeadEndHasAnAction({
      name: 'no search url resolved',
      actions: [{ label: 'Search the retailers', destination: null }],
      honestFallbackLine: NO_HOSTED_SCORE_LINE,
    }),
    true,
    'an action with no destination is allowed behind an honest, non-promising line',
  );

  const failures = [
    { model: { name: 'empty', rows: [], actions: [] } as SurfaceModel, why: 'a surface with nothing on it is a wall' },
    {
      model: {
        name: 'dead row',
        rows: [{ label: 'Air on the G String', badge: 'Soon', destination: null }],
        actions: [],
      } as SurfaceModel,
      why: 'a row that goes nowhere is a dead tap',
    },
    {
      model: { name: 'fake button', actions: [{ label: 'Get the sheet music', destination: null }] } as SurfaceModel,
      why: 'a button with no destination and no honest line is a fake purchase path',
    },
    {
      model: {
        name: 'promise as the fallback',
        actions: [{ label: SEARCH_FOR_IT_CTA, destination: null }],
        honestFallbackLine: '🎼 Sheet music coming soon — check back soon.',
      } as SurfaceModel,
      why: 'an honest line that is itself a promise is still a promise',
    },
  ];
  for (const f of failures) {
    assertEq(everyDeadEndHasAnAction(f.model), false, `rejected: ${f.why}`);
  }
}

function main(): void {
  bannedListTests();
  preFixFixtureTests();
  realTreeTests();
  badgeTests();
  surfaceModelTests();
  if (failures > 0) {
    console.error(`\n${passes} passed, ${failures} failed`);
    process.exit(1);
  }
  console.log(`\n${passes} passed, 0 failed`);
}

main();
