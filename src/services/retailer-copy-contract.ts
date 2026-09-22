/**
 * Retailer-copy contract — "name only the retailers we actually link to".
 *
 * LINK AUDIT finding 2026-09-22 (owner request, pre-launch): product copy went
 * stale after the owner's retailer decisions and named a retailer the product
 * does not link to at all. The homepage "How it works" step said
 * "licensed retailers like Musicnotes and Sheet Music Plus" while:
 *   * Sheet Music Plus was DROPPED as primary on 2026-08-24 (its flow loops the
 *     user on sign-in) and its entry was retired from `affiliates.ts`; and
 *   * every real purchase link the product emits is Sheet Music Direct
 *     (affiliate ID 67650) — 525/525 piece pages plus the modern-song route.
 * The privacy policy repeated the same two names.
 *
 * A stale retailer name is not a broken link, but it is a false claim about
 * where the user's money path goes, and it survives every URL test in the repo
 * because it is just prose. This module scans the USER-FACING copy (routes +
 * components) for names we must not advertise, and pins the primary retailer
 * name that the purchase CTAs actually resolve to.
 *
 * Internal modules (`services/`) are deliberately out of scope: `affiliates.ts`
 * documents the retirement decision in a comment, which is history worth
 * keeping, not copy.
 */
import { SMD_RETAILER_NAME } from "./piece-affiliate";
import type { ScannedSource } from "./affiliate-url-contract";

/** Where product copy lives — the only place this contract polices. */
export const USER_FACING_DIRS = ["routes", "components"] as const;

/**
 * Retailer names that must never appear in user-facing copy.
 * `Sheet Music Plus` was dropped as primary (owner 2026-08-24) and is no longer
 * linked from anywhere in the product.
 */
export const FORBIDDEN_COPY_PATTERNS: string[] = [
  "Sheet Music Plus",
  "sheetmusicplus.com",
];

/** The retailer the purchase CTAs actually resolve to (owner-approved primary). */
export const PRIMARY_RETAILER_LABEL = SMD_RETAILER_NAME;

export function isUserFacingCopyPath(path: string): boolean {
  const normalised = path.replace(/\\/g, "/").replace(/^src\//, "");
  return USER_FACING_DIRS.some(
    (dir) => normalised.startsWith(dir + "/") || normalised.startsWith("/" + dir + "/"),
  );
}

export interface CopyOffender {
  path: string;
  line: number;
  pattern: string;
  text: string;
}

/**
 * Offenders = a forbidden retailer name inside a user-facing file.
 * `allowlist` takes repo-relative paths (e.g. the test file itself).
 */
export function scanCopyForRetiredRetailers(
  sources: ScannedSource[],
  allowlist: string[] = [],
): CopyOffender[] {
  const offenders: CopyOffender[] = [];
  for (const file of sources) {
    if (!isUserFacingCopyPath(file.path)) continue;
    if (allowlist.includes(file.path.replace(/^src\//, ""))) continue;
    const lines = file.content.split("\n");
    lines.forEach((text, index) => {
      for (const pattern of FORBIDDEN_COPY_PATTERNS) {
        if (text.toLowerCase().includes(pattern.toLowerCase())) {
          offenders.push({
            path: file.path,
            line: index + 1,
            pattern,
            text: text.trim().slice(0, 160),
          });
        }
      }
    });
  }
  return offenders;
}
