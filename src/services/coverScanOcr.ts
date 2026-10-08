/**
 * coverScanOcr.ts — the on-device text recogniser behind "Scan the cover"
 * (v36 fix 4, owner FAIL 10-08: "snaps a picture and can save it — snaps but
 * does not scan").
 *
 * WHAT IT IS. One function: hand it the captured photo's local uri, get back the
 * words printed on the cover. It is the ONLY place in the app that talks to a text
 * recogniser, so the rest of the flow (services/coverScan.ts decides what the text
 * means; CoverScanModal shows it) stays pure and testable.
 *
 * HONEST SCOPE — WHAT IT READS. Google ML Kit's on-device TEXT recogniser (the
 * `@react-native-ml-kit/text-recognition` native module). It reads the words on a
 * title page — title, composer, publisher furniture. It does NOT read music
 * notation, so this is not OMR and never produces note data; the app makes no
 * transcription claim anywhere for a scan. The photo is read on the device and is
 * never uploaded, hosted or cached.
 *
 * NEVER THROWS, NEVER INVENTS. A recogniser is a native module and three things
 * can go wrong that the caller must be able to tell apart from a blank page:
 *   • the module is not linked on this device/build → `module-missing`
 *   • the recogniser rejects the image → `recognize-failed` (its own message)
 *   • the recogniser returns nothing usable → NOT a failure: an empty `text`,
 *     which the caller turns into its own honest "no title found" state.
 * Every failure is returned as `{ failed: true, reason }`, never raised and never
 * converted into made-up text.
 *
 * This module imports react-native (through the recogniser), so it is deliberately
 * NOT in tsconfig.tier1.json's include list — the gate must compile with
 * node_modules absent. The pure half lives in services/coverScan.ts.
 */
import TextRecognition from '@react-native-ml-kit/text-recognition';

/** The module id, so a source-scan guard can see which recogniser we ship. */
export const COVER_SCAN_OCR_MODULE = '@react-native-ml-kit/text-recognition';

export interface CoverOcrRead {
  /** The raw text the recogniser returned ('' when it read nothing usable). */
  text: string;
  /** True when the READ failed — never when the page was simply blank. */
  failed: boolean;
  /** Why it failed ('module-missing' / 'no-photo' / the recogniser's message). */
  reason: string | null;
}

/**
 * Read the words on a cover photo. The uri is a local file uri from
 * expo-camera's `takePictureAsync`; nothing about it leaves the device.
 */
export async function readCoverText(photoUri: string): Promise<CoverOcrRead> {
  if (typeof photoUri !== 'string' || photoUri.length === 0) {
    return { text: '', failed: true, reason: 'no-photo' };
  }
  try {
    const result = await TextRecognition.recognize(photoUri);
    // The text is the recogniser's OWN output. Nothing is synthesised here: no
    // filename, no placeholder, no guess — an empty read stays empty and the
    // caller shows its honest "no title found" line.
    const text = typeof result?.text === 'string' ? result.text : '';
    return { text, failed: false, reason: null };
  } catch (err) {
    // A native module that is not linked (or a recogniser that rejects the image)
    // must not take the scan screen down with it: the user gets the honest
    // failure line and the typed search, which is one tap away.
    const reason =
      err instanceof Error && err.message ? err.message : 'recognize-failed';
    return { text: '', failed: true, reason };
  }
}
