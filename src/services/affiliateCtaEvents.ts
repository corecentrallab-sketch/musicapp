/**
 * affiliateCtaEvents.ts — THE TWO EVENTS THAT MAKE AFFILIATE CTR MEASURABLE.
 *
 * WHY THIS EXISTS. Sheet Music Direct (affiliate ID 67650) is the PRIMARY
 * retailer and the plan's Tier-2 KPI is affiliate CTR >8%, but until now no
 * surface recorded that an affiliate CTA was SHOWN or TAPPED, so the KPI was not
 * computable at all. `affiliate_cta_viewed` and `affiliate_cta_clicked` fix
 * that: the denominator (shown) and the numerator (tapped) now come from the
 * same place, on the same surfaces.
 *
 * WHAT IT SENDS: ONE prop, `surface` — a fixed id from AFFILIATE_CTA_SURFACES
 * that names WHICH surface showed or received the tap. No piece title, no
 * composer, no URL, no retailer token, no user id: the event rides the existing
 * anonymous envelope in `analytics.ts` (a random install id plus the build's own
 * version), exactly like every other event, and it carries nothing else. A
 * surface id is one of five literals in this file, so it cannot become free text
 * by accident.
 *
 * ONE FUNNEL, NOT SIXTEEN CALL SITES OF `track('...')`. Every surface calls
 * `trackAffiliateCta(surface, phase)`. That keeps the two event NAMES and the
 * `surface` key in this one file, so a rename is one edit, and the tier1 guards
 * can check each surface's own literal (`trackAffiliateCta('find_piece',
 * 'clicked')`) in the file that renders it.
 *
 * NEVER IN THE USER'S WAY. `track` is fire-and-forget and never throws, and this
 * module adds nothing to it: no await, no prompt, no queue of its own. A failed
 * send is silent, exactly as the pipeline already behaves.
 *
 * PURE ON PURPOSE: no react, no react-native, no expo, no fs — so it compiles and
 * runs under the tier1 gate with `node_modules` absent.
 */
import { track, type AnalyticsProps } from './analytics';

/** Shown on screen — the denominator of the CTR. */
export const AFFILIATE_CTA_VIEWED_EVENT = 'affiliate_cta_viewed';
/** Tapped — the numerator of the CTR. */
export const AFFILIATE_CTA_CLICKED_EVENT = 'affiliate_cta_clicked';

/**
 * WHICH SURFACE. Five literals, one per place a Sheet Music Direct CTA is put in
 * front of the user:
 *
 *   recognition_result  the SMD "Get the Official Sheet Music" button on the
 *                       recognition result card (RecognitionResultView).
 *   search_external     the SMD card in SearchExternalSection, on a plain search
 *                       mount (the library's search door).
 *   find_piece          FindPieceScreen's OWN SMD CTA in the zero-match state —
 *                       "Search the licensed edition for “…”".
 *   home_front_door     the same SearchExternalSection card when the search
 *                       screen was opened from Home's "Find a song" door.
 *   cover_scan          the same card when the scan flow (a photographed cover)
 *                       opened the search — the cover-scan money path.
 *
 * `search_external`, `home_front_door` and `cover_scan` are the SAME component
 * with different entry points; the entry is what the metric needs, because the
 * question "which door leads to a retailer tap" cannot be answered by a single
 * label for all three.
 */
export type AffiliateCtaSurface =
  | 'recognition_result'
  | 'search_external'
  | 'find_piece'
  | 'home_front_door'
  | 'cover_scan';

/** The enumerated surfaces — the only values an event may carry. */
export const AFFILIATE_CTA_SURFACES: readonly AffiliateCtaSurface[] = [
  'recognition_result',
  'search_external',
  'find_piece',
  'home_front_door',
  'cover_scan',
];

/** The two moments: shown, and tapped. */
export type AffiliateCtaPhase = 'viewed' | 'clicked';

/** The ONE prop key these events carry. */
export const AFFILIATE_CTA_PROP_KEY = 'surface';

export function isAffiliateCtaSurface(value: unknown): value is AffiliateCtaSurface {
  return (
    typeof value === 'string' && (AFFILIATE_CTA_SURFACES as readonly string[]).includes(value)
  );
}

/**
 * The props for one affiliate event: the surface, and nothing else. A value
 * outside the enumeration yields an empty object rather than a bad string —
 * `track` still drops it on the wire vocabulary, but not sending a made-up
 * surface is the honest behaviour.
 */
export function affiliateCtaProps(surface: unknown): AnalyticsProps {
  if (!isAffiliateCtaSurface(surface)) return {};
  return { [AFFILIATE_CTA_PROP_KEY]: surface };
}

/** The event name for a phase. Anything that is not `clicked` reads as a view. */
export function affiliateCtaEventName(phase: AffiliateCtaPhase): string {
  return phase === 'clicked' ? AFFILIATE_CTA_CLICKED_EVENT : AFFILIATE_CTA_VIEWED_EVENT;
}

/**
 * THE CALL SITE API. Returns nothing, awaits nothing, throws never: a screen
 * shows a CTA or handles a tap and carries on.
 */
export function trackAffiliateCta(surface: AffiliateCtaSurface, phase: AffiliateCtaPhase): void {
  try {
    if (!isAffiliateCtaSurface(surface)) return;
    const name =
      phase === 'clicked' ? AFFILIATE_CTA_CLICKED_EVENT : AFFILIATE_CTA_VIEWED_EVENT;
    track(name as 'affiliate_cta_viewed' | 'affiliate_cta_clicked', affiliateCtaProps(surface));
  } catch {
    // Telemetry never breaks a money path — or any other path.
  }
}
