/**
 * billingModeGuard.ts — the source-scan guards that make "billing is OFF" a
 * property of the BUILD rather than of a render path somebody forgot.
 *
 * THE BUG CLASS THIS EXISTS FOR
 * -----------------------------
 * Hiding a button is not the same as removing a purchase path. A screen can
 * stop rendering the plan cards and still leave `createCheckoutSession` one
 * `useEffect` away from running; a copy tweak can reintroduce "Upgrade to Pro"
 * inside the quota-exhausted modal; a new screen can re-add the Stripe endpoint
 * literal. Every one of those passes a UI test and still ships a store-policy
 * problem. So the checks below are TEXT checks over the real source, run inside
 * `npm run test:tier1`, and they FAIL THE BUILD rather than warn:
 *
 *   • `checkoutCallIsBillingGated`      — the checkout function refuses before
 *                                        the network call, not after.
 *   • `checkoutEndpointIsOnlyInApi`     — no second module may hold the
 *                                        Stripe endpoint literal.
 *   • `settingsPurchaseSurfaceIsGated`  — the Pro row and the plans block are
 *                                        behind the ONE constant.
 *   • `limitStateOffersNoPurchase`      — the quota-exhausted modal can only
 *                                        offer an upgrade inside the gate.
 *   • `freeLimitCopyIsPurchaseFree`     — the limit sentence that ships with
 *                                        billing off names no price and no
 *                                        product.
 *
 * PURE: strings in, booleans out (no react-native, no fs) so the tier1 gate can
 * compile and run them with `node_modules` absent. `scripts/billingMode.test.ts`
 * feeds them both the real repo files and hand-written counter-examples, so a
 * guard that stops biting is caught by the suite rather than by a reviewer.
 *
 * THE INVARIANT BEHIND ALL OF THEM: with `BILLING_ENABLED === false` the source
 * must make the purchase path UNREACHABLE; with it `true` the purchase path must
 * still be there. The two directions are checked in one place so flipping the
 * constant cannot silently leave half the app behind.
 */
import { BILLING_ENABLED } from './billingMode';

/** The Stripe Checkout endpoint. Exactly one module may name it (see guard 2). */
export const CHECKOUT_ENDPOINT = '/api/create-checkout-session';

/** Where that module is, relative to the repo root. */
export const CHECKOUT_API_PATH = 'src/services/api.ts';

/**
 * …and this module, which is where the literal is PINNED. It is pure (no
 * react-native, no fetch) and the tier1 gate compiles it with `node_modules`
 * absent, so holding the string here is a name for the endpoint, not a way to
 * call it. Every OTHER file in `src/` must be free of it.
 */
export const CHECKOUT_GUARD_PATH = 'src/services/billingModeGuard.ts';

/**
 * Strip comments so a needle inside a comment cannot satisfy (or break) a guard.
 * `//` is only treated as a comment when it is not part of a `scheme://` URL —
 * this file's own endpoint constants would otherwise eat the rest of the line.
 */
export function maskComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return withoutBlocks
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      if (at < 0) return line;
      if (at > 0 && line.charAt(at - 1) === ':') return line;
      return line.slice(0, at);
    })
    .join('\n');
}

/**
 * GUARD 1 — the checkout call refuses BEFORE it talks to the server.
 *
 * Not "the caller checks first": the function itself. A guard on the caller is
 * one new call site away from being bypassed; a `throw` inside the only function
 * that knows the endpoint is not.
 */
