/**
 * toneSourceLadder.ts — HOW A BUNDLED TONE IS ACTUALLY FOUND ON AN ANDROID
 * RELEASE BUILD (v34, root-caused from the v33 binary + the shipped JS bundle).
 *
 * THE FINDING. The tone-bank WAVs are `require()`d, so Metro hands their bytes to
 * the Android build's asset step. In the v33 AAB the tones are packaged as
 * `res/raw/assets_tones_<instrument>_m<midi>.wav` (185 files, verified in
 * /home/team/shared/notesnap-v33-0.1.27.aab). At RUNTIME, the identifier the app
 * computes for that same asset strips the `assets_` prefix
 * (`@react-native/assets-registry/path-support.js`: `.replace(/^assets_/, '')` —
 * the `/^assets_/` literal is present in the shipped `index.android.bundle`), so
 * the app asks for `tones_<instrument>_m<midi>` while the packaged resource is
 * named `assets_tones_<instrument>_m<midi>`.
 *
 * Both consumers of that identifier miss:
 *   • expo-asset's Android copy (`AssetModule.downloadAsync` →
 *     `openAssetResourceStream` → `res/raw` lookup by identifier) throws, and
 *     expo-av's `downloadFirst` path AWAITS it — so `Audio.Sound.createAsync`
 *     rejects before any playback is attempted;
 *   • expo-av's own MediaPlayer fallback does the same lookup
 *     (`MediaPlayerData.java`: `getIdentifier(uri, "raw", pkg)`, then
 *     `android.resource://<pkg>/<id>` — id 0 when the name misses).
 * The caller's `catch` then swallowed the throw, which is why the owner heard
 * "no piano sounds, no string sounds, no guitar sounds" with no error anywhere.
 *
 * THE WAY OUT. A scheme-qualified `android.resource://<pkg>/raw/<name>` URI skips
 * BOTH identifier computations: MediaPlayerData passes it straight to
 * `MediaPlayer.setDataSource(context, uri, …)`, which resolves it through
 * ContentResolver. So the ladder tries the plain module id first (the correct
 * path on iOS, in dev, and on any build where the names agree), then the two
 * scheme-qualified resource names — the packaged one (`assets_…`, what the AAB
 * actually contains) and the stripped one — and remembers which rung worked so
 * the cost is paid once per pitch, not once per note.
 *
 * PURE: no react, no react-native, no expo, no fs. Asserted by
 * scripts/v34Fixes.test.ts (naming, ladder order, package-name handling) and
 * scanned live by scripts/v34UiWiring.test.ts (the player really walks the
 * ladder, and reports when every rung fails).
 */

/** The bank's folder inside the project (Metro's `httpServerLocation`). */
export const TONE_ASSET_FOLDER = 'assets/tones';
/**
 * The prefix the RN asset step adds on Android when it packages a non-drawable
 * asset into `res/raw` — verified in the v33 AAB, where every tone is
 * `res/raw/assets_tones_<instrument>_m<midi>.wav`.
 */
export const ANDROID_RAW_ASSET_PREFIX = 'assets_';

/** How a tone's bytes are addressed. The ladder is ordered by preference. */
export type ToneSourceKind =
  /** `require()`'s module id — expo-asset copies it (works on iOS / in dev). */
  | 'module'
  /** `android.resource://<pkg>/raw/assets_…` — the name the AAB really ships. */
  | 'android-resource-packaged'
  /** `android.resource://<pkg>/raw/tones_…` — the identifier RN computes. */
  | 'android-resource-stripped';

/** The ladder, in the order the player walks it. */
export const TONE_SOURCE_ORDER: readonly ToneSourceKind[] = [
  'module',
  'android-resource-packaged',
  'android-resource-stripped',
];

/** `tones_piano_m60` — the stem the runtime identifier resolves to. */
export function toneResourceStem(instrument: string, midi: number): string {
  const pitch = Math.round(Number(midi));
  const safe = Number.isFinite(pitch) ? pitch : 0;
  return `tones_${String(instrument).toLowerCase()}_m${safe}`;
}

/** `assets_tones_piano_m60` — the resource name the AAB ships in `res/raw/`. */
export function tonePackagedResourceName(instrument: string, midi: number): string {
  return `${ANDROID_RAW_ASSET_PREFIX}${toneResourceStem(instrument, midi)}`;
}

/**
 * `android.resource://com.notesnap.sheetmusic/raw/assets_tones_piano_m60`.
 * Returns null when the package name is unknown — the caller then simply has one
 * rung fewer, never a malformed URI that could be sent to the player.
 */
export function androidResourceUri(
  packageName: string | null | undefined,
  resourceName: string,
): string | null {
  if (typeof packageName !== 'string') return null;
  const trimmed = packageName.trim();
  if (trimmed.length === 0) return null;
  if (typeof resourceName !== 'string' || resourceName.length === 0) return null;
  return `android.resource://${trimmed}/raw/${resourceName}`;
}

/** One rung of the ladder: what to hand expo-av, and what to say about it. */
export interface ToneSourceRung {
  kind: ToneSourceKind;
  /** The value passed to `Audio.Sound.createAsync` (a module id or a `{uri}`). */
  source: number | { uri: string };
}

/**
 * The rungs for one tone, in preference order. `moduleId` is the `require()`d
 * value (a number in a real bundle); when it is not a number the module rung is
 * dropped rather than passing junk to the player.
 */
export function toneSourceLadder(input: {
  instrument: string;
  midi: number;
  moduleId: number | null | undefined;
  packageName?: string | null;
  /** Android only: the resource rungs are meaningless elsewhere. */
  android?: boolean;
}): ToneSourceRung[] {
  const rungs: ToneSourceRung[] = [];
  if (typeof input.moduleId === 'number') {
    rungs.push({ kind: 'module', source: input.moduleId });
  }
  if (input.android !== false) {
    const packaged = androidResourceUri(
      input.packageName,
      tonePackagedResourceName(input.instrument, input.midi),
    );
    if (packaged) rungs.push({ kind: 'android-resource-packaged', source: { uri: packaged } });
    const stripped = androidResourceUri(
      input.packageName,
      toneResourceStem(input.instrument, input.midi),
    );
    if (stripped) rungs.push({ kind: 'android-resource-stripped', source: { uri: stripped } });
  }
  return rungs;
}

/**
 * Put the rung that already worked first. A known-good rung is tried before the
 * default order so a working build never re-pays the failed rungs' cost, and an
 * unknown/absent preference leaves the default order untouched.
 */
export function orderToneSourceLadder(
  rungs: ReadonlyArray<ToneSourceRung>,
  preferred: ToneSourceKind | null | undefined,
): ToneSourceRung[] {
  const list = Array.from(rungs);
  if (!preferred) return sortByOrder(list);
  const hit = list.find((rung) => rung.kind === preferred);
  if (!hit) return sortByOrder(list);
  return [hit, ...sortByOrder(list.filter((rung) => rung.kind !== preferred))];
}

function sortByOrder(rungs: ReadonlyArray<ToneSourceRung>): ToneSourceRung[] {
  return Array.from(rungs).sort(
    (a, b) => TONE_SOURCE_ORDER.indexOf(a.kind) - TONE_SOURCE_ORDER.indexOf(b.kind),
  );
}

/** A one-line description of a rung, for the diagnostics detail (never the UI). */
export function describeToneSourceRung(rung: ToneSourceRung): string {
  if (rung.kind === 'module') return 'module';
  const uri = typeof rung.source === 'object' ? rung.source.uri : '';
  return `${rung.kind}:${uri}`;
}
