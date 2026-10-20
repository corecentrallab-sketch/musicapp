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
import type { OcrBlock, OcrFrame, OcrImageSize, OcrLine } from './ocrTitleCandidates';

/** The module id, so a source-scan guard can see which recogniser we ship. */
export const COVER_SCAN_OCR_MODULE = '@react-native-ml-kit/text-recognition';

export interface CoverOcrRead {
  /** The raw text the recogniser returned ('' when it read nothing usable). */
  text: string;
  /** True when the READ failed — never when the page was simply blank. */
  failed: boolean;
  /** Why it failed ('module-missing' / 'no-photo' / the recogniser's message). */
  reason: string | null;
  /**
   * THE RECOGNISER'S OWN GEOMETRY (v43 item C1). ML Kit already returns every
   * block/line/element with its frame in IMAGE PIXELS; the flow used to throw all
   * of it away at this line and keep only the joined text, which is why the app
   * could not tell a printed TITLE from a line of publisher furniture. Nothing is
   * computed here — these are the recogniser's numbers, passed through — and an
   * empty/failed read carries an empty list.
   */
  blocks: OcrBlock[];
  /** The photo's pixel size, so a caller can place a block on the page. */
  imageSize: OcrImageSize | null;
}

function readFrame(frame: unknown): OcrFrame | null {
  if (!frame || typeof frame !== 'object') return null;
  const box = frame as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  const x = typeof box.x === 'number' ? box.x : 0;
  const y = typeof box.y === 'number' ? box.y : 0;
  const width = typeof box.width === 'number' ? box.width : 0;
  const height = typeof box.height === 'number' ? box.height : 0;
  if (width <= 0 && height <= 0) return null;
  return { x, y, width, height };
}

/**
 * The recogniser's blocks, in the pure shape `services/ocrTitleCandidates` reads.
 * Every field is COPIED, never invented: a block with no text is dropped rather
 * than given one, and a missing frame stays null.
 */
function readBlocks(result: unknown): OcrBlock[] {
  const source = (result as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(source)) return [];
  const blocks: OcrBlock[] = [];
  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    const block = raw as { text?: unknown; frame?: unknown; lines?: unknown };
    const lines: OcrLine[] = Array.isArray(block.lines)
      ? block.lines
          .filter((line): line is Record<string, unknown> => !!line && typeof line === 'object')
          .map((line) => {
            const elements = Array.isArray(line.elements) ? line.elements : [];
            return {
              text: typeof line.text === 'string' ? line.text : '',
              frame: readFrame(line.frame),
              elements: elements
                .filter(
                  (element): element is Record<string, unknown> =>
                    !!element && typeof element === 'object',
                )
                .map((element) => ({
                  text: typeof element.text === 'string' ? element.text : '',
                  frame: readFrame(element.frame),
                })),
            };
          })
      : [];
    const text = typeof block.text === 'string' ? block.text : '';
    if (text.trim().length === 0 && lines.length === 0) continue;
    blocks.push({ text, frame: readFrame(block.frame), lines });
  }
  return blocks;
}

/**
 * The photo's own pixel size. ML Kit does not report it, so it is taken from the
 * blocks' own extent (the far edge of the furthest block) — the honest fallback
 * named in the fix plan. `null` when the read produced no geometry at all.
 */
function readImageSize(blocks: readonly OcrBlock[]): OcrImageSize | null {
  let width = 0;
  let height = 0;
  for (const block of blocks) {
    if (!block.frame) continue;
    width = Math.max(width, block.frame.x + block.frame.width);
    height = Math.max(height, block.frame.y + block.frame.height);
  }
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Read the words on a cover photo. The uri is a local file uri from
 * expo-camera's `takePictureAsync`; nothing about it leaves the device.
 */
export async function readCoverText(photoUri: string): Promise<CoverOcrRead> {
  if (typeof photoUri !== 'string' || photoUri.length === 0) {
    return { text: '', failed: true, reason: 'no-photo', blocks: [], imageSize: null };
  }
  try {
    const result = await TextRecognition.recognize(photoUri);
    // The text is the recogniser's OWN output. Nothing is synthesised here: no
    // filename, no placeholder, no guess — an empty read stays empty and the
    // caller shows its honest "no title found" line.
    const text = typeof result?.text === 'string' ? result.text : '';
    const blocks = readBlocks(result);
    return { text, failed: false, reason: null, blocks, imageSize: readImageSize(blocks) };
  } catch (err) {
    // A native module that is not linked (or a recogniser that rejects the image)
    // must not take the scan screen down with it: the user gets the honest
    // failure line and the typed search, which is one tap away.
    const reason =
      err instanceof Error && err.message ? err.message : 'recognize-failed';
    return { text: '', failed: true, reason, blocks: [], imageSize: null };
  }
}