export function checkoutCallIsBillingGated(apiSource: string): boolean {
  const text = maskComments(apiSource);
  const start = text.indexOf('export async function createCheckoutSession');
  if (start < 0) return false;
  const endpointAt = text.indexOf(CHECKOUT_ENDPOINT, start);
  if (endpointAt < 0) return false; // billing-on behaviour must still exist
  const head = text.slice(start, endpointAt);
  // The gate is the FIRST thing the body does, and it throws.
  const gate = /\)\s*:\s*Promise<[^>]*>\s*\{\s*if\s*\(\s*!\s*BILLING_ENABLED\s*\)\s*\{\s*throw\b/.exec(
    head,
  );
  if (gate === null) return false;
  // …and nothing before the gate can start a request.
  const beforeGate = head.slice(0, gate.index);
  if (/fetch\s*\(/.test(beforeGate)) return false;
  return beforeGate.indexOf(CHECKOUT_ENDPOINT) < 0;
}

/**
 * GUARD 2 — the endpoint literal lives in ONE file.
 *
 * A second module that builds the URL itself (a retry helper, a "deep link"
 * handler) would bypass guard 1 entirely, because guard 1 only knows about the
 * function in api.ts.
 */
export function checkoutEndpointIsOnlyInApi(
  entries: ReadonlyArray<{ path: string; source: string }>,
  apiPath: string = CHECKOUT_API_PATH,
): boolean {
  let apiHasIt = false;
  for (const entry of entries) {
    if (entry.path === CHECKOUT_GUARD_PATH) continue; // pins the literal, cannot call it
    const holds = maskComments(entry.source).indexOf(CHECKOUT_ENDPOINT) >= 0;
    if (entry.path === apiPath) {
      if (!holds) return false; // the one module that should have it, lost it
      apiHasIt = true;
      continue;
    }
    if (holds) return false; // somebody else named the endpoint
  }
  return apiHasIt;
}

/**
 * GUARD 3 — the Settings purchase surface is behind the ONE constant.
 *
 * Three things must hold at once, and they are the three ways this surface has
 * been broken before:
 *   a) the screen reads the constant (no local boolean, no prop);
 *   b) the "NoteSnap Pro / View plans" row is rendered only inside the gate —
 *      so it is ABSENT with billing off, not greyed out and not a placeholder;
 *   c) the plans block is opened through a value that can only be true when
 *      billing is on, so "Your Plan" and "Upgrade" cannot appear even if
 *      something else sets the state.
 */
export function settingsPurchaseSurfaceIsGated(settingsSource: string): boolean {
  const text = maskComments(settingsSource);
  // a) the switch is imported, not copied
  if (text.indexOf("from '../services/billingMode'") < 0) return false;
  if (/const\s+BILLING_ENABLED\s*=/.test(text)) return false; // no local copy
  // b) the Pro row opens only inside the gate
  const gateAt = text.indexOf('{BILLING_ENABLED && (');
  if (gateAt < 0) return false;
  const rowAt = text.indexOf('styles.proRow');
  if (rowAt < 0) return false;
  if (gateAt > rowAt) return false;
  // c) the plans block is gated by derivation, so no setter can force it open
  if (!/const\s+plansOpen\s*=\s*BILLING_ENABLED\s*&&\s*plansOpenRequested\b/.test(text)) {
    return false;
  }
  if (!/\{plansOpen && \(/.test(text)) return false;
  // …and the checkout call still has exactly ONE call site (the plan card), so
  // the surface cannot come back through a second door.
  const calls = text.split('createCheckoutSession(').length - 1;
  if (calls !== 1) return false;
  return text.indexOf('onPress={() => handleUpgrade(plan.id)}') >= 0;
}

/**
 * GUARD 4 — the quota-exhausted modal can only OFFER an upgrade inside the gate.
 *
 * The limit state is the one place the app talks about the free allowance, so it
 * is the one place a "buy" affordance is most likely to survive a clean-up. With
 * billing off the modal must still say what happened and when the allowance
 * returns (`{phase.message}`), and must not carry the Pro button.
 */
export function limitStateOffersNoPurchase(viewSource: string): boolean {
  const text = maskComments(viewSource);
  const start = text.indexOf("phase.type === 'limit'");
  const end = text.indexOf("phase.type === 'error'", start + 1);
  if (start < 0 || end < 0) return false;
  const branch = text.slice(start, end);
  // the honest line is always shown …
  if (branch.indexOf('{phase.message}') < 0) return false;
  // … and the purchase affordance is only reachable through a gate.
  const upgradeCopyAt = branch.indexOf('Upgrade to Pro');
  const proAt = branch.indexOf('View Pro Options');
  if (upgradeCopyAt < 0 || proAt < 0) return false; // billing-on behaviour intact
  const gates = branch.match(/\{BILLING_ENABLED\s*(?:&&|\?)\s*\(/g);
  if (gates === null) return false;
  // EXACTLY TWO: one around the selling sentence, one around the buttons. A
  // third gate, or a missing one, means somebody added an ungated path.
  if (gates.length !== 2) return false;
  const opener = /\{BILLING_ENABLED\s*(?:&&|\?)\s*\(/.exec(branch);
  if (opener === null) return false;
  return opener.index < upgradeCopyAt && opener.index < proAt;
}

/**
 * GUARD 5 — the free-limit sentence itself.
 *
 * The 429 body comes from the server and has offered "Upgrade to Pro for
 * unlimited" since the Stripe build. With billing off we must not pass that
 * through, so the client owns BOTH sentences and picks one from the constant.
 * The no-billing sentence is checked for the absence of every selling word and
 * for the one fact the user needs: when the allowance comes back.
 */
export const FREE_LIMIT_MESSAGE_WITH_BILLING = 'FREE_LIMIT_MESSAGE_WITH_BILLING';
export const FREE_LIMIT_MESSAGE_NO_BILLING = 'FREE_LIMIT_MESSAGE_NO_BILLING';

const SELLING_WORDS = /upgrade|pro\b|buy|purchase|subscribe|subscription|\$\s?\d|price/i;

export function freeLimitCopyIsPurchaseFree(apiSource: string): boolean {
  const text = maskComments(apiSource);
  // Both sentences exist and the constant chooses between them …
  const choice = new RegExp(
    `${FREE_LIMIT_MESSAGE_WITH_BILLING}\\s*:\\s*${FREE_LIMIT_MESSAGE_NO_BILLING}`,
  );
  if (!choice.test(text)) return false;
  const withBilling = /FREE_LIMIT_MESSAGE_WITH_BILLING\s*=\s*"([^"]*)"/.exec(text);
  const noBilling = /FREE_LIMIT_MESSAGE_NO_BILLING\s*=\s*"([^"]*)"/.exec(text);
  if (withBilling === null || noBilling === null) return false;
  // … the billing-on sentence still names the upgrade (unchanged behaviour) …
  if (withBilling[1].toLowerCase().indexOf('upgrade') < 0) return false;
  // … and the billing-off one sells nothing and says when it resets.
  if (SELLING_WORDS.test(noBilling[1])) return false;
  return /resets? next month/i.test(noBilling[1]);
}

/**
 * The whole contract, in one call — what the suite asserts against the real
 * repo files, and what the mutation probes prove is load-bearing.
 */
export function billingModeContractHolds(sources: {
  api: string;
  settings: string;
  resultView: string;
  otherSources: ReadonlyArray<{ path: string; source: string }>;
}): boolean {
  if (!checkoutCallIsBillingGated(sources.api)) return false;
  if (!checkoutEndpointIsOnlyInApi(sources.otherSources)) return false;
  if (!settingsPurchaseSurfaceIsGated(sources.settings)) return false;
  if (!limitStateOffersNoPurchase(sources.resultView)) return false;
  return freeLimitCopyIsPurchaseFree(sources.api);
}

/**
 * The switch itself must be a plain, greppable, build-time boolean — not an
 * expression, not a feature flag, not an environment read. A store reviewer
 * inspects the binary, so the decision has to be visible in the source that
 * produced it.
 */
export function billingSwitchIsABuildTimeConstant(modeSource: string): boolean {
  const text = maskComments(modeSource);
  return /export const BILLING_ENABLED:\s*boolean\s*=\s*(?:true|false)\s*;/.test(text);
}

/** What the build currently ships. Read by the suite's reporting line only. */
export function billingIsOff(): boolean {
  return BILLING_ENABLED === false;
}
