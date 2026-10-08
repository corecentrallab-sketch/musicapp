/**
 * Ambient declaration for the on-device text recogniser (v36 fix 4).
 *
 * `@react-native-ml-kit/text-recognition` ships its types as `index.ts` (its
 * package `main`), and on this box the app's `node_modules` is a shared symlink
 * that does not always carry it, so `tsc` cannot resolve the module for a
 * targeted check. This declaration states the small surface we actually use
 * (`recognize(uri)` → `{ text }`), matching the package's own README.
 *
 * It is a declaration only: it adds no runtime dependency, and when the package
 * IS installed (EAS installs it from package.json/package-lock.json, and
 * autolinking registers the native module) the real implementation is what runs.
 * The mapping is asserted by scripts/v33UiWiring.test.ts against the module id in
 * services/coverScanOcr.ts.
 */
declare module '@react-native-ml-kit/text-recognition' {
  export interface TextRecognitionResult {
    /** The recognized text in the image (lines joined with newlines). */
    text: string;
    /** Recognized text blocks; unused by NoteSnap, declared for completeness. */
    blocks: unknown[];
  }

  const TextRecognition: {
    /**
     * Recognize text in the image at `imageURL` (a local file uri on device).
     * Rejects when the native recogniser is unavailable or cannot read the image.
     */
    recognize: (
      imageURL: string,
      script?: string,
    ) => Promise<TextRecognitionResult>;
  };

  export default TextRecognition;
}
