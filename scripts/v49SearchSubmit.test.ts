/**
 * v49SearchSubmit.test.ts — the tier1 gate for the v49 search-key fix.
 *
 * THE OWNER'S REPORT (11-03, verbatim): "Find a Piece does not work on home page
 * and second page. Typed in 'heroes by David Bowie' and front page and 2nd page do
 * not search at all. Dead on both." Both doors mount
 * `screens/FindPieceScreen.tsx`, and its field bound the keyboard's Search key to
 * `undefined` for every TYPED query — a silent no-op — while a zero-match query
 * ended on a bare "No match" with no licensed route.
 *
 * Four layers, in the house order:
 *   1. UNIT — the submit plan (`planSearchSubmit`): a submit is NEVER a no-op, it
 *      is always immediate, and it confirms an OCR proposal without ever letting
 *      the automatic path search one;
 *   2. UNIT — the zero-match state (`noMatchState`): it quotes the user's own
 *      words, says the piece is not in the free library, and carries a retailer
 *      URL built by the shared builder with the affiliate id on it;
 *   3. LIVE SCAN — the predicates in `src/services/searchSubmitContract.ts` run
 *      against the REAL screen on disk (the key binding, the handler's behaviour,
 *      the zero-match branch, and the surviving v42 fix-D gate);
 *   4. MUTATION PROBES — put each defect back and prove the guard fails: the
 *      shipped `undefined` binding, a conditional binding, an empty arrow, a
 *      submit that does not confirm the prefill, a submit that waits for the
 *      debounce, a zero-match branch with no retailer CTA, a CTA wired to
 *      `undefined`, and the v42 gate removed.
 *
 * Run with: npm run test:tier1 (plain Node, no app runtime, no react-native).
 */
import {
  planSearchSubmit,
  SEARCH_SUBMIT_EMPTY_NOTICE,
} from '../src/services/searchSubmit';
import {
  NO_MATCH_EMPTY_LIBRARY_HEADLINE,
  NO_MATCH_QUOTE_MAX_CHARS,
  NO_MATCH_RETAILER_CTA_PREFIX,
  noMatchState,
  quotedQuery,
} from '../src/services/searchNoMatch';
import {
  SMD_AFFILIATE_ID,
  externalSearchSection,
  sheetMusicDirectSearchUrl,
} from '../src/services/searchExternal';
import {
  EMPTY_BRANCH_ANCHOR,
  EMPTY_RETAILER_CTA_GATE,
  IMMEDIATE_SEARCH_FLAG,
  PREFILL_GATE,
  SEARCH_SUBMIT_SCREEN_PATH,
  SUBMIT_PROP,
  emptyStateCarriesTheRetailerRoute,
  jsxBranchBody,
  prefillGateSurvivesSubmitFix,
  propExpression,
  submitHandlerSearchesImmediately,
  submitKeyAlwaysRunsAHandler,
} from '../src/services/searchSubmitContract';
import { maskComments } from '../src/services/modalBackContract';

