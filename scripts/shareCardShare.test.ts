/**
 * Unit tests for the share-card decision logic (src/services/shareCardShare.ts)
 * — the fix for the owner-reported dead share flow on v21 (0.1.16):
 *
 *   "the share preview card is dead"
 *
 * Three defects sat behind it, and these tests pin the parts a tap cannot prove:
 *   1. the Android share dropped the captured PNG (RN `Share.share` ignores
 *      `url`); an image URI must now route through expo-sharing
 *   2. silent failure — a failed capture/share must produce honest copy
 *   3. the tappable Share Preview card must open a card filled with real,
 *      non-NaN streak/minutes data (honest fallbacks, never invented numbers)
 *
 * Pure module, plain Node, no react-native, no network — same convention as the
 * other scripts/*.test.ts. Run with: npm run test:tier1
 */
import {
  SHARE_CARD_FAILED_HINT,
  SHARE_CARD_IMAGE_UNAVAILABLE_HINT,
  SHARE_CARD_LINK,
  SHARE_CARD_MIME_TYPE,
  buildShareCardPayload,
  resolveShareCardPreviewData,
  sharePreviewAccessibilityLabel,
} from '../src/services/shareCardShare';

declare const process: { exit(code: number): never };
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
    console.error(
      `  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`,
    );
  }
}

const SHARE_TEXT =
  'I\'m learning "Für Elise" by Beethoven on NoteSnap! Day 3 streak 🔥';
const PNG_URI = 'file:///data/user/0/com.notesnap.sheetmusic/cache/ReactNative-snapshot-image1234.png';

/** A card image that exists and a platform that can share files. */
function imagePayload() {
  return buildShareCardPayload({
    shareText: SHARE_TEXT,
    imageUri: PNG_URI,
    imageSharingAvailable: true,
  });
}

function imageTests(): void {
  const payload = imagePayload();

  assertEq(payload.mode, 'image', 'captured PNG + file sharing → image share');
  if (payload.mode !== 'image') return;

  assertEq(
    payload.imageUri,
    PNG_URI,
    'the captured file:// PNG is the thing actually shared (defect 1)',
  );
  assertEq(
    payload.mimeType,
    SHARE_CARD_MIME_TYPE,
    'the PNG is shared as image/png',
  );
  assertEq(
    payload.dialogTitle,
    SHARE_TEXT,
    'the share sentence is carried as the dialog title (image-only share keeps it)',
  );
  assert(
    payload.dialogTitle.includes('Für Elise'),
    'the dialog title names the piece being shared',
  );
  assert(
    payload.imageUri.startsWith('file://'),
    'image sharing targets a local file:// URI, not a remote URL',
  );
}

function fallbackTests(): void {
  // No capture at all (view-shot threw): text-only, and no image mode.
  const noImage = buildShareCardPayload({
    shareText: SHARE_TEXT,
    imageUri: undefined,
    imageSharingAvailable: true,
  });
  assertEq(noImage.mode, 'text', 'failed capture → text-only share');
  if (noImage.mode === 'text') {
    assert(
      noImage.message.startsWith(SHARE_TEXT),
      'text fallback still carries the share sentence',
    );
    assert(
      noImage.message.includes(SHARE_CARD_LINK),
      'text fallback appends the notesnap.app link (the PNG cannot carry it)',
    );
  }

  // Empty-string URI must not be mistaken for a captured image.
  const empty = buildShareCardPayload({
    shareText: SHARE_TEXT,
    imageUri: '',
    imageSharingAvailable: true,
  });
  assertEq(empty.mode, 'text', 'empty image URI → text-only share');

  const nullUri = buildShareCardPayload({
    shareText: SHARE_TEXT,
    imageUri: null,
    imageSharingAvailable: true,
  });
  assertEq(nullUri.mode, 'text', 'null image URI → text-only share');

  // Web / an emulator without file sharing: fall back instead of throwing.
  const notAvailable = buildShareCardPayload({
    shareText: SHARE_TEXT,
    imageUri: PNG_URI,
    imageSharingAvailable: false,
  });
  assertEq(
    notAvailable.mode,
    'text',
    'platform cannot share files → text-only share (no silent drop)',
  );
  if (notAvailable.mode === 'text') {
    assert(
      notAvailable.message.includes(SHARE_CARD_LINK),
      'unsupported-platform fallback keeps the brand link',
    );
  }

  // Image sharing available but no capture to share.
  const availableNoUri = buildShareCardPayload({
    shareText: SHARE_TEXT,
    imageUri: undefined,
    imageSharingAvailable: false,
  });
  assertEq(
    availableNoUri.mode,
    'text',
    'no capture and no file sharing → text-only share',
  );

  // The decision never invents an image URI.
  assert(
    imagePayload().mode === 'image' &&
      notAvailable.mode === 'text' &&
      noImage.mode === 'text',
    'image mode is used exactly when a real URI and file sharing are both present',
  );
}

