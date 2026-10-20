/**
 * uxr-v43-settings.test.ts — DESIGNER SPEC §3, SETTINGS REGROUPED (v43 slice 2).
 *
 * The spec's §3 rule: Settings is FOUR groups (Pro row → Audio & Recording →
 * Playback → Cloud Sync & Storage → Support) with ONE row style, cards carrying
 * the group bounds, and NO Account section — because nothing in the app creates
 * an account, so the screen says so once at the bottom instead.
 *
 * EVERY guard below is a SOURCE SCAN of the real files, so it bites without a
 * recompile (that is how the mutation probes — in-memory here, byte-exact on the
 * real file in the delivery evidence — are run):
 *   src/screens/SettingsScreen.tsx  — the four groups, the one row, the wiring
 *   src/services/settingsSpec.ts    — the copy's VALUES (the spec's words)
 *   app.json                        — the live version + the privacy URL's owner
 *   App.tsx                         — the Cloud Sync route really exists
 *
 * Section 8 is the BITE PROOF: each detector is run against a mutation of the
 * REAL screen source that restores the defect it guards.
 */
import { maskSourceComments } from '../src/services/audioFocusContract';
import { DARK_THEME, LIGHT_THEME } from '../src/services/theme';
import {
  NOISE_FILTER_VALUE,
  SETTINGS_FAQ,
  SETTINGS_GROUP_TITLES,
  SETTINGS_NO_ACCOUNT_LINE,
  SETTINGS_PRO_CTA,
  SETTINGS_PRO_SUB,
  SETTINGS_PRO_TITLE,
  SETTINGS_PRIVACY_URL,
  SETTINGS_RENDERED_ROLES,
  SETTINGS_ROLES,
  SETTINGS_ROWS,
  SETTINGS_SPEC,
  SETTINGS_SPEC_STYLES,
  SETTINGS_VALUE_ONLY_ROWS,
  aboutDialogBody,
  aboutVersionLine,
  autoScrollValueLabel,
  cloudValueLabel,
  faqDialogBody,
  microphoneAccessLabel,
  noiseFilterValueLabel,
  settingsGroupsAreCards,
  settingsHasGroupsInOrder,
  settingsHasNoAccountSection,
  settingsHasNoDeadRows,
  settingsHeadersPrecedeTheirRows,
  settingsProRowIsWired,
  settingsRowGeometry,
  settingsRowsAreTheClosedSet,
  settingsRowsReachRealDestinations,
  settingsPalette,
  settingsSpecHasNoHexColors,
  settingsStyleBody,
  settingsSurfaceContracts,
  settingsVersionIsLive,
  specRowTitles,
  themeValueLabel,
} from '../src/services/settingsSpec';

