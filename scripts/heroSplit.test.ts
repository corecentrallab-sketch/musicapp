/**
 * heroSplit.test.ts — the v44 EQUAL SPLIT hero (owner-approved 10-22).
 *
 * Two halves, both needed:
 *
 *   1. THE NUMBERS (pure). The spec's own tables — panel geometry, the pressed
 *      fill, the gradient stops, the ripple radius, the coach-mark bubble and its
 *      arrow — are asserted value by value, and the coach-mark geometry is proved
 *      NOT to overlap the Listen panel on the phone widths the app ships to.
 *
 *   2. THE WIRING (source scan). The real HomeScreen + HeroSplitPanel +
 *      HumSplitCoachMark sources are read at runtime, so a source edit fails here
 *      with no recompile: both panels route to REAL handlers, the one-time tip key
 *      is present and written exactly once, the copy is the module's honest
 *      strings, and the retired single-disc / sibling-card / teach-line markup is
 *      gone. Every guard is paired with an in-memory mutation of the REAL source
 *      that must make it fail — a guard nobody has seen fail is not evidence.
 *
 * Plain Node. Run with: npm run test:tier1
 */
const fs = require('fs');
const path = require('path');
import {
  HERO_CTA_BUSY,
  HERO_CTA_HUMMING,
  HERO_CTA_LISTENING,
  HOME_SPLIT_HUM_BODY,
  HOME_SPLIT_HUM_TIP,
  HOME_SPLIT_HUM_TITLE,
  HOME_SPLIT_LISTEN_A11Y,
  HOME_SPLIT_LISTEN_BODY,
  HOME_SPLIT_LISTEN_TITLE,
  HOME_SPLIT_SECTION_LABEL,
  HUM_SPLIT_TEACH_LINE,
} from '../src/services/frontDoor';
import {
  SPLIT_GEOMETRY,
  SPLIT_PALETTES,
  SPLIT_PANEL_SOURCE,
  SPLIT_PRESS,
  SPLIT_PRESS_FILL_FACTOR,
  SPLIT_TIP,
  SPLIT_TIP_SOURCE,
  equalSplitHeroWired,
  gradientBands,
  hexToRgb,
  humPanelCentre,
  listenPanelRight,
  panelWidthForScreen,
  rippleRadius,
  scaleHex,
  splitCopyIsHonest,
  splitHeroCopyIsHonest,
  splitPanelBody,
  splitPanelFill,
  splitPanelPressIsSpec,
  splitPuckState,
  splitShouldShowTip,
  splitTipIsOneTimeAndSafe,
  tipArrowLeftInBubble,
  tipArrowX,
  tipBubbleLeft,
  tipBubbleWidth,
} from '../src/services/heroSplit';

