/**
 * cloudImport.ts — WHAT THE CLOUD CARDS REALLY DO, IN ONE PLACE (v39 fix 2, owner
 * 10-11; backlog from the "cloud sync" card review).
 *
 * TWO OWNER FINDINGS, ONE FILE:
 *
 * 1. THE COPY WAS INCOHERENT AND OVERCLAIMED. The cloud-sync card ended with
 *    "Sync merges by file name and size — two way, last-wins on conflict???". What
 *    the build actually offers today is IMPORT: the user picks files from their
 *    cloud storage and they are COPIED into the app's Library, where they open
 *    offline. Nothing runs in the background, nothing reconciles two copies, and a
 *    conflict rule belongs to the merge window the owner asked to be a SEPARATE
 *    window (scope noted, not built). So the claim is gone and the honest sentences
 *    live here, where the copy cannot drift from them.
 *
 * 2. THE CARDS BELOW IT WERE NOT FUNCTIONAL. Connector rows only did anything when
 *    the owner had put a Dropbox app key / Google client id into the build; with no
 *    keys the rows showed "Not configured yet" and no action at all — a dead card,
 *    which the release gate forbids ("no dead areas", 09-28). Every card now leads
 *    with a REAL action that needs no key: `Import from Dropbox` / `Import from
 *    Google Drive` opens the phone's own file picker (where those providers are
 *    available as sources) and the picked files go into the Library through the
 *    Library's own write path. The key-based connector row stays for a build that
 *    has keys — as an EXTRA, never as the only way in.
 *
 * HONESTY RULES THIS MODULE ENFORCES (and the tier1 suite proves):
 *   • no rendered sentence may claim a live/automatic/merging sync
 *     (`CLOUD_SYNC_BANNED_CLAIMS`) — the guard is a regex list, so the words cannot
 *     come back through a rewrite;
 *   • the import sentence must name the phone's own picker (that is what opens);
 *   • the merge behaviour must be described as a separate, unbuilt window.
 *
 * PURE (no react / react-native / expo): the labels, the outcomes and the honesty
 * checks are asserted by scripts/v39OwnerRound.test.ts. The picker call itself
 * lives in services/cloudImportDevice.ts, which is NOT tier1-compiled for the
 * usual reason (native module), exactly like melodyStore.ts / coverScanOcr.ts.
 */

/** The card's title. Plain words for what the button does. */
export const CLOUD_IMPORT_TITLE = 'Import from your cloud storage';
/** Which cloud sources a file may come from — the user's own picker decides. */
export const CLOUD_IMPORT_BODY =
  'Your phone’s file picker opens here, with Dropbox, Google Drive and everything else on your device in it. Pick the scores you want and they are copied into your Library, where they open offline.';

/** The per-provider button. It names the provider AND the action honestly. */
export function cloudImportCtaLabel(provider: 'dropbox' | 'gdrive'): string {
  return provider === 'dropbox' ? 'Import from Dropbox' : 'Import from Google Drive';
}

/** Shown under the button, so nobody expects a background job to start. */
export const CLOUD_IMPORT_HINT =
  'Nothing runs in the background — files move when you pick them.';

/** The status line on a card while a cloud connector has no app key. */
export const CLOUD_CONNECTOR_NOT_CONFIGURED_LINE =
  'Sync connector not set up — importing works without it';
/** The honest sentence for the key-gated connector, when it IS set up. */
export const CLOUD_CONNECTOR_CONFIGURED_LINE =
  'Sync connector set up — you can also pull and push whole folders';

/**
 * THE LINE THAT REPLACED THE OVERCLAIM. It says what is NOT in this build in the
 * same breath as what is, and carries no merging/automatic claim of its own.
 */
export const CLOUD_SYNC_NOT_LIVE_LINE =
  'A live, automatic sync of your library is not part of this build. Import is the cloud feature that works today — it copies files into NoteSnap on this device.';

/**
 * THE SCOPE THE OWNER NAMED (10-11): reconciling copies belongs in its own window,
 * which has not been built. Stated as scope, never as a feature.
 */
