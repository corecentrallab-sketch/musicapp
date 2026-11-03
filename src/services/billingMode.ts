/**
 * billingMode.ts — THE ONE SWITCH that decides whether this build sells
 * anything inside the app.
 *
 * WHY THIS EXISTS (2026-11-04, closed-test build)
 * ----------------------------------------------
 * NoteSnap has been selling the Pro tiers through Stripe Checkout inside the
 * app (`/api/create-checkout-session` → a hosted Stripe page in the in-app
 * browser). That is a digital good sold from inside an Android app, so Google
 * Play's Payments policy requires Play Billing for it. We do not have Play
 * Billing yet — it needs Play Console products, a service account and a real
 * purchase-verification endpoint, none of which exist. Submitting a build that
 * sells Pro through Stripe would be rejected, or pulled after review.
 *
 * So the closed-test build ships with NO purchase surface at all: no plan
 * cards, no tier names, no prices, no upgrade CTA, and no reachable checkout
 * path. That is also the cleanest possible policy position — there is nothing
 * for a reviewer to find, because there is nothing for sale.
 *
 * WHAT TURNS IT BACK ON
 * ---------------------
 * Flip this to `true` in the same change that lands a compliant purchase
 * channel (Play Billing for the Android release, or Stripe again for a build
 * that is not distributed through Play). Nothing else needs editing: every
 * purchase-related surface in the app reads THIS constant, so the plan cards,
 * the upgrade row, the checkout call and the upgrade prompt all come back
 * together — and `src/services/billingModeGuard.ts` (tier1-gated) starts
 * requiring them again instead of forbidding them.
 *
 * This is deliberately a build-time constant, not a remote flag and not a
 * user preference: a store reviewer inspects what the binary can do, so the
 * decision has to be made when the binary is built.
 */

/** The switch. `false` = this build has no purchase surface and no checkout. */
export const BILLING_ENABLED: boolean = false;

/**
 * What a caller gets if it reaches a purchase path while the mode is off. It is
 * never rendered — nothing that could show it is mounted — but a thrown error
 * beats a silent `undefined` reaching a browser open.
 */
export const BILLING_DISABLED_MESSAGE =
  'Purchases are not available in this build of NoteSnap.';