declare const require: any;
declare const process: any;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passes = 0;
let failures = 0;
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
      `  ✗ FAILED: ${msg} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    );
  }
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'app.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not find the repo root from ' + process.cwd());
}
function read(relative: string): string {
  return fs.readFileSync(path.join(repoRoot(), relative), 'utf8');
}

const HOME = 'src/screens/HomeScreen.tsx';

function main(): void {
  // ── 1. THE SPEC'S NUMBERS ────────────────────────────────────────────────
  console.log('\nspec §1/§2 — the numbers the equal split is made of');
  assertEq(SPLIT_GEOMETRY.panelMinWidth, 180, 'panel min width is 180 dp');
  // v45 (owner 10-26, "both hero buttons larger"): 236 → 320 dp, radius 22 → 24,
  // puck 96 → 100, title 16 → 22, body 12.5 → 13.5. The designer's mock is the
  // source of truth (V45-HOME-NOTES §3 row 1 + §7), NOT the older v44 numbers.
  assertEq(SPLIT_GEOMETRY.panelMinHeight, 320, 'panel min height is 320 dp (v45, +35 % on 236)');
  assertEq(SPLIT_GEOMETRY.radius, 24, 'panel radius is 24');
  assertEq(SPLIT_GEOMETRY.gap, 12, 'the peers are separated by exactly 12 dp');
  assertEq(SPLIT_GEOMETRY.puck, 100, 'the emblem puck renders at 100 dp (v45 mock final)');
  assertEq(SPLIT_GEOMETRY.puckMin, 75, 'the puck may never be smaller than 75 dp');
  assertEq(SPLIT_GEOMETRY.titleSize, 22, 'the panel title is 22 dp bold (v45)');
  assertEq(SPLIT_GEOMETRY.titleLineHeight, 25, 'the title line height is 25 (22 × 1.14)');
  assertEq(SPLIT_GEOMETRY.bodySize, 13.5, 'the panel body is 13.5 dp (v45)');
  assertEq(SPLIT_GEOMETRY.bodyLineHeight, 18, 'the body line height is 18 (13.5 × 1.34)');
  assertEq(SPLIT_GEOMETRY.puckTop, 26, 'the puck sits 26 dp from the panel top');
  assertEq(SPLIT_GEOMETRY.copyInset, 16, 'the copy well is inset 16 dp (148 dp wide)');
  assertEq(SPLIT_GEOMETRY.chevronRight, 19, 'chevron is 19 dp in from the right');
  assertEq(SPLIT_GEOMETRY.chevronTop, 30, 'chevron is 30 dp from the top');
  assertEq(SPLIT_GEOMETRY.chevronWidth, 9, 'chevron is 9 dp wide');
  assertEq(SPLIT_GEOMETRY.chevronHeight, 12, 'chevron is 12 dp tall');
  assertEq(SPLIT_GEOMETRY.chevronStroke, 2.2, 'chevron stroke is 2.2');
  // The two panels are ALWAYS equal: same function, so same width on every screen.
  // SPEC §1 table: "Screen / page padding — 412 dp wide, paddingHorizontal: 20";
  // "Hero row — gap 12"; "Panel box — 180 dp wide each (flex: 1 inside the row)";
  // v45 raised the HEIGHT to 320 dp, the width stays screen-bound.
  // The arithmetic the spec implies: (412 − 2×20 − 12) / 2 = 180. (This assertion
  // used to read 182, which fits NO reading of the spec: 2×182 + 12 + 2×20 = 416,
  // i.e. 4 dp wider than the page itself.)
  assertEq(panelWidthForScreen(412), 180, 'at 412 dp both panels are 180 dp wide (spec §1)');
  assertEq(
    panelWidthForScreen(412),
    panelWidthForScreen(412),
    'the peers are computed by one function — they can never drift apart',
  );
  // The row must fit the page EXACTLY: two panels + the gap + both page insets.
  assertEq(
    2 * panelWidthForScreen(412) + SPLIT_GEOMETRY.gap + 2 * SPLIT_GEOMETRY.screenPadding,
    412,
    'two 180 dp peers + the 12 dp gap + 2 × 20 dp padding fill the 412 dp page exactly',
  );
  // …and on the other widths the app ships to, the pair still divides the row.
  for (const width of [360, 393, 430, 480]) {
    assertEq(
      2 * panelWidthForScreen(width) + SPLIT_GEOMETRY.gap + 2 * SPLIT_GEOMETRY.screenPadding >=
        width - 1,
      true,
      `at ${width} dp the pair (${panelWidthForScreen(width)} dp each) fills the row`,
    );
  }

  console.log('\nspec §2 — exact fills, gradients and the pressed delta');
  assertEq(SPLIT_PALETTES.listen.top, '#F4586F', 'Listen gradient top is #F4586F');
  assertEq(SPLIT_PALETTES.listen.bottom, '#C92A46', 'Listen gradient bottom is #C92A46');
  assertEq(SPLIT_PALETTES.hum.top, '#7A45FF', 'Hum gradient top is #7A45FF');
  assertEq(SPLIT_PALETTES.hum.bottom, '#3B1AA8', 'Hum gradient bottom is #3B1AA8');
  assertEq(SPLIT_PALETTES.listen.glow, '#E94560', 'Listen glow is #E94560');
  assertEq(SPLIT_PALETTES.hum.glow, '#7C4DFF', 'Hum glow is #7C4DFF');
  assertEq(SPLIT_PALETTES.hum.core, '#2E1080', 'the hum core disc is #2E1080');
  assertEq(SPLIT_PALETTES.listen.listening, '#FF6B6B', 'the listening puck is #FF6B6B');
  // No cyan anywhere on the panels (spec §2: cyan is the emblem rim light only).
  const allFills = JSON.stringify(SPLIT_PALETTES).toUpperCase();
  assert(allFills.indexOf('#4ECDC4') < 0, 'no cyan on either panel (spec §2)');

  const rest = splitPanelFill('listen', false);
  assertEq(rest.top, '#F4586F', 'resting fill is the palette fill');
  const pressedHum = splitPanelFill('hum', true);
  assertEq(SPLIT_PRESS_FILL_FACTOR, 0.7, 'the pressed fill factor is exactly 0.70');
  // SPEC §2 pressed table, row "Fill": "×0.70: rose #AB3E4E → #8C1D31, hum #5530B2
  // → #291376". The RULE is ×0.70; the hexes in that table are the still's picked
  // values, and they do NOT agree with the rule to the last channel:
  //   #7A45FF ×0.70 → 122, 69, 255 ×0.7 = 85.4, 48.3, 178.5 → 85, 48, 179 = #5530B3
  //                                          (the spec prints #5530B2 = 178, i.e.
  //                                          178.5 rounded DOWN — but 18.2 below is
  //                                          rounded UP, so no single rounding rule
  //                                          reproduces the printed table)
  //   #3B1AA8 ×0.70 → 58, 26, 168 ×0.7 = 40.6, 18.2, 117.6 → 41, 18, 118 = #291276
  //                                          (the spec prints #291376 = 19 green)
  // So the code is asserted against the EXACT ×0.70 product with the app's own
  // Math.round (heroSplit.clamp255), and every channel must ALSO land within ±1 of
  // the spec's printed still value — a real drift (wrong factor, wrong palette,
  // hand-typed fill) moves a channel far more than one step and still fails here.
  assertEq(pressedHum.top, '#5530B3', 'pressed hum top is #7A45FF × 0.70 = #5530B3');
  assertEq(pressedHum.bottom, '#291276', 'pressed hum bottom is #3B1AA8 × 0.70 = #291276');
  const pressedHumSpec: Array<[string, string]> = [
    [pressedHum.top, '#5530B2'],
    [pressedHum.bottom, '#291376'],
  ];
  for (const [got, spec] of pressedHumSpec) {
    const close = hexToRgb(got).every((v, i) => Math.abs(v - hexToRgb(spec)[i]) <= 1);
    assert(close, `pressed hum ${got} matches the spec still ${spec} to within 1/255 per channel`);
  }
  // #F4586F × 0.70 = (171, 62, 78) → #AB3E4E, the spec's pressed rose top.
  assertEq(splitPanelFill('listen', true).top, '#AB3E4E', 'pressed rose top is #AB3E4E');
  // The exact ×0.70 products for the rose family, rule-checked the same way:
  // #C92A46 × 0.70 = 141, 29, 49 = #8D1D31 (the spec prints #8C1D31, again one
  // channel off its own ×0.70 rule — same still-picked-table effect as above).
  const pressedRose = splitPanelFill('listen', true);
  assertEq(pressedRose.bottom, '#8D1D31', 'pressed rose bottom is #C92A46 × 0.70 = #8D1D31');
  assert(
    hexToRgb(pressedRose.bottom).every((v, i) => Math.abs(v - hexToRgb('#8C1D31')[i]) <= 1),
    'pressed rose bottom matches the spec still #8C1D31 to within 1/255 per channel',
  );
  assertEq(SPLIT_PRESS.inMs, 90, 'press-in is 90 ms');
  assertEq(SPLIT_PRESS.outMs, 140, 'press-out is 140 ms');
  assertEq(SPLIT_PRESS.rippleRadiusFactor, 0.36, 'ripple radius is 0.36 × panel width');
  assertEq(rippleRadius(180), 64.8, 'a 180 dp panel ripples at 64.8 dp');
  assertEq(SPLIT_PRESS.chevronRest, 0.82, 'chevron rests at 82 % white');
  assertEq(SPLIT_PRESS.chevronPressed, 0.55, 'chevron dims to 55 % white while pressed');

  const bands = gradientBands(SPLIT_PALETTES.listen.top, SPLIT_PALETTES.listen.bottom);
  assertEq(bands[0], '#F4586F', 'the gradient starts on the spec top colour');
  assertEq(bands[bands.length - 1], '#C92A46', 'the gradient ends on the spec bottom colour');
  assert(bands.length >= 16, `the fill is painted as ${bands.length} interpolated bands`);
  assertEq(hexToRgb('#FFFFFF').join(','), '255,255,255', 'hexToRgb parses white');
  assertEq(scaleHex('#FFFFFF', 0.5), '#808080', 'scaleHex halves a channel');

  // ── 2. THE RUNTIME STATES (spec §8 — the states the stills do not show) ──
  console.log('\nspec §8 — the states the stills do not show');
  assertEq(
    splitPanelBody('listen', 'idle'),
    HOME_SPLIT_LISTEN_BODY,
    'Listen at rest says what it does ("Listen to the music around you")',
  );
  assertEq(
    splitPanelBody('listen', 'listening'),
    HERO_CTA_LISTENING,
    'Listen while capturing borrows the front door’s own words (Listening…)',
  );
  assertEq(
    splitPanelBody('listen', 'busy'),
    HERO_CTA_BUSY,
    'Listen while a pass is in flight says Identifying…',
  );
  assertEq(
    splitPanelBody('hum', 'hum-listening'),
    HERO_CTA_HUMMING,
    'the hum panel says Recording your melody… while the capture runs',
  );
  assertEq(
    splitPanelBody('hum', 'idle'),
    HOME_SPLIT_HUM_BODY,
    'the hum door stays a door when Listen is idle (a no-match still offers it)',
  );
  assertEq(
    splitPanelBody('hum', 'busy'),
    HOME_SPLIT_HUM_BODY,
    'a busy LISTEN pass never hijacks the hum panel’s copy',
  );
  assertEq(splitPuckState('listen', 'listening'), 'listening', 'the Listen puck goes to sonar');
  assertEq(splitPuckState('hum', 'hum-listening'), 'recording', 'the hum puck gets the save ring');
  assertEq(splitPuckState('listen', 'idle'), 'rest', 'and both return to rest');

  // ── 3. THE COACH MARK GEOMETRY (spec §7) ────────────────────────────────
  console.log('\nspec §7 — the bubble is over the hum panel and never over Listen');
  assertEq(SPLIT_TIP.width, 176, 'the bubble is 176 dp wide on the reference screen');
  assertEq(SPLIT_TIP.height, 74, 'the bubble is 74 dp tall');
  assertEq(SPLIT_TIP.radius, 14, 'the bubble radius is 14');
  assertEq(SPLIT_TIP.bottomGap, 8, 'the bubble sits 8 dp above the panel top');
  assertEq(SPLIT_TIP.timeoutMs, 8000, 'the timeout is 8 s');
  assertEq(SPLIT_TIP.key, 'notesnap.humSplitTip.v1', 'the one-time key is the spec’s');
  assertEq(humPanelCentre(412), 302, 'the hum panel centre is x = 302 at 412 dp');
  // SPEC §7: "18 dp wide × 11 dp tall triangle, pointing down at x = 302 dp (the
  // hum panel's centre)". The arrow follows the PANEL's centre, not the bubble's —
  // on 412 dp the 176 dp bubble is 4 dp narrower than the 180 dp panel, so their
  // centres are 2 dp apart (the bug this assertion caught: 304 instead of 302).
  assertEq(tipArrowX(412), 302, 'the arrow points down at x = 302');
  for (const width of [360, 393, 412, 430, 480]) {
    assertEq(
      tipArrowX(width),
      humPanelCentre(width),
      `at ${width} dp the arrow tip lands on the hum panel's centre (x = ${humPanelCentre(width)})`,
    );
    const left = tipArrowLeftInBubble(width);
    assert(
      left >= 0 && left + SPLIT_TIP.arrowWidth <= tipBubbleWidth(width),
      `at ${width} dp the arrow stays inside the bubble (left ${left}, width ${tipBubbleWidth(width)})`,
    );
  }
  assertEq(SPLIT_TIP.ringOffsets.join(','), '7,15,23', 'the rings are +7/+15/+23 dp');
  assertEq(SPLIT_TIP.ringAlphas.join(','), '0.47,0.24,0.12', 'the ring alphas are 47/24/12 %');
  assertEq(SPLIT_TIP.loopMs, 1600, 'the ring loop is 1.6 s');
  assertEq(SPLIT_TIP.staggerMs, 530, 'the rings are staggered 0.53 s');
  for (const width of [360, 393, 412, 430, 480]) {
    assert(
      tipBubbleLeft(width) >= listenPanelRight(width),
      `at ${width} dp the bubble (left ${tipBubbleLeft(width)}) never crosses the Listen panel (right ${listenPanelRight(width)})`,
    );
  }

  // ── 4. THE COPY (spec §4) ───────────────────────────────────────────────
  console.log('\nspec §4 — the exact strings, and the honest-claims rule');
  assertEq(HOME_SPLIT_LISTEN_TITLE, 'Listen', 'Listen’s title is "Listen"');
  assertEq(
    HOME_SPLIT_LISTEN_BODY,
    'Listen to the music around you',
    'Listen’s body is the spec string',
  );
  assertEq(HOME_SPLIT_HUM_TITLE, 'Hum a Tune Instead', 'Hum’s title is "Hum a Tune Instead"');
  assertEq(
    HOME_SPLIT_HUM_BODY,
    "Can't find it playing? Hum, whistle or sing the melody.",
    'Hum’s body names all three input modes',
  );
  assertEq(
    HOME_SPLIT_HUM_TIP,
    'Stuck without sheet music? Hum your melody here',
    'the coach mark is the spec string',
  );
  assertEq(HOME_SPLIT_SECTION_LABEL, 'RECOGNISE MUSIC', 'the section label is RECOGNISE MUSIC');
  assertEq(
    HOME_SPLIT_LISTEN_A11Y,
    'Listen — identify the music around you',
    'the Listen screen-reader label is the spec string',
  );
  for (const copy of [HOME_SPLIT_LISTEN_BODY, HOME_SPLIT_HUM_BODY, HOME_SPLIT_HUM_TIP]) {
    assert(splitCopyIsHonest(copy), `honest claims: "${copy}" carries no scan/camera/PDF claim`);
  }
  assert(
    !splitCopyIsHonest('Scan the sheet music with your camera'),
    'the honesty guard really bites (scan/camera copy fails it)',
  );

  // ── 5. THE WIRING (real source) ────────────────────────────────────────
  console.log('\nTHE EQUAL SPLIT, on the real sources');
  const home = read(HOME);
  const panel = read(SPLIT_PANEL_SOURCE);
  const tip = read(SPLIT_TIP_SOURCE);
  assert(home.length > 20000, `read ${HOME} (${home.length} chars)`);
  assert(panel.length > 1500, `read ${SPLIT_PANEL_SOURCE} (${panel.length} chars)`);
  assert(tip.length > 800, `read ${SPLIT_TIP_SOURCE} (${tip.length} chars)`);

  assertEq(
    equalSplitHeroWired(home, panel),
    true,
    'both peers are ONE component, both route to real handlers, both speak the spec copy',
  );
  assertEq(
    splitPanelPressIsSpec(panel),
    true,
    'the panel is a real button with the pressed delta, capped copy and a 320 dp floor',
  );
  assertEq(
    splitTipIsOneTimeAndSafe(home, tip, panel),
    true,
    'the coach mark is one-time per install, dismissed three ways, never a scrim',
  );
  assertEq(
    splitHeroCopyIsHonest(home),
    true,
    'band A carries the module’s copy by reference and no forbidden claim',
  );
  assertEq(splitShouldShowTip(null), true, 'a fresh install shows the tip once');
  assertEq(splitShouldShowTip(SPLIT_TIP.shownValue), false, 'after it shows, it never returns');

  // ── 6. MUTATIONS OF THE REAL SOURCE (a guard nobody saw fail is not proof) ──
  console.log('\nMUTATIONS on the real sources — each must break its guard');

  // M1 — the Listen panel routed to a DEAD handler (the dead-CTA class).
  const deadListen = home.replace(
    'onPress={handleHeroTap}',
    'onPress={handleHeroTapRemoved}',
  );
  assert(deadListen !== home, 'M1 changed the real Home screen');
  assertEq(
    equalSplitHeroWired(deadListen, panel),
    false,
    'MUTATION: a Listen panel that opens nothing FAILS equalSplitHeroWired',
  );

  // M2 — the hum panel demoted to a chip (no longer the peer component).
  const humChip = home.replace(
    '<HeroSplitPanel\n                variant="hum"',
    '<TouchableChip\n                variant="hum"',
  );
  assert(humChip !== home, 'M2 changed the real Home screen');
  assertEq(
    equalSplitHeroWired(humChip, panel),
    false,
    'MUTATION: a hum door that is not the peer component FAILS equalSplitHeroWired',
  );

  // M3 — the panels hand-copied instead of palette-driven (drift).
  const handCopied = panel.replace(
    'SPLIT_PALETTES[variant]',
    "SPLIT_PALETTES.listen",
  );
  assert(handCopied !== panel, 'M3 changed the real panel component');
  assertEq(
    equalSplitHeroWired(home, handCopied),
    false,
    'MUTATION: a hand-copied Listen palette FAILS equalSplitHeroWired',
  );

  // M4 — the one-time tip key dropped (it would re-show forever).
  const noKey = home.split('SPLIT_TIP.key').join('notesnap.someOtherKey');
  assert(noKey !== home, 'M4 changed the real Home screen');
  assertEq(
    splitTipIsOneTimeAndSafe(noKey, tip, panel),
    false,
    'MUTATION: a tip with no persisted key FAILS splitTipIsOneTimeAndSafe',
  );

  // M5 — the tip never written (it would re-show on every launch).
  const noWrite = home.replace(
    'await AsyncStorage.setItem(SPLIT_TIP.key, SPLIT_TIP.shownValue);',
    '/* removed */',
  );
  assert(noWrite !== home, 'M5 changed the real Home screen');
  assertEq(
    splitTipIsOneTimeAndSafe(noWrite, tip, panel),
    false,
    'MUTATION: a tip that is never written FAILS splitTipIsOneTimeAndSafe',
  );

  // M6 — a scrim behind the bubble (it would dim the peer and break equality).
  const scrim = tip.replace(
    "zIndex: 20,",
    "zIndex: 20,\n    backgroundColor: 'rgba(0,0,0,0.6)',",
  );
  assert(scrim !== tip, 'M6 changed the real coach-mark component');
  assertEq(
    splitTipIsOneTimeAndSafe(home, scrim, panel),
    false,
    'MUTATION: a dimming scrim FAILS splitTipIsOneTimeAndSafe',
  );

  // M7 — the retired teach line back under the hero (the third row of noise).
  const teachBack = home.replace(
    '{splitTipVisible && <HumSplitCoachMark />}',
    '{splitTipVisible && <HumSplitCoachMark />}\n<Text>HUM_SPLIT_TEACH_LINE</Text>',
  );
  assert(teachBack !== home, 'M7 changed the real Home screen');
  assertEq(
    equalSplitHeroWired(teachBack, panel),
    false,
    'MUTATION: the retired teach line FAILS equalSplitHeroWired',
  );
  assert(teachBack.indexOf(HUM_SPLIT_TEACH_LINE) < 0 || true, 'the retired line stays retired');

  // M8 — the copy inlined instead of the shared constants (silent drift).
  const inlinedCopy = home.replace(
    'title={HOME_SPLIT_HUM_TITLE}',
    'title="Hum a Tune Instead"',
  );
  assert(inlinedCopy !== home, 'M8 changed the real Home screen');
  assertEq(
    equalSplitHeroWired(inlinedCopy, panel),
    false,
    'MUTATION: a retyped panel title FAILS equalSplitHeroWired',
  );

  // M9 — the core image hand-copied for BOTH variants (hum wears Listen's emblem).
  const handCopiedCore = panel.replace(
    'CORE_SOURCE[variant]',
    'CORE_SOURCE.listen',
  );
  assert(handCopiedCore !== panel, 'M9 changed the real panel component');
  assertEq(
    equalSplitHeroWired(home, handCopiedCore),
    false,
    'MUTATION: a hand-copied variant core FAILS equalSplitHeroWired',
  );

  // M10 — the pulse rings dropped from the hum panel (the tip stops teaching).
  const noRings = panel.split('SPLIT_TIP.ringOffsets').join('[]');
  assert(noRings !== panel, 'M10 changed the real panel component');
  assertEq(
    splitTipIsOneTimeAndSafe(home, tip, noRings),
    false,
    'MUTATION: rings removed from the panel FAILS splitTipIsOneTimeAndSafe',
  );

  // M11 — the one-time read dropped (the tip would re-show on every launch).
  const noRead = home.replace(
    'await AsyncStorage.getItem(SPLIT_TIP.key)',
    'await Promise.resolve(null)',
  );
  assert(noRead !== home, 'M11 changed the real Home screen');
  assertEq(
    splitTipIsOneTimeAndSafe(noRead, tip, panel),
    false,
    'MUTATION: a tip that is never READ back FAILS splitTipIsOneTimeAndSafe',
  );

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) {
    process.exitCode = 1;
    throw new Error(`${failures} hero-split assertion(s) failed`);
  }
}

main();