export const CLOUD_MERGE_SCOPE_NOTE =
  'Comparing the copies on this phone and in your cloud, and deciding which one wins when they differ, is a separate window we have not built yet — so nothing here does it, or claims to.';

/** The outcome sentences the card shows after a picker run (never a silent no-op). */
export const CLOUD_IMPORT_EMPTY_LINE = 'Nothing was picked — your Library is unchanged.';
export const CLOUD_IMPORT_FAILED_LINE =
  'Those files could not be imported. Your Library is unchanged — please try again.';

/**
 * WHAT THIS APP CAN ACTUALLY OPEN (v40 fix F, owner 10-14: a `.jpg` was refused
 * and the card said nothing at all about why).
 *
 * The list is the Library's own `SUPPORTED_EXTENSIONS`
 * (services/libraryStore.ts: pdf, musicxml, mxl, xml, mid, midi, gp3, gp4, gp5,
 * gpx, gp, abc) written out in the words a user reads. It is spelled out here so
 * a refusal can carry it: "not a score this app can open" is only honest if the
 * surface also says which scores it CAN open. No promise of anything beyond that
 * list — no images, no audio, no video.
 */
export const CLOUD_IMPORT_SUPPORTED_TYPES_LINE =
  'NoteSnap opens scores: PDF, MusicXML (.musicxml, .mxl, .xml), MIDI (.mid, .midi), Guitar Pro (.gp, .gp3, .gp4, .gp5, .gpx) and ABC. Photos and other file types cannot be imported.';

/** The longest reason we will echo from the file layer (a message, not a stack). */
export const CLOUD_IMPORT_REASON_MAX_CHARS = 180;

/**
 * THE REASON, IN ONE LINE (v40 fix F). The Library's own refusal message
 * ("Unsupported file type. Supported formats: …", "… is not a supported score
 * format (… or an image).") is the truth about the file the user picked, so it is
 * carried to the card instead of being dropped. It is trimmed to one line and
 * bounded, and an empty/absent reason yields nothing rather than an empty bracket.
 */
export function cloudImportReasonLine(firstError?: string | null): string | null {
  if (typeof firstError !== 'string') return null;
  const oneLine = firstError.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) return null;
  return oneLine.length > CLOUD_IMPORT_REASON_MAX_CHARS
    ? `${oneLine.slice(0, CLOUD_IMPORT_REASON_MAX_CHARS - 1)}…`
    : oneLine;
}

/** What one picker run produced (the device half fills this in). */
export interface CloudImportOutcome {
  /** How many files landed in the Library. */
  imported: number;
  /** How many were refused (unsupported type, unreadable file). */
  skipped: number;
  /** True when the user closed the picker without choosing anything. */
  cancelled: boolean;
  /** The first real error, when one happened (never invented). */
  firstError?: string | null;
}

/**
 * The honest sentence for an outcome. Every path says something: a picker run that
 * imported nothing is explained rather than swallowed.
 */
export function cloudImportOutcomeLine(outcome: CloudImportOutcome): string {
  const skipped = Math.max(0, Math.round(outcome.skipped || 0));
  if (outcome.cancelled) return CLOUD_IMPORT_EMPTY_LINE;
  const imported = Math.max(0, Math.round(outcome.imported || 0));
  const reason = cloudImportReasonLine(outcome.firstError);
  if (imported === 0 && skipped === 0) {
    /**
     * NOTHING LANDED AND NOTHING WAS REFUSED (v40 fix F). The old line said
     * "your Library is unchanged" and dropped `firstError`, which is the only
     * place the real cause (an unreadable file, a storage error) was written.
     */
    return reason ? `${CLOUD_IMPORT_FAILED_LINE} ${reason}` : CLOUD_IMPORT_EMPTY_LINE;
  }
  /**
   * THE ZERO-IMPORT BRANCH (v40 fix F). It used to fall through to the "N files
   * are in your Library" wording with N = 0 — "0 files are in your Library" —
   * and never said why. Every refusal now names the reason AND what this app can
   * open, so a `.jpg` pick is explained instead of silently doing nothing.
   */
  if (imported === 0) {
    const refused =
      skipped === 1
        ? 'That file was not a score this app can open, so it was left out.'
        : `${skipped} files were not scores this app can open, so they were left out.`;
    return [refused, CLOUD_IMPORT_SUPPORTED_TYPES_LINE, reason]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' ');
  }
  const head =
    imported === 1
      ? '1 file is in your Library — it opens offline.'
      : `${imported} files are in your Library — they open offline.`;
  if (skipped === 0) return head;
  const refused = `${skipped} file${skipped === 1 ? ' was' : 's were'} not a score this app can open, so ${
    skipped === 1 ? 'it was' : 'they were'
  } left out.`;
  return [head, refused, CLOUD_IMPORT_SUPPORTED_TYPES_LINE, reason]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}

