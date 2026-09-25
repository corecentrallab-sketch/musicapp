/**
 * V26 honest capture feedback (owner 09-25).
 *
 * The owner's repeated on-device "No Match Found" was one card for two very
 * different facts: "the microphone barely recorded" and "we heard it, we just do
 * not hold this piece". This suite pins the decision, the two card states, the
 * small measurable capture line, the request headers — and, with a live scan of
 * RecognitionResultView.tsx, that the NO-MATCH CARD actually renders them.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  NO_MATCH_BODY_TINY,
  NO_MATCH_TITLE_LIBRARY,
  NO_MATCH_TITLE_TINY,
  captureDiagnosticHeaders,
  captureDiagnosticLine,
  isTinyCapture,
  noAudioCardCopy,
  noMatchCardCopy,
  noMatchCardWired,
} from '../src/services/captureFeedback';
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
const RESULT_VIEW = pathMod.join(process.cwd(), 'src/components/RecognitionResultView.tsx');

try {
  console.log('\nisTinyCapture — the defect signal');
  assertEq(isTinyCapture({ bytes: 3000, durationMs: 12000, peakDbFS: -20 }), true, 'a 3KB clip is tiny');
  assertEq(isTinyCapture({ bytes: 200000, durationMs: 320, peakDbFS: -20 }), true, 'a 0.32s clip is tiny');
  assertEq(
    isTinyCapture({ bytes: 198345, durationMs: 12400, peakDbFS: -18 }),
    false,
    'a real 12s / 198KB capture is NOT tiny',
  );
  // A MEASURED zero is the no-clip case (the recorder's stop failure 'empty') —
  // the most tiny capture there is, not an "unknown". The screen feeds exactly
  // these numbers, so this is the assertion the honest card depends on.
  assertEq(
    isTinyCapture({ bytes: 0, durationMs: 0, peakDbFS: null }),
    true,
    'a measured zero-byte / zero-ms capture (no clip at all) IS tiny',
  );
  assertEq(
    isTinyCapture({ bytes: 0, durationMs: 12000, peakDbFS: -18 }),
    true,
    'zero bytes on disk is tiny even if a duration was reported',
  );
  assertEq(isTinyCapture({ bytes: null, durationMs: null, peakDbFS: null }), false, 'unknown numbers are not a tiny verdict');
  assertEq(isTinyCapture(null), false, 'no diagnostics at all is not a tiny verdict');

  console.log('\nthe no-match card says the REAL reason');
  const tiny = noMatchCardCopy({ bytes: 2400, durationMs: 900, peakDbFS: -40 });
  assertEq(tiny.tiny, true, 'a tiny capture is flagged as the reason');
  assertEq(tiny.title, NO_MATCH_TITLE_TINY, 'tiny → the "could not hear enough" title');
  assertEq(tiny.body, NO_MATCH_BODY_TINY, 'tiny → the retry-first message the owner asked for');
  assertEq(tiny.showRetry, true, 'tiny → Retry is offered');
  const heard = noMatchCardCopy({ bytes: 198345, durationMs: 12400, peakDbFS: -18 });
  assertEq(heard.tiny, false, 'a real capture is not blamed on the microphone');
  assertEq(heard.title, NO_MATCH_TITLE_LIBRARY, 'a real capture says "no match in our library yet"');
  assertEq(
    noMatchCardCopy({ bytes: 198345, durationMs: 12400, peakDbFS: -18 }, '  too short a phrase  ').body,
    'too short a phrase',
    "the server's own reason wins when it declined to name a piece",
  );

  // The no-clip case (stop failure 'empty'): the screen has no file, so it feeds
  // NO_AUDIO_DIAGNOSTICS (0 bytes / 0 ms). One path, the same honest words.
  const noAudio = noMatchCardCopy({ bytes: 0, durationMs: 0, peakDbFS: null });
  assertEq(noAudio.tiny, true, 'no clip at all → the microphone is the reason');
  assertEq(noAudio.title, NO_MATCH_TITLE_TINY, 'no clip at all → "We couldn\'t hear enough"');
  assertEq(noAudio.body, NO_MATCH_BODY_TINY, 'no clip at all → the retry-first message');
  assertEq(noAudio.showRetry, true, 'no clip at all → Retry is offered');
  const noAudioNamed = noAudioCardCopy();
  assertEq(noAudioNamed.title, noAudio.title, 'noAudioCardCopy() agrees with the diagnostics-driven copy');
  assertEq(noAudioNamed.body, noAudio.body, 'noAudioCardCopy() carries the same retry-first body');
  assertEq(noAudioNamed.tiny, true, 'noAudioCardCopy() is the tiny state');

  console.log('\nthe small measurable capture line');
  assertEq(
    captureDiagnosticLine({ bytes: 198345, durationMs: 12400, peakDbFS: -18.5 }),
    'Captured 12.4s · level -18 dBFS',
    'duration + level, once each, no verdict words',
  );
  assertEq(captureDiagnosticLine({ bytes: 198345, durationMs: 12400, peakDbFS: null }), 'Captured 12.4s', 'level absent → duration only');
  assertEq(captureDiagnosticLine({ bytes: null, durationMs: null, peakDbFS: null }), null, 'nothing measured → no line at all');

  console.log('\nthe request headers (server-side diagnostics)');
  const headers = captureDiagnosticHeaders({ bytes: 198345, durationMs: 12400, peakDbFS: -18.5 });
  assertEq(headers['x-capture-duration-ms'], '12400', 'duration header');
  assertEq(headers['x-capture-peak-dbfs'], '-18.5', 'peak-dBFS header');
  assertEq(headers['x-capture-bytes'], '198345', 'bytes header');
  assertEq(
    Object.keys(captureDiagnosticHeaders({ bytes: null, durationMs: 12000, peakDbFS: null })).join(','),
    'x-capture-duration-ms',
    'only MEASURED values travel — never "null" on the wire',
  );
  assertEq(Object.keys(captureDiagnosticHeaders(null)).length, 0, 'no diagnostics → no headers');

  console.log('\nthe live no-match card renders the decision + the capture line');
  const view = fs.readFileSync(RESULT_VIEW, 'utf8');
  assert(view.length > 5000, `RecognitionResultView.tsx is the real source (${view.length} chars)`);
  assert(view.includes('phase.diagnostics'), 'the no-match phase carries the capture diagnostics');
  assert(noMatchCardWired(view), 'the no-match card calls noMatchCardCopy(...) and renders captureDiagnosticLine(phase.diagnostics)');
  assert(view.includes('HUM_FALLBACK_BUTTON'), 'the hum/whistle way in is still on the card');
  const preFixCard = [
    "  if (phase.type === 'no-match') {",
    '    return (',
    '      <Modal visible transparent onRequestClose={onClose}>',
    '        <View style={styles.card}>',
    '          <Text style={styles.cardTitle}>No Match Found</Text>',
    '          <Text style={styles.noMatchText}>{phase.message}</Text>',
    '        </View>',
    '      </Modal>',
    '    );',
    '  }',
    '  const topMatch = phase.response.matches[0];',
  ].join('\n');
  assertEq(noMatchCardWired(preFixCard), false, 'the pre-fix single-message card is caught');
  assertEq(
    noMatchCardWired(
      view
        .replace('noMatchCardCopy(phase.diagnostics, phase.message)', 'noMatchCardCopy(undefined, phase.message)')
        .replace('captureDiagnosticLine(phase.diagnostics)', 'captureDiagnosticLine(undefined)'),
    ),
    false,
    'a card that stops passing the phase diagnostics to the copy + capture line is caught',
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
