/**
 * upload-field-contract.ts — the multipart FIELD NAME each recognition route
 * reads, pinned in one place (cross-repo field-name regression guard, 09-25).
 *
 * WHY THIS EXISTS: the app and the server must agree on the multipart field
 * name, and nothing else catches a drift. A wrong field name does not crash —
 * the handler answers 400 "Missing 'audio' file in form data" (or, on the modern
 * route, "Missing audio file field 'file'"), which on-device looks exactly like
 * a recognition failure. That is the bug class the lead's own probe hit on
 * 09-25, so the field names are pinned here and asserted against the live
 * handlers and against the app's upload call sites.
 *
 * THE CONTRACT (git-verified, 09-25):
 *   /api/recognize         ← field "audio"   (the library landmark pass)
 *   /api/hum               ← field "audio"   (hum / whistle / sing)
 *   /api/recognize-modern  ← field "file"    (the AudD modern pass — NOT "audio")
 *
 * The app side of the same contract lives in musicapp-update
 * (src/services/uploadFieldContract.ts) and pins the call sites in api.ts.
 *
 * Pure by design (string in, findings out) so the test gate can cover the
 * scanner itself with planted fixtures, not just the live files.
 */

export interface UploadFieldExpectation {
  /** Repo-relative path of the handler, as the test walks it (src/ prefix). */
  path: string;
  /** The route the handler serves, for the failure message. */
  route: string;
  /** The multipart field the handler must read. */
  field: string;
}

export const HANDLER_UPLOAD_FIELDS: readonly UploadFieldExpectation[] = [
  { path: "src/services/recognize-handler.ts", route: "/api/recognize", field: "audio" },
  { path: "src/services/hum/hum-handler.ts", route: "/api/hum", field: "audio" },
  { path: "src/services/modern-recognize-handler.ts", route: "/api/recognize-modern", field: "file" },
];

/** The field a handler reads off its FormData, and the line it reads it on. */
export interface UploadFieldRead {
  field: string;
  line: number;
}

/**
 * The FIRST `form.get("…")` / `formData.get("…")` in a handler, with its line.
 * Comments are NOT stripped here: unlike a "must not appear" scan, this looks
 * for the real read, and a handler that only mentions the field in a comment
 * still fails the audit below (no read found).
 */
export function readUploadField(source: string): UploadFieldRead | null {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = /(?:formData|form)\.get\(\s*["']([^"']+)["']\s*\)/.exec(lines[i]);
    if (match) return { field: match[1], line: i + 1 };
  }
  return null;
}

/**
 * One finding per handler whose read field is wrong or missing, phrased for a
 * test failure message.
 */
export function auditUploadFields(
  files: readonly { path: string; content: string }[],
  expectations: readonly UploadFieldExpectation[] = HANDLER_UPLOAD_FIELDS,
): string[] {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const findings: string[] = [];
  for (const expected of expectations) {
    const source = byPath.get(expected.path);
    if (source === undefined) {
      findings.push(`${expected.path} — handler source not found (the audit cannot see ${expected.route})`);
      continue;
    }
    const read = readUploadField(source);
    if (!read) {
      findings.push(
        `${expected.path} — no form.get(...) upload read found; ${expected.route} must read the multipart field "${expected.field}"`,
      );
      continue;
    }
    if (read.field !== expected.field) {
      findings.push(
        `${expected.path}:${read.line} — ${expected.route} reads field "${read.field}" but the app uploads "${expected.field}" (silent 400 "missing file" on device)`,
      );
    }
  }
  return findings;
}
