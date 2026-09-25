/**
 * uploadFieldContract.ts — the multipart FIELD NAME each upload call site sends,
 * pinned so a drift fails the tier1 gate instead of silently 400-ing on device.
 *
 * WHY: the app and the backend must agree on the multipart field name, and
 * NOTHING else in the app catches a drift. A wrong field name does not throw —
 * the server answers 400 ("Missing 'audio' file in form data" / "Missing audio
 * file field 'file'"), which on a phone is indistinguishable from a failed
 * recognition. That exact class cost us a debugging round on 09-25 when a probe
 * posted the wrong field.
 *
 * THE CONTRACT (git-verified against src/services/api.ts):
 *   /api/recognize         ← field "audio"   (formData.append in recognizeAudio)
 *   /api/hum               ← field "audio"   (postAudioMultipart 3rd arg)
 *   /api/recognize-modern  ← field "file"    (postAudioMultipart 3rd arg)
 *
 * The server half of the same contract lives in the site repo
 * (src/services/upload-field-contract.ts) and pins the handlers' form.get().
 *
 * Pure by design (no react / react-native / fs / path), so the tier1 gate can
 * compile it with node_modules absent. See scripts/uploadFieldContract.test.ts,
 * which walks the real api.ts off disk; the scanners below are exported so the
 * suite can also prove they FAIL on mutated and pre-fix fixtures.
 */

/** Call site route → the multipart field that route must receive. */
export const EXPECTED_UPLOAD_FIELDS: Readonly<Record<string, string>> = {
  "/api/recognize": "audio",
  "/api/hum": "audio",
  "/api/recognize-modern": "file",
};

/** The field the /api/recognize path appends directly (it builds its own FormData). */
export const DIRECT_APPEND_ROUTE = "/api/recognize";
export const DIRECT_APPEND_FIELD = "audio";

/** One `postAudioMultipart(<uri>, "<path>", "<field>")` call site. */
export interface MultipartCallSite {
  path: string;
  field: string;
  /** 1-based line of the call. */
  line: number;
}

/** Every `postAudioMultipart(uri, "path", "field")` call in a source file. */
export function readMultipartCallSites(source: string): MultipartCallSite[] {
  const out: MultipartCallSite[] = [];
  const re = /postAudioMultipart\(\s*[^,()]+,\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    out.push({
      path: match[1],
      field: match[2],
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return out;
}

/** Every direct `formData.append("field", …)` in a source file. */
export function readDirectAppendFields(source: string): { field: string; line: number }[] {
  const out: { field: string; line: number }[] = [];
  const re = /formData\.append\(\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    out.push({
      field: match[1],
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return out;
}

/**
 * One finding per drift, phrased for a test failure. Catches:
 *   • a call site whose field is not the contracted one,
 *   • a call site for a route we do not know about (a new upload path nobody
 *     pinned — the next silent 400),
 *   • a missing call site (the contract cannot be verified if it vanished),
 *   • the /api/recognize path appending something other than "audio",
 *   • any direct append of "file" (the exact mutation this guard must catch).
 */
export function auditAppUploadFields(source: string): string[] {
  const findings: string[] = [];
  const sites = readMultipartCallSites(source);
  for (const site of sites) {
    const expected = EXPECTED_UPLOAD_FIELDS[site.path];
    if (expected === undefined) {
      findings.push(
        `src/services/api.ts:${site.line} — uploads to unpinned route "${site.path}" with field "${site.field}"; add it to EXPECTED_UPLOAD_FIELDS (server half: site-repo upload-field-contract.ts)`,
      );
      continue;
    }
    if (site.field !== expected) {
      findings.push(
        `src/services/api.ts:${site.line} — ${site.path} uploads field "${site.field}" but the server reads "${expected}" (silent 400 "missing file" on device)`,
      );
    }
  }
  for (const [path, field] of Object.entries(EXPECTED_UPLOAD_FIELDS)) {
    if (path === DIRECT_APPEND_ROUTE) continue;
    if (!sites.some((s) => s.path === path)) {
      findings.push(
        `src/services/api.ts — no postAudioMultipart() call site found for ${path}; the field contract for "${field}" cannot be verified`,
      );
    }
  }

  const appends = readDirectAppendFields(source);
  const direct = appends.filter((a) => a.field === DIRECT_APPEND_FIELD);
  if (direct.length === 0) {
    findings.push(
      `src/services/api.ts — ${DIRECT_APPEND_ROUTE} must append the multipart field "${DIRECT_APPEND_FIELD}" (formData.append("${DIRECT_APPEND_FIELD}", …)); none found`,
    );
  }
  for (const append of appends) {
    if (append.field === DIRECT_APPEND_FIELD) continue;
    findings.push(
      `src/services/api.ts:${append.line} — upload path appends field "${append.field}" directly; only "${DIRECT_APPEND_FIELD}" may be appended that way (the other routes pass their field through postAudioMultipart)`,
    );
  }
  return findings;
}