declare const process: { exit(code: number): never; cwd(): string };
declare const require: (moduleName: string) => any;
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
    console.error(
      `  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`,
    );
  }
}

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (
      fs.existsSync(path.join(dir, 'app.json')) &&
      fs.existsSync(path.join(dir, 'src'))
    ) {
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

// The words the owner actually typed. Every assertion below is written against
// this string so the suite keeps testing the reported defect, not a stand-in.
const OWNER_QUERY = 'heroes by David Bowie';

// ─── 1. THE SUBMIT PLAN ─────────────────────────────────────────

function submitPlanTests(): void {
  console.log('\n1. planSearchSubmit — a submit is never a no-op');

  const typed = planSearchSubmit({ query: OWNER_QUERY, prefillPending: false });
  assertEq(typed.kind, 'search', 'a typed query submits as a SEARCH');
  assertEq(typed.immediate, true, 'a submit runs NOW — it never waits out the debounce');
  assertEq(typed.confirmsPrefill, false, 'a typed query confirms nothing (there is no read)');
  assertEq(typed.notice, null, 'a real search needs no notice');
  assertEq(typed.query, OWNER_QUERY, 'the words are the user’s own, unchanged');

  const pasted = planSearchSubmit({ query: '  heroes   by  David Bowie ', prefillPending: false });
  assertEq(pasted.query, OWNER_QUERY, 'a pasted run of spaces is normalised to one search');
  assertEq(pasted.kind, 'search', 'a pasted query still searches');

  const prefill = planSearchSubmit({ query: 'Für Elise', prefillPending: true });
  assertEq(prefill.kind, 'search', 'a submitted proposal is a search');
  assertEq(prefill.confirmsPrefill, true, 'the user’s own submit IS the agreement (v42 fix D)');
  assertEq(prefill.immediate, true, 'the confirmed proposal searches immediately too');

  // THE NO-OP CLASS: an empty submit still has to answer.
  for (const blank of ['', '   ', '\n\t', null, undefined]) {
    const empty = planSearchSubmit({ query: blank, prefillPending: false });
    assertEq(empty.kind, 'empty', `an empty submit (${JSON.stringify(blank)}) is not a search`);
    assertEq(empty.immediate, false, 'an empty submit schedules no request');
    assertEq(
      empty.notice,
      SEARCH_SUBMIT_EMPTY_NOTICE,
      'an empty submit leaves a visible notice — never silence',
    );
  }
  const blankProposal = planSearchSubmit({ query: '   ', prefillPending: true });
  assertEq(blankProposal.kind, 'empty', 'a blank proposal has nothing to search');
  assertEq(blankProposal.confirmsPrefill, false, 'a blank proposal is not silently confirmed');

  // The rule, stated as a loop over everything a user can do to that field.
  const samples: unknown[] = ['', '   ', OWNER_QUERY, 'nocturne', 'Bowie', '  Für Elise  '];
  let everySubmitAnswers = true;
  for (const sample of samples) {
    for (const pending of [false, true]) {
      const plan = planSearchSubmit({ query: sample, prefillPending: pending });
      const answers = plan.kind === 'search' || !!plan.notice;
      if (!answers) everySubmitAnswers = false;
    }
  }
  assert(everySubmitAnswers, 'EVERY submit produces an action — no input is a silent no-op');
}

// ─── 2. THE ZERO-MATCH STATE ────────────────────────────────────

function noMatchTests(): void {
  console.log('\n2. noMatchState — the zero-match screen is a money path');

  const external = externalSearchSection(OWNER_QUERY, 0);
  const state = noMatchState(OWNER_QUERY, external);

  assertEq(
    state.headline,
    `No match for “${OWNER_QUERY}”`,
    '(1) the headline quotes the user’s own words — proof the search ran',
  );
  assert(
    /search ran/i.test(state.searchedLine),
    '(1) the state says out loud that the search ran',
  );
  assert(
    /not in the free library/i.test(state.honestyLine),
    '(2) the state says the piece is not in the free public-domain library',
  );
  assertEq(state.showRetailer, true, '(3) the licensed route IS offered');
  assertEq(
    state.retailerUrl,
    sheetMusicDirectSearchUrl(OWNER_QUERY),
    '(3) the CTA opens the shared builder’s URL — no hand-rolled link on the screen',
  );
  assert(
    !!state.retailerUrl && state.retailerUrl.indexOf('heroes%20by%20David%20Bowie') >= 0,
    'the retailer deep link carries the USER’S OWN query string',
  );
  assert(
    !!state.retailerUrl &&
      state.retailerUrl.indexOf(`tid=${SMD_AFFILIATE_ID}&affiliateId=${SMD_AFFILIATE_ID}`) >= 0,
    'the affiliate id rides along on the zero-match CTA (money path intact)',
  );
  assert(
    !!state.retailerUrl && !/isrc|recording/i.test(state.retailerUrl),
    'the link carries no recording/ISRC code (the “No Results” bug class)',
  );
  assert(
    state.retailerCtaLabel.indexOf(NO_MATCH_RETAILER_CTA_PREFIX) === 0 &&
      state.retailerCtaLabel.indexOf(`“${OWNER_QUERY}”`) > 0,
    'the CTA label names the piece and the user’s own words',
  );

  // The empty query: no words, no retailer — and still a rendered state.
  const blank = noMatchState('   ', externalSearchSection('', 0));
  assertEq(blank.headline, NO_MATCH_EMPTY_LIBRARY_HEADLINE, 'a blank query gets an honest headline');
  assertEq(blank.showRetailer, false, 'a blank query invents no retailer search');
  assertEq(blank.retailerUrl, undefined, 'a blank query builds no URL at all');

  // An external decision that is not visible can never produce a CTA.
  const hidden = noMatchState(OWNER_QUERY, {
    visible: false,
    query: OWNER_QUERY,
    internalMatchCount: 0,
    showMusicnotes: false,
    subtitle: '',
  });
  assertEq(hidden.showRetailer, false, 'no visible external section → no CTA (never a fake link)');

  // A pasted essay must not become a four-line title.
  const long = 'a'.repeat(120);
  const quoted = quotedQuery(long);
  assertEq(
    quoted.length,
    NO_MATCH_QUOTE_MAX_CHARS + 2,
    'a long query is quoted back, shortened to the cap (plus the quotes)',
  );
  assert(quoted.indexOf('…') > 0, 'the shortened quote ends with an ellipsis, not a silent cut');
  assertEq(quotedQuery('  '), '', 'a blank query quotes nothing');
}

// ─── 3. THE LIVE SOURCE SCAN ────────────────────────────────────

function liveScanTests(screen: string): void {
  console.log('\n3. live scan — the REAL FindPieceScreen on disk');

  assert(
    screen.length > 5000 && screen.indexOf('const handleSubmitSearch = useCallback(') >= 0,
    `the screen exists and defines the one submit handler (${SEARCH_SUBMIT_SCREEN_PATH})`,
  );

  // A. the key is always a handler
  const expression = propExpression(maskComments(screen), SUBMIT_PROP);
  assert(
    expression !== null && expression.indexOf('undefined') < 0,
    `the field binds ${SUBMIT_PROP} to a real expression (${String(expression)})`,
  );
  assertEq(
    submitKeyAlwaysRunsAHandler(screen),
    true,
    'A: the search key is ALWAYS wired to a handler — never conditional, never undefined',
  );

  // B. that handler searches now
  assertEq(
    submitHandlerSearchesImmediately(screen),
    true,
    'B: the submit handler confirms the prefill, bumps the reload token and bypasses the debounce',
  );
  assert(
    screen.indexOf(IMMEDIATE_SEARCH_FLAG) >= 0 &&
      screen.indexOf('immediate ? 0 : CATALOG_SEARCH_DEBOUNCE_MS') >= 0,
    'B: the bypass is read by the debounced effect, which keeps the debounce for typing',
  );

  // C. the zero-match branch carries the retailer route
  const emptyBody = jsxBranchBody(maskComments(screen), EMPTY_BRANCH_ANCHOR);
  assert(emptyBody !== '', 'C: the zero-match branch is present and delimited');
  assert(
    emptyBody.indexOf('noMatch.retailerUrl') >= 0,
    'C: the zero-match branch renders the licensed CTA from the pure decision',
  );
  assertEq(
    emptyStateCarriesTheRetailerRoute(screen),
    true,
    'C: the zero-match state cannot render without the retailer route (no dead end)',
  );

  // D. the v42 fix-D gate survives
  assert(
    screen.indexOf(PREFILL_GATE) >= 0,
    'D: the OCR gate is still in the search effect',
  );
  assertEq(
    prefillGateSurvivesSubmitFix(screen),
    true,
    'D: a photo read is still NEVER auto-searched (v42 fix D intact)',
  );

  // The money path the v41 batch fixed must still be there, unchanged.
  assert(
    screen.indexOf('<SearchExternalSection') >= 0 &&
      screen.indexOf('styles.resultsScroll') >= 0,
    'the two-retailer section still shares the ONE results scroller',
  );
}

// ─── 4. MUTATION PROBES ─────────────────────────────────────────

function mutationTests(screen: string): void {
  console.log('\n4. mutation probes — each defect put back must FAIL the guard');

  const submitCall = `${SUBMIT_PROP}={handleSubmitSearch}`;
  assert(screen.indexOf(submitCall) >= 0, 'the probe anchor exists in the real screen');

  const keyMutations: { label: string; source: string }[] = [
    {
      label: 'THE SHIPPED DEFECT: the key is undefined for typed queries',
      source: screen.replace(
        submitCall,
        `${SUBMIT_PROP}={prefillPending ? handleSubmitPrefill : undefined}`,
      ),
    },
    {
      label: 'the key is unconditionally undefined',
      source: screen.replace(submitCall, `${SUBMIT_PROP}={undefined}`),
    },
    {
      label: 'the key is bound to an empty arrow',
      source: screen.replace(submitCall, `${SUBMIT_PROP}={() => {}}`),
    },
    {
      label: 'the key is bound to a handler that does not exist',
      source: screen.replace(submitCall, `${SUBMIT_PROP}={handleSubmitNothing}`),
    },
  ];
  for (const mutation of keyMutations) {
    assert(mutation.source !== screen, `the mutation "${mutation.label}" changed the real screen`);
    assertEq(
      submitKeyAlwaysRunsAHandler(mutation.source),
      false,
      `MUTATION: ${mutation.label} FAILS thesis A (the key must always run a handler)`,
    );
  }

  const handlerMutations: { label: string; source: string }[] = [
    {
      label: 'the submit no longer confirms the OCR proposal',
      source: screen.replace('    setPrefillPending(false);\n    searchImmediatelyRef.current = true;', '    searchImmediatelyRef.current = true;'),
    },
    {
      label: 'the submit no longer re-runs the query',
      source: screen.replace(
        '    searchImmediatelyRef.current = true;\n    setReloadToken((n) => n + 1);',
        '    searchImmediatelyRef.current = true;',
      ),
    },
    {
      label: 'the submit waits out the type-ahead debounce',
      source: screen.replace('    searchImmediatelyRef.current = true;\n', ''),
    },
  ];
  for (const mutation of handlerMutations) {
    assert(mutation.source !== screen, `the mutation "${mutation.label}" changed the real screen`);
    assertEq(
      submitHandlerSearchesImmediately(mutation.source),
      false,
      `MUTATION: ${mutation.label} FAILS thesis B (an explicit submit is a real, immediate request)`,
    );
  }

  const emptyMutations: { label: string; source: string }[] = [
    {
      label: 'the zero-match CTA gate is forced false (the dead-end state comes back)',
      source: screen.replace(
        `{${EMPTY_RETAILER_CTA_GATE}`,
        '{false ?',
      ),
    },
    {
      label: 'the zero-match CTA is deleted outright',
      source: screen.replace(
        /            \{noMatch\.showRetailer && noMatch\.retailerUrl \? \([\s\S]*?\n            \) : null\}\n/,
        '',
      ),
    },
    {
      label: 'the zero-match CTA is wired to undefined',
      source: screen.replace(
        'onPress={() => handleOpenRetailer(noMatch.retailerUrl as string)}',
        'onPress={() => handleOpenRetailer(undefined)}',
      ),
    },
    {
      label: 'the zero-match CTA opens nothing at all',
      source: screen.replace(
        'onPress={() => handleOpenRetailer(noMatch.retailerUrl as string)}',
        'onPress={() => {}}',
      ),
    },
    {
      label: 'the honest no-match line is dropped from the state',
      source: screen.replace(
        '            <Text style={styles.emptyText}>{NO_MATCH_MESSAGE}</Text>\n',
        '',
      ),
    },
    {
      label: 'the query-side visibility gate is dropped',
      source: screen.replace(
        '            {external.visible ? (\n              <Text style={styles.emptyText}>{EXTERNAL_NO_MATCH_HINT}</Text>\n            ) : null}\n',
        '',
      ),
    },
  ];
  for (const mutation of emptyMutations) {
    assert(mutation.source !== screen, `the mutation "${mutation.label}" changed the real screen`);
    assertEq(
      emptyStateCarriesTheRetailerRoute(mutation.source),
      false,
      `MUTATION: ${mutation.label} FAILS thesis C (the zero-match state must carry the retailer route)`,
    );
  }

  const gateMutations: { label: string; source: string }[] = [
    {
      label: 'the v42 fix-D gate is removed from the search effect',
      source: screen.replace(PREFILL_GATE, 'if (false)'),
    },
    {
      label: 'the gate is moved AFTER the debounce is scheduled',
      source: screen
        .replace(`${PREFILL_GATE} {`, 'if (false) {')
        .replace(
          '    const timer = setTimeout(() => {',
          `    const timer = setTimeout(() => {\n      ${PREFILL_GATE} {\n        return;\n      }`,
        ),
    },
  ];
  for (const mutation of gateMutations) {
    assert(mutation.source !== screen, `the mutation "${mutation.label}" changed the real screen`);
    assertEq(
      prefillGateSurvivesSubmitFix(mutation.source),
      false,
      `MUTATION: ${mutation.label} FAILS thesis D (a photo read is never auto-searched)`,
    );
  }
}

// ═══════════════════════════════ RUN ════════════════════════════════════════

submitPlanTests();
noMatchTests();
const screen = readAppFile(SEARCH_SUBMIT_SCREEN_PATH);
liveScanTests(screen);
mutationTests(screen);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
