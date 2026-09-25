/**
 * Multipart upload FIELD-NAME contract (09-25 bug class).
 *
 * The app and the backend must agree on the multipart field per route
 * (/api/recognize + /api/hum = "audio"; /api/recognize-modern = "file"), and
 * nothing else in the app catches a drift: a wrong field name is a silent 400 on
 * device, indistinguishable from a failed recognition. This suite reads the REAL
 * src/services/api.ts off disk and pins every upload call site; the scanners are
 * proved non-vacuous against mutated, pre-fix and planted fixtures.
 *
 * It also pins the V26 capture-diagnostics HEADERS reaching both upload paths —
 * those numbers are what make an on-device "No Match Found" measurable.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  EXPECTED_UPLOAD_FIELDS,
  auditAppUploadFields,
  readDirectAppendFields,
  readMultipartCallSites,
} from '../src/services/uploadFieldContract';
import { headersAttachedOnUpload } from '../src/services/captureFeedback';
declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
let failures = 0;
let passes = 0;
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
    console.error(`  ✗ FAILED: ${msg} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

const fs = require('fs');
const pathMod = require('path');
const API_PATH = pathMod.join(process.cwd(), 'src/services/api.ts');

try {
  const api = fs.readFileSync(API_PATH, 'utf8');
  const API_LIVE_HEADERS = 'headers: uploadHeaders(deviceId, diagnostics)';

  console.log('\nthe pinned contract');
  assertEq(
    JSON.stringify(EXPECTED_UPLOAD_FIELDS),
    JSON.stringify({ '/api/recognize': 'audio', '/api/hum': 'audio', '/api/recognize-modern': 'file' }),
    'route → multipart field: recognize=audio, hum=audio, recognize-modern=file',
  );

  console.log('\nlive api.ts upload call sites');
  assert(api.length > 8000, `api.ts is the real source (${api.length} chars)`);
  const sites = readMultipartCallSites(api);
  assertEq(sites.length, 2, 'exactly two postAudioMultipart() call sites (hum + modern)');
  assertEq(
    sites.map((s) => `${s.path}=${s.field}`).sort().join(','),
    '/api/hum=audio,/api/recognize-modern=file',
    'the live call sites pass the contracted fields',
  );
  const appends = readDirectAppendFields(api);
  assert(
    appends.filter((a) => a.field === 'audio').length >= 1,
    'the /api/recognize path appends the multipart field "audio"',
  );
  assert(
    appends.every((a) => a.field === 'audio'),
    'no upload path appends a field other than "audio" directly',
  );
  assertEq(auditAppUploadFields(api).length, 0, 'the live api.ts passes the audit with no findings');

  console.log('\nthe guard is not vacuous: a mutated field is caught');
  const mutated =
    'const j = await postAudioMultipart(audioUri, "/api/hum", "audio", diagnostics);\n' +
    'const k = await postAudioMultipart(audioUri, "/api/recognize-modern", "audio", diagnostics);\n' +
    'formData.append("audio", filePart);\n';
  const mutatedFindings = auditAppUploadFields(mutated);
  assert(mutatedFindings.length >= 1, 'a drifted modern field produces a finding');
  assert(
    mutatedFindings.some((f) => f.includes('/api/recognize-modern') && f.includes('the server reads "file"')),
    'the finding names the route and the server-side field it must match',
  );

  console.log('\nthe guard is not vacuous: a pre-fix upload (no pinned field) is caught');
  const preFix =
    'const j = await postAudioMultipart(audioUri, "/api/recognize-modern");\n' +
    'formData.append("audio", filePart);\n';
  assert(auditAppUploadFields(preFix).length >= 1, 'an unpinned /api/hum call site is a finding');

  console.log('\ncapture diagnostics headers ride on BOTH upload paths');
  assert(headersAttachedOnUpload(api), 'api.ts funnels upload headers through uploadHeaders() + captureDiagnosticHeaders()');
  assertEq(
    (api.match(/headers:\s*uploadHeaders\(/g) ?? []).length,
    2,
    'both upload fetches use the diagnostics-carrying header helper',
  );
  assert(api.includes(API_LIVE_HEADERS), 'the exact live header call shape is present');
  assert(
    !headersAttachedOnUpload(
      'headers: { Accept: "application/json", "x-user-id": deviceId },',
    ),
    'the pre-fix inline header object fails the contract',
  );
  assert(
    !headersAttachedOnUpload(
      'function uploadHeaders() { return { Accept: "application/json" }; }\nheaders: uploadHeaders(deviceId, diagnostics);\nheaders: uploadHeaders(deviceId, diagnostics);',
    ),
    'a helper that drops captureDiagnosticHeaders() fails the contract',
  );
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
if (failures > 0) {
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
console.log(`\n${passes} passed, ${failures} failed\n`);