// ────────── THE HONESTY GUARDS (the copy cannot drift back) ──────────

/**
 * Claims this build cannot make. A rendered sentence matching ANY of these is a
 * lie about what runs: nothing in the build syncs in the background, nothing
 * merges two copies, and no conflict rule is applied.
 */
export const CLOUD_SYNC_BANNED_CLAIMS: readonly RegExp[] = [
  /two[- ]way/i,
  /last[- ]wins/i,
  /merg\w* by file ?name/i,
  /syncs? (your|the) library automatically/i,
  /auto[- ]?sync/i,
  /background sync/i,
];

/** True when one sentence the app renders is free of every banned claim. */
export function cloudCopyIsHonest(text: string | null | undefined): boolean {
  const value = typeof text === 'string' ? text : '';
  if (value.trim().length === 0) return true;
  return !CLOUD_SYNC_BANNED_CLAIMS.some((pattern) => pattern.test(value));
}

/** Every rendered sentence this module owns, as the card would read them. */
export function cloudCardCopy(provider: 'dropbox' | 'gdrive'): string[] {
  return [
    CLOUD_IMPORT_TITLE,
    CLOUD_IMPORT_BODY,
    cloudImportCtaLabel(provider),
    CLOUD_IMPORT_HINT,
    CLOUD_CONNECTOR_NOT_CONFIGURED_LINE,
    CLOUD_CONNECTOR_CONFIGURED_LINE,
    CLOUD_SYNC_NOT_LIVE_LINE,
    CLOUD_MERGE_SCOPE_NOTE,
    CLOUD_IMPORT_EMPTY_LINE,
    CLOUD_IMPORT_FAILED_LINE,
    // v40 fix F: the refusal's own explanation is copy this module owns, so the
    // honesty sweep judges it too.
    CLOUD_IMPORT_SUPPORTED_TYPES_LINE,
  ];
}

/** True when all of this module's own copy is honest. */
export function cloudImportCopyIsHonest(): boolean {
  return cloudCardCopy('dropbox').every(cloudCopyIsHonest) && cloudCardCopy('gdrive').every(cloudCopyIsHonest);
}

/** The markers the CloudSync screen must carry for the cards to be real. */
export const CLOUD_IMPORT_WIRING_MARKERS: readonly string[] = [
  'cloudImportCtaLabel(',
  'importFilesIntoLibrary(',
  'onPress={() => handleImport(',
  "renderProvider('dropbox'",
  "renderProvider('gdrive'",
  'CLOUD_SYNC_NOT_LIVE_LINE',
  'CLOUD_MERGE_SCOPE_NOTE',
  'CLOUD_IMPORT_HINT',
];

/**
 * True when the screen actually renders and wires the honest card: both provider
 * cards are rendered, each one's action reaches the real import call, the not-live
 * line and the merge scope are on the screen, and no banned claim appears in the
 * copy it renders.
 */
export function cloudCardsAreWired(screenSource: string): boolean {
  const source = typeof screenSource === 'string' ? screenSource : '';
  if (source.length < 3000) return false;
  for (const marker of CLOUD_IMPORT_WIRING_MARKERS) {
    if (source.indexOf(marker) < 0) return false;
  }
  // …and the copy the screen holds must be free of the banned claims.
  return cloudCopyIsHonest(stripComments(source));
}

/** Comments may discuss the old claim; only what renders is judged. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/^\s*(\/\/|\*).*$/, ' '))
    .join('\n');
}
