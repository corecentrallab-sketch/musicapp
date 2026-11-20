/**
 * vc64ProbeSourceContract.ts — D34's GUARD, AS A PURE PREDICATE.
 *
 * The defect it exists for: the review page handed the decoder probe
 * `ref?.uri ?? audioUriRef.current` — the CAMERA VIDEO whenever the take had one —
 * so the probe read a truncated MP4 prefix and reported "the decode did not finish"
 * for every real take. A guard that only asserted "the audio URI is somewhere in
 * the screen" would pass on that code, because the audio URI WAS there, as the
 * fallback. This one fails on the preference itself.
 *
 * It reads REAL SOURCE as a string and answers one question: does the probe read
 * the take's audio first? Two halves, because either one alone can be green and
 * blind:
 *
 *   • THE SCREEN hands the card BOTH files (audio first by name), never one
 *     pre-decided URI — so there is nothing on the screen to prefer the video with;
 *   • THE CARD takes its read target from the one pure selector
 *     (services/takeProbeSource.ts) and PRINTS which file it read.
 *
 * PURE: no react, no react-native, no fs. Asserted by scripts/vc64ProbeSource.test.ts,
 * which also runs it over MUTATED REAL BYTES and requires it to fail there.
 */

/** The source with its comments removed — every guard below reads CODE, not prose. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/** The `<TakeDecoderProbeCard … />` mount tag on the review page, or ''. */
function probeMountTag(screen: string): string {
  const match = screen.match(/<TakeDecoderProbeCard[\s\S]*?\/>/);
  return match ? match[0] : '';
}

export interface ProbeSourceWiring {
  /** src/screens/PracticeVideoScreen.tsx */
  screen: string;
  /** src/components/TakeDecoderProbeCard.tsx */
  card: string;
}

export function theProbeReadsTheTakeAudio(input: ProbeSourceWiring): boolean {
  const screen = stripComments(typeof input?.screen === 'string' ? input.screen : '');
  const card = stripComments(typeof input?.card === 'string' ? input.card : '');
  if (screen.length === 0 || card.length === 0) return false;

  // ── THE SCREEN: BOTH FILES, NEVER A PRE-DECIDED ONE ─────────────────────────
  const tag = probeMountTag(screen);
  if (tag.length === 0) return false;
  // The audio file is what the probe is for, so the page passes it explicitly…
  if (!/\baudioUri=\{\s*audioUriRef\.current\s*\}/.test(tag)) return false;
  // …and the video is passed as the FALLBACK, beside it.
  if (!/\bvideoUri=\{/.test(tag)) return false;
  // A single `uri` prop is the old shape: one expression that can prefer the video.
  if (/\buri=\{/.test(tag)) return false;
  // And the exact defect expression cannot come back anywhere on the screen.
  if (/ref\s*\?*\.\s*uri\s*\?\?\s*audioUriRef/.test(screen)) return false;

  // ── THE CARD: THE ONE SELECTOR DECIDES, AND THE CARD SAYS WHICH FILE ────────
  if (!/from '(?:\.\.?\/)+services\/takeProbeSource'/.test(card)) return false;
  // Audio first, video second — the argument ORDER is the preference.
  if (!/pickTakeProbeSource\(\s*\{\s*audioUri\s*,\s*videoUri\s*,?\s*\}\s*\)/.test(card)) {
    return false;
  }
  // The card prints which file it read.
  if (!/takeProbeSourceLine\(/.test(card)) return false;
  // The card must not take a pre-decided `uri` prop back (the vc63 signature).
  if (/uri\??:\s*string\s*\|\s*null\s*\|\s*undefined/.test(card)) return false;
  return true;
}