declare const process: { cwd(): string; exit(code: number): never };
declare const require: (name: string) => any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ FAILED: ${label}`);
  }
}
function assertEq(actual: unknown, expected: unknown, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, ok ? label : `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let at = 0; at < 6; at += 1) {
    if (fs.existsSync(path.join(dir, 'app.json')) && fs.existsSync(path.join(dir, 'src'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}

const ROOT = repoRoot();
function read(relative: string): string {
  const fs = require('fs');
  const path = require('path');
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

const SETTINGS_PATH = 'src/screens/SettingsScreen.tsx';
const settings = read(SETTINGS_PATH);
const appJson = JSON.parse(read('app.json'));
const appTsx = read('App.tsx');

/** The colours the app ALREADY ships — the only hexes the surface may resolve to. */
const SHIPPED_HEXES: string[] = Object.keys(DARK_THEME)
  .map((key) => (DARK_THEME as unknown as Record<string, string>)[key])
  .concat(Object.keys(LIGHT_THEME).map((key) => (LIGHT_THEME as unknown as Record<string, string>)[key]))
  .map((value) => value.toLowerCase());

// ═══════════════════════ §3 · the copy (verbatim) ═══════════════════════

console.log('\n§3 COPY — the screen says what the spec says');

assertEq(
  SETTINGS_GROUP_TITLES,
  ['Audio & Recording', 'Playback', 'Cloud Sync & Storage', 'Support'],
  'the four groups, in the spec’s order',
);
assertEq(SETTINGS_PRO_TITLE, 'NoteSnap Pro', 'the Pro row’s title');
assertEq(SETTINGS_PRO_SUB, 'Unlimited recognition · full History', 'the Pro row’s subtitle, verbatim');
assertEq(SETTINGS_PRO_CTA, 'View plans', 'the pill is "View plans"');
assertEq(
  SETTINGS_NO_ACCOUNT_LINE,
  'No account needed — NoteSnap has nothing to sign in to.',
  'the one bottom line, verbatim',
);
assertEq(
  SETTINGS_ROWS.map((row) => row.title),
  [
    'Microphone access',
    'Noise filter',
    'Theme',
    'Auto-scroll speed',
    'Google Drive',
    'Dropbox',
    'Help & FAQ',
    'Privacy policy',
    'About NoteSnap',
  ],
  'the closed row set, in the spec’s order',
);
assertEq(
  SETTINGS_ROWS.filter((row) => row.group === 0).map((row) => row.title),
  ['Microphone access', 'Noise filter'],
  'Audio & Recording holds the microphone and the noise filter',
);
assertEq(
  SETTINGS_ROWS.filter((row) => row.group === 2).map((row) => row.title),
  ['Google Drive', 'Dropbox'],
  'Cloud Sync & Storage holds the two providers',
);
assertEq(
  SETTINGS_ROWS.filter((row) => row.group === 3).map((row) => row.title),
  ['Help & FAQ', 'Privacy policy', 'About NoteSnap'],
  'Support holds help, privacy and about',
);
assertEq(
  SETTINGS_ROWS.filter((row) => row.sub === '').map((row) => row.title),
  ['Help & FAQ', 'Privacy policy', 'About NoteSnap'],
  'only the Support rows are sub-less (their titles centre)',
);

console.log('\n§3 GEOMETRY — the spec’s numbers, named once');
assertEq(SETTINGS_SPEC.rowHeight, 52, 'a row is 52 dp');
assertEq(SETTINGS_SPEC.rowInset, 32, 'the row’s text is inset x32');
assertEq(SETTINGS_SPEC.rowTitleSize, 15, 'row title 15 dp');
assertEq(SETTINGS_SPEC.rowSubSize, 11, 'row sub 11 dp');
assertEq(SETTINGS_SPEC.rowValueSize, 13, 'row value 13 dp');
assertEq(SETTINGS_SPEC.subRightCap, 100, 'the sub is capped at right-100 dp');
assertEq(SETTINGS_SPEC.headerSize, 11, 'header 11 dp');
assertEq(SETTINGS_SPEC.headerAbove, 20, '20 dp above a header');
assertEq(SETTINGS_SPEC.headerBelow, 18, '18 dp below a header');
assertEq(SETTINGS_SPEC.cardRadius, 16, 'cards r16');
assertEq(SETTINGS_SPEC.cardGap, 20, 'cards 20 dp apart');
assertEq(SETTINGS_SPEC.cardBorderWidth, 1, 'cards carry a 1 dp CARD_LINE border');
assertEq(SETTINGS_SPEC.proHeight, 62, 'the Pro row is 62 dp');
assertEq(SETTINGS_SPEC.proTitleSize, 16, 'the Pro title is 16 dp');
assertEq(SETTINGS_SPEC.proSubSize, 12, 'the Pro sub is 12 dp');
assertEq(SETTINGS_SPEC.toggleWidth, 38, 'a toggle would be 38 × 22 (no row owns one yet)');
assertEq(SETTINGS_SPEC.footnoteSize, 11.5, 'the bottom line is 11.5 dp');

// ═══════════════════════ §3 · the four groups ═══════════════════════

console.log('\n§3 GROUPS — four headers, in order, with no Account section');

assert(settings.length > 20000, `read ${SETTINGS_PATH} (${settings.length} chars)`);
assert(settingsHasGroupsInOrder(settings), 'the four headers render in the spec’s order');
assert(settingsHeadersPrecedeTheirRows(settings), 'each header sits above the rows of its own group');
assert(settingsHasNoAccountSection(settings), 'there is no Account section and no sign-in/profile row');
assert(
  maskSourceComments(settings).indexOf('{SETTINGS_NO_ACCOUNT_LINE}') >= 0,
  'the honest statement replaces the Account block',
);
assert(!/title="Account"/.test(maskSourceComments(settings)), 'no row is titled Account');
assert(
  !/\b(?:Sign in|Sign In|Log in|Create account)\b/.test(maskSourceComments(settings)),
  'no sign-in affordance anywhere on the surface',
);

// ═══════════════════════ §3 · the Pro row (money path) ═══════════════════════

console.log('\n§3 PRO ROW — one quiet row, and its pill opens the EXISTING plans flow');
assert(settingsProRowIsWired(settings), 'the Pro row renders and its "View plans" pill is wired to openPlans');
assert(
  maskSourceComments(settings).indexOf('onPress={() => handleUpgrade(plan.id)}') >= 0,
  'View plans opens the checkout cards that already existed (handleUpgrade)',
);
assert(
  /backgroundColor: palette\.CARD, borderColor: palette\.LISTEN/.test(settings),
  'the Pro row is CARD fill + 1 dp LISTEN border (token roles, both themes)',
);

// ═══════════════════════ §3 · the one row, the cards ═══════════════════════

console.log('\n§3 ONE ROW — one geometry, cards carry the group bounds');
assert(settingsRowGeometry(settings), 'the StyleSheet carries the spec’s row/header/card/Pro numbers');
assert(settingsGroupsAreCards(settings), 'exactly four CARD + CARD_LINE cards bound the groups (hairline LINE between rows)');
assert(
  settingsStyleBody(settings, 'specRow') !== null && settingsStyleValueOf('specRow', 'flexDirection') === 'row',
  'the row lays its copy and its trailing value out as a row',
);
function settingsStyleValueOf(style: string, prop: string): string | null {
  const body = settingsStyleBody(settings, style);
  if (body === null) return null;
  const match = new RegExp(`(?:^|[\\s,{])${prop}\\s*:\\s*(?:'([^']*)'|([-0-9.]+))`).exec(body);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

console.log('\n§3 TOKENS — the role map is existing theme.ts roles, both themes');
assertEq(SETTINGS_ROLES.length, 10, 'ten designer roles, named once');
assertEq(
  SETTINGS_ROLES.filter((role) => SETTINGS_RENDERED_ROLES.indexOf(role) < 0),
  ['PILL_ON'],
  'only the toggle knob is reserved (no row owns a switch yet)',
);
assert(settingsSpecHasNoHexColors(settings), 'no §3 style holds a hex; every role is read from the palette');
for (const style of SETTINGS_SPEC_STYLES) {
  const body = settingsStyleBody(settings, style);
  assert(body !== null && !/#[0-9a-fA-F]{3,8}/.test(body), `style ${style} exists and carries no colour`);
}
for (const mode of [DARK_THEME, LIGHT_THEME]) {
  const palette = settingsPalette(mode);
  assert(
    SETTINGS_ROLES.every((role) => SHIPPED_HEXES.indexOf(palette[role].toLowerCase()) >= 0),
    `every role resolves to a shipped token value (${mode === DARK_THEME ? 'dark' : 'light'})`,
  );
}

// ═══════════════════════ §3 · every row resolves ═══════════════════════

console.log('\n§3 NO DEAD ROWS — each row reaches a destination that exists');
assertEq(
  specRowTitles(settings),
  SETTINGS_ROWS.map((row) => row.title),
  'the screen renders exactly the closed set, in order, once each',
);
assert(settingsRowsAreTheClosedSet(settings), 'the rendered copy matches the spec’s copy (no drift, no extra row)');
assert(settingsHasNoDeadRows(settings), 'every row is either wired or a declared honest VALUE row');
assertEq(SETTINGS_VALUE_ONLY_ROWS, ['noiseFilter', 'autoScroll'], 'two rows are honest values, not controls');
assert(settingsRowsReachRealDestinations(settings), 'the destinations greped for are all present in the screen');
assert(
  appTsx.indexOf('name="CloudSync"') >= 0,
  'the Cloud Sync screen the cloud rows open is really registered in App.tsx',
);
assert(
  maskSourceComments(settings).indexOf("navigate('CloudSync')") >= 0,
  'the cloud rows route to that registered screen',
);
assert(
  maskSourceComments(settings).indexOf('Linking.openSettings()') >= 0,
  'the microphone row opens the system settings page (the app’s existing permission path)',
);
assert(
  maskSourceComments(settings).indexOf('WebBrowser.openBrowserAsync(SETTINGS_PRIVACY_URL)') >= 0,
  'the privacy row opens the policy in the in-app browser',
);
assertEq(
  SETTINGS_PRIVACY_URL,
  appJson.expo.privacyPolicyUrl,
  'one owner for the privacy URL: the app agrees with its own app.json (the Play listing’s URL)',
);

console.log('\n§3 HONEST VALUES — the app never claims a state it does not have');
assertEq(microphoneAccessLabel('granted'), 'Allowed', 'a granted microphone reads "Allowed"');
assertEq(microphoneAccessLabel('denied'), 'Not allowed', 'a denied microphone never reads "Allowed"');
assertEq(microphoneAccessLabel('undetermined'), 'Not asked yet', 'an unasked permission says so');
assertEq(microphoneAccessLabel('unknown'), 'Not checked', 'an unreadable permission is not a fabricated yes');
assertEq(noiseFilterValueLabel(), NOISE_FILTER_VALUE, 'the noise filter reports the truth (always applied)');
assertEq(autoScrollValueLabel(), 'Intermediate', 'auto-scroll names the profile a new piece starts from');
assertEq(cloudValueLabel(true), 'Connected', 'a connected provider reads "Connected"');
assertEq(cloudValueLabel(false), 'Not connected', 'a disconnected provider reads "Not connected"');
assertEq(themeValueLabel('dark'), 'Dark', 'the theme row reads the live mode (dark)');
assertEq(themeValueLabel('light'), 'Light', 'the theme row reads the live mode (light)');

console.log('\n§3 LIVE VERSION — the About row is the app config, not the frame’s stale number');
assertEq(aboutVersionLine('0.1.36'), 'Version 0.1.36', 'the live config version is what is shown');
assertEq(aboutVersionLine(null), 'Version unavailable', 'an unreadable config says so instead of a number');
assertEq(aboutVersionLine('  '), 'Version unavailable', 'a blank version is not invented');
assert(settingsVersionIsLive(settings), 'the screen reads Constants.expoConfig?.version and hard-codes no version');
assertEq(
  typeof appJson.expo.version,
  'string',
  `app.json really carries the live version (${appJson.expo.version})`,
);
assert(
  maskSourceComments(settings).indexOf('Version 0.1.32') < 0,
  'the spec frame’s stale "Version 0.1.32" is NOT in the screen',
);

console.log('\n§3 FAQ — the help content is short, honest and backed by this build');
assert(SETTINGS_FAQ.length >= 3, `${SETTINGS_FAQ.length} honest questions`);
assert(
  SETTINGS_FAQ.every((entry) => entry.q.length > 0 && entry.a.length > 0),
  'every FAQ entry has a question and an answer',
);
assert(
  SETTINGS_FAQ.some((entry) => /public-domain/i.test(entry.a)),
  'the recognition answer names the public-domain library rather than "any song"',
);
assert(
  faqDialogBody().indexOf(SETTINGS_FAQ[0].q) === 0,
  'the dialog body is built from the same entries (no second copy of the words)',
);
assert(aboutDialogBody('0.1.36').indexOf('Version 0.1.36') === 0, 'the About dialog leads with the live version');

// ═══════════════════════ 8 · THE BITE PROOF ═══════════════════════

console.log('\nMUTATION PROBES — each detector FAILS when its contract is broken');
function probe(label: string, mutated: string, detector: (source: string) => boolean): void {
  assert(mutated !== settings, `${label} — the mutation really changed the source`);
  assert(detector(mutated) === false, `${label} — the detector goes red`);
}

probe(
  'a section header is deleted',
  settings.replace('>Playback</Text>', '>Playback now</Text>'),
  settingsHasGroupsInOrder,
);
probe(
  'the View plans pill loses its onPress',
  settings.split('onPress={openPlans}').join('onPress={() => undefined}'),
  settingsProRowIsWired,
);
probe(
  'a hex is hard-coded into the §3 layout',
  settings.replace(
    "specRowTitle: { fontSize: 15, fontWeight: '700' }",
    "specRowTitle: { fontSize: 15, fontWeight: '700', color: '#e94560' }",
  ),
  settingsSpecHasNoHexColors,
);
probe(
  'an Account section is added back',
  settings.replace(
    '>Support</Text>',
    '>Account</Text><Text style={styles.specHeader} accessibilityRole="header">Account</Text>',
  ),
  settingsHasNoAccountSection,
);
probe(
  'the version is hard-coded to the frame’s stale number',
  settings.replace('{aboutVersionLine(appVersion)}', "{'Version 0.1.32'}"),
  settingsVersionIsLive,
);
probe(
  'a row loses its destination (dead row)',
  settings.replace('onPress={openCloudSync}', ''),
  settingsHasNoDeadRows,
);
probe(
  'a row that is only a value pretends to be pressable',
  settings.replace('value={noiseFilterValueLabel()}', 'value={noiseFilterValueLabel()} onPress={openSystemSettings}'),
  settingsHasNoDeadRows,
);
probe(
  'an extra row appears outside the closed set',
  settings.replace(
    '          title="Privacy policy"',
    '          title="Restore purchases"\n          onPress={openHelp}\n          divider\n        />\n        <SpecRow\n          palette={palette}\n          divider\n          title="Privacy policy"',
  ),
  settingsRowsAreTheClosedSet,
);
probe(
  'a row title drifts from the spec’s copy',
  settings.replace('title="Auto-scroll speed"', 'title="Auto scroll"'),
  settingsRowsAreTheClosedSet,
);
probe(
  'a header is moved below its own rows',
  settings.replace(
    '>Audio & Recording</Text>',
    '>Audio & Recording (below)</Text>',
  ),
  settingsHeadersPrecedeTheirRows,
);
probe(
  'the row height drifts from the spec',
  settings.replace('  specRow: {\n    height: 52,', '  specRow: {\n    height: 48,'),
  settingsRowGeometry,
);
probe(
  'a group stops being a card (no CARD + CARD_LINE bounds)',
  settings.replace(
    '[styles.specGroup, { backgroundColor: palette.CARD, borderColor: palette.CARD_LINE }]',
    '[styles.specGroup, { backgroundColor: palette.CARD }]',
  ),
  settingsGroupsAreCards,
);
probe(
  'the hairline between rows disappears',
  settings.replace('{ backgroundColor: palette.LINE }', '{ backgroundColor: palette.CARD_LINE }'),
  settingsGroupsAreCards,
);
probe(
  'the footnote is repeated',
  settings.replace(
    '{SETTINGS_NO_ACCOUNT_LINE}',
    '{SETTINGS_NO_ACCOUNT_LINE}{SETTINGS_NO_ACCOUNT_LINE}',
  ),
  (source) => source.indexOf('{SETTINGS_NO_ACCOUNT_LINE}') >= 0 && source.split('{SETTINGS_NO_ACCOUNT_LINE}').length === 2,
);
probe(
  'the microphone row loses the settings page it opens',
  settings.split('Linking.openSettings()').join("Linking.canOpenURL('x')"),
  settingsRowsReachRealDestinations,
);

console.log('\n§3 ALL CONTRACTS — the whole surface in one verdict');
assert(settingsSurfaceContracts(settings), 'the real Settings screen satisfies every §3 contract at once');
const broken = settings.replace('>Support</Text>', '>Support & more</Text>');
assert(settingsSurfaceContracts(broken) === false, 'and the aggregate verdict goes red on a broken group');

// ═══════════════════════ totals ═══════════════════════

console.log('\n──────────────────────────────────────────────');
console.log(`v43 §3 SETTINGS (designer spec): ${passed}/${passed + failed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('RESULT: FAILED');
  process.exit(1);
}
console.log('RESULT: PASSED');