function previewDataTests(): void {
  const live = resolveShareCardPreviewData({
    streakDays: 3,
    todayMinutes: 12.4,
  });
  assertEq(live.streak, 3, 'live streak is shown as-is');
  assertEq(live.practiceMinutes, 12, "today's minutes are rounded for the card");

  const roundedUp = resolveShareCardPreviewData({
    streakDays: 0,
    todayMinutes: 0.6,
  });
  assertEq(roundedUp.practiceMinutes, 1, 'minutes round to the nearest minute');
  assertEq(
    roundedUp.streak,
    0,
    'a real 0-day streak stays 0 on the card (no invented day count)',
  );

  // No data at all — a first-time piece / fresh install.
  const none = resolveShareCardPreviewData({});
  assertEq(none.streak, 0, 'no streak data → 0 days, never NaN');
  assertEq(none.practiceMinutes, 0, 'no practice data → 0 min today, never NaN');

  const nulls = resolveShareCardPreviewData({
    streakDays: null,
    todayMinutes: null,
  });
  assertEq(nulls.streak, 0, 'null streak → 0 days');
  assertEq(nulls.practiceMinutes, 0, 'null minutes → 0 min');

  const nan = resolveShareCardPreviewData({
    streakDays: NaN,
    todayMinutes: NaN,
  });
  assert(
    Number.isFinite(nan.streak) && Number.isFinite(nan.practiceMinutes),
    'NaN storage reads never reach the shared artwork',
  );
  assertEq(nan.streak, 0, 'NaN streak → 0 days');

  const negatives = resolveShareCardPreviewData({
    streakDays: -4,
    todayMinutes: -2.5,
  });
  assertEq(negatives.streak, 0, 'negative streak clamps to 0');
  assertEq(negatives.practiceMinutes, 0, 'negative minutes clamp to 0');

  const infinite = resolveShareCardPreviewData({
    streakDays: Infinity,
    todayMinutes: undefined,
  });
  assertEq(infinite.streak, 0, 'non-finite streak → 0 days');

  const big = resolveShareCardPreviewData({
    streakDays: 365,
    todayMinutes: 90,
  });
  assertEq(big.streak, 365, 'a long streak is untouched');
  assertEq(big.practiceMinutes, 90, 'long practice sessions are untouched');

  // Both screens (post-practice alert, preview tap) fill the same shape.
  const a = resolveShareCardPreviewData({ streakDays: 3, todayMinutes: 12 });
  const b = resolveShareCardPreviewData({ streakDays: 3, todayMinutes: 12 });
  assert(
    a.streak === b.streak && a.practiceMinutes === b.practiceMinutes,
    'the same inputs give the same card data on every entry point',
  );
}

function copyTests(): void {
  assert(
    SHARE_CARD_IMAGE_UNAVAILABLE_HINT.length > 0 &&
      SHARE_CARD_FAILED_HINT.length > 0,
    'both failure paths have user-facing copy (defect 2)',
  );
  assert(
    /card image unavailable/i.test(SHARE_CARD_IMAGE_UNAVAILABLE_HINT),
    'the capture-failure hint says the share is text only',
  );
  assert(
    /try again/i.test(SHARE_CARD_FAILED_HINT),
    'the share-failure hint says what the user can do next',
  );

  // Honest copy only: no urgency, scarcity or "final notice" phrasing.
  const urgency = /urgent|final notice|act now|only \d+ (spots|left)|expires/i;
  assert(
    !urgency.test(SHARE_CARD_IMAGE_UNAVAILABLE_HINT) &&
      !urgency.test(SHARE_CARD_FAILED_HINT),
    'failure copy carries no manufactured urgency',
  );

  const label = sharePreviewAccessibilityLabel('Für Elise');
  assert(label.includes('Für Elise'), 'the preview accessibility label names the piece');
  assert(
    /share preview/i.test(label),
    'the preview accessibility label matches the visible "Share Preview" heading',
  );

  const other = sharePreviewAccessibilityLabel('Clair de Lune');
  assert(
    label !== other &&
      other.includes('Clair de Lune') &&
      !other.includes('Für Elise'),
    'the preview label is per-piece, not a generic string',
  );
}

function main(): void {
  console.log('\n=== share card (preview tap / Android PNG / honest failures) ===');
  imageTests();
  fallbackTests();
  previewDataTests();
  copyTests();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
