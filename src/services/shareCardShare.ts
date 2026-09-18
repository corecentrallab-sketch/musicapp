/**
 * Share-decision logic for the ShareCard modal (src/components/ShareCard.tsx).
 *
 * Why this module exists — owner-reported defect on v21 (0.1.16):
 * "the share preview card is dead". Two separate faults sat behind it:
 *
 * 1. Android dropped the card image. React Native's `Share.share` on Android
 *    only ever hands `{ title, message }` to the OS intent — a `file://` PNG
 *    passed as `url` is silently ignored (v21 used two byte-identical Platform
 *    branches, so the iOS/Android split was a no-op). The capture succeeded and
 *    the image was thrown away. Fix: when a captured PNG exists, share it with
 *    `expo-sharing`'s `shareAsync(uri, { mimeType: 'image/png' })` (the pattern
 *    already used by `src/services/cloudSync.ts`); otherwise fall back to a
 *    text-only `Share.share`.
 * 2. Both failure paths were silent — a failed capture looked like a dead share.
 *
 * The decision of *how* to hand the card to the OS is pure logic, so it lives
 * here, free of react-native / expo imports, and the tier1 gate can test it.
 * Deliberately honest copy: no urgency, no promise the share sheet opened.
 */

/** Inline hint when the card PNG could not be captured (text-only share). */
export const SHARE_CARD_IMAGE_UNAVAILABLE_HINT =
  'Sharing text only — card image unavailable';

/** Inline hint when the share sheet itself refused to open. */
export const SHARE_CARD_FAILED_HINT =
  'Couldn’t open the share sheet — nothing was sent. Tap Share to try again.';

/** Brand link appended to the text-only fallback (the PNG carries its own). */
export const SHARE_CARD_LINK = 'https://notesnap.app';

/** MIME type of the captured card PNG. */
export const SHARE_CARD_MIME_TYPE = 'image/png';

export type ShareCardPayload =
  | {
      /** Share the captured card image through expo-sharing. */
      mode: 'image';
      imageUri: string;
      dialogTitle: string;
      mimeType: string;
    }
  | {
      /** Text-only fallback through React Native's Share API. */
      mode: 'text';
      message: string;
    };

export interface ShareCardPayloadInput {
  /** Ready-to-share sentence (the share text the user sees). */
  shareText: string;
  /** Local file URI of the captured PNG, when capture succeeded. */
  imageUri?: string | null;
  /**
   * Whether image sharing is usable on this device/platform
   * (`Sharing.isAvailableAsync()`; false on web / some emulators).
   */
  imageSharingAvailable: boolean;
}

/**
 * Decides whether the captured card travels as an image or as text.
 * An image is only used when a real URI exists AND the platform can share
 * files — otherwise the text fallback, which is what the user actually gets.
 */
export function buildShareCardPayload(
  input: ShareCardPayloadInput,
): ShareCardPayload {
  const uri =
    typeof input.imageUri === 'string' && input.imageUri.length > 0
      ? input.imageUri
      : undefined;

  if (uri && input.imageSharingAvailable) {
    return {
      mode: 'image',
      imageUri: uri,
      // The dialog title is where the share sentence survives an image-only
      // share (Android chooser title; iOS ignores it but loses nothing).
      dialogTitle: input.shareText,
      mimeType: SHARE_CARD_MIME_TYPE,
    };
  }

  return {
    mode: 'text',
    message: `${input.shareText}\n\n${SHARE_CARD_LINK}`,
  };
}

/** Card data the ShareCard modal renders (mirrors its props). */
export interface ShareCardPreviewData {
  /** Streak in days — never invented, never negative. */
  streak: number;
  /** Today's practice minutes, rounded. */
  practiceMinutes: number;
}

/**
 * Turns the live streak/minutes reads into card data with honest fallbacks.
 *
 * A running app can legitimately have no practice history yet (a fresh install,
 * a first-time piece), and a failed storage read must not put `NaN` or a
 * negative day count on a card that gets shared. Both values clamp to 0 —
 * "Day 0 streak" is the truth for a musician who has not practised yet.
 */
export function resolveShareCardPreviewData(input: {
  streakDays?: number | null;
  todayMinutes?: number | null;
}): ShareCardPreviewData {
  return {
    streak: normaliseCount(input.streakDays),
    practiceMinutes: normaliseCount(input.todayMinutes),
  };
}

function normaliseCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
}

/** Accessibility label for the tappable Share Preview card on the piece screen. */
export function sharePreviewAccessibilityLabel(title: string): string {
  return `Share Preview: open the share card for ${title}`;
}
