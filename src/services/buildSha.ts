/**
 * buildSha.ts — THE COMMIT THIS BUILD WAS MADE FROM (v43 item B1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  PLACEHOLDER — THIS IS NOT A REAL COMMIT. IT MUST BE REWRITTEN BY THE
 *     RELEASE SLICE, BEFORE THE EAS BUILD, WITH THE COMMIT BEING BUILT:
 *
 *         git rev-parse --short=7 HEAD   →   export const BUILD_SHA = '<that>';
 *
 *     Seven zeros are deliberate: a stamp that reads `· 0000000` on a device
 *     says, unmissably, "this build was never stamped" — it can never be
 *     mistaken for a real commit the way a plausible-looking hash could.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY IT EXISTS. The owner's repeated "did I test the new build?" problem (v43
 * diagnosis, item B) has one root cause: nothing on screen identifies the build.
 * The version alone cannot answer it — the same version can be uploaded twice —
 * so the stamp carries the commit too.
 *
 * PURE DATA: no imports, no logic. Compiled by tsconfig.tier1.json.
 */

/** The commit the release slice stamps in. PLACEHOLDER — see the banner above. */
export const BUILD_SHA = '0000000';

/** True while the placeholder is still in place (the release slice must see false). */
export const BUILD_SHA_IS_PLACEHOLDER = BUILD_SHA === '0000000';
