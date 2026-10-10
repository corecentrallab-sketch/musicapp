/**
 * videoSendDevice.ts — THE DEVICE HALF OF THE PRACTICE-VIDEO EXPORT (owner GO
 * 10-10, decision 5; backlog a49fbe2d; design brief §4.4).
 *
 * THE TWO THINGS THIS FILE MOVES, AND NOTHING ELSE:
 *
 *   • THE PRACTICE VIDEO — the .mp4 the user filmed, handed to the PLATFORM's
 *     share sheet (`expo-sharing`). It is already a DOCUMENTS file (the store
 *     copied it out of the camera's cache before any row referenced it), so there
 *     is no write here, no re-encode and no upload.
 *   • THE PLAIN SUMMARY — text, through React Native's own `Share`, when the
 *     platform cannot attach a file. `videoSummaryText` writes it and it carries
 *     the pair line and the v37 honesty line verbatim.
 *
 * WHAT IS DELIBERATELY NOT HERE. The PDF is NOT rebuilt: the surface calls the
 * existing v37 export (`takeSendDevice.exportTakePdfFromTake`), so there is one
 * PDF engine and one MIDI path. Nothing here opens a socket: no fetch, no
 * endpoint, no mail service — the user's own apps do the sending, which is what
 * makes "nothing is emailed from our side" a property of the code.
 *
 * NO DEAD AREAS: `videoSendPlan` decides file / text / nothing, and a record with
 * no video and no take is refused with the honest line instead of a button that
 * can only fail.
 *
 * Not tier1-compiled on purpose (it imports expo-sharing / react-native), exactly
 * like takeSendDevice.ts. The decisions live in videoSendTo.ts, which IS
 * tier1-compiled.
 */
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import {
  SEND_TO_HONESTY,
  takeHasSomethingToSend,
  type SendToStatus,
} from './takeSendTo';
import {
  VIDEO_SEND_EMPTY_LINE,
  videoSendOutcomeMessage,
  videoSendPlan,
  videoSummaryText,
  type VideoSendKind,
  type VideoSendRecord,
} from './videoSendTo';
import {
  practiceVideoIsUsable,
  videoMimeByExt,
  videoUtiByExt,
} from './practiceVideoRef';

/** What a practice-video send did, with the sentence the surface renders. */
export interface VideoSendOutcome {
  status: SendToStatus;
  kind: VideoSendKind;
  /** The file handed to the share sheet (present only for the video action). */
  fileUri?: string;
  message: string;
}

/** Injectable so the seam can be tested / swapped without touching the UI. */
export interface VideoSendDeps {
  /** Whether this device has a share sheet at all (default: expo-sharing). */
  shareSheetAvailable?: () => Promise<boolean>;
  /** Hand a FILE to the OS (default: expo-sharing). */
  shareFile?: (fileUri: string, title: string, mime: string, uti: string) => Promise<SendToStatus | void>;
  /** Hand TEXT to the OS (default: React Native Share). */
  shareText?: (title: string, text: string) => Promise<SendToStatus | void>;
}

export interface VideoSendOptions {
  title?: string | null;
  deps?: VideoSendDeps;
}

/** Hand the practice video to the OS share sheet — the ONLY way it leaves. */
export async function sharePracticeVideo(
  fileUri: string,
  title: string,
  mime: string,
  uti: string,
): Promise<SendToStatus> {
  await Sharing.shareAsync(fileUri, {
    mimeType: mime,
    UTI: uti,
    dialogTitle: title,
  });
  return 'shared';
}

/** Share the plain summary through the OS sheet (text, not a file). */
export async function sharePracticeSummary(title: string, text: string): Promise<SendToStatus> {
  const result = await Share.share({ title, message: text });
  return (result as { action?: string } | undefined)?.action === Share.dismissedAction
    ? 'dismissed'
    : 'shared';
}

async function shareSheetAvailable(deps: VideoSendDeps): Promise<boolean> {
  const check = deps.shareSheetAvailable ?? Sharing.isAvailableAsync;
  try {
    return Boolean(await check());
  } catch {
    return false;
  }
}

/** Is there anything at all to send from this recording? (the no-dead-area gate) */
export function practiceRecordHasSomethingToSend(
  rec: VideoSendRecord | null | undefined,
): boolean {
  return practiceVideoIsUsable(rec?.video ?? null) || takeHasSomethingToSend(rec?.take ?? null);
}

/**
 * SEND THE PRACTICE VIDEO. Never throws: a record with nothing in it, a device
 * with no share sheet and a share sheet that failed are three different, honest
 * outcomes, each with a sentence the surface prints.
 */
export async function sendPracticeVideo(
  rec: VideoSendRecord | null | undefined,
  opts: VideoSendOptions = {},
): Promise<VideoSendOutcome> {
  const deps = opts.deps ?? {};
  const video = rec?.video ?? null;
  const hasTake = takeHasSomethingToSend(rec?.take ?? null);
  const hasVideo = practiceVideoIsUsable(video);
  if (!hasVideo && !hasTake) {
    return { status: 'failed', kind: 'video', message: VIDEO_SEND_EMPTY_LINE };
  }
  if (!hasVideo) {
    return { status: 'failed', kind: 'video', message: VIDEO_SEND_EMPTY_LINE };
  }

  const available = await shareSheetAvailable(deps);
  const plan = videoSendPlan({ hasVideo, hasTake, shareSheetAvailable: available });
  if (plan.mode === 'none') {
    return { status: 'unavailable', kind: 'video', message: plan.reason };
  }
  if (plan.mode === 'text') {
    // A device without a file-capable sheet still gets the video's facts out.
    return sendPracticeSummary(rec, opts);
  }

  try {
    const share = deps.shareFile ?? sharePracticeVideo;
    const uri = video.uri;
    const status = (await share(uri, opts.title ?? 'Your practice video', videoMimeByExt(uri), videoUtiByExt(uri))) ?? 'shared';
    return {
      status: status === 'dismissed' ? 'dismissed' : 'shared',
      kind: 'video',
      fileUri: uri,
      message: videoSendOutcomeMessage(status === 'dismissed' ? 'dismissed' : 'shared', 'video'),
    };
  } catch (err) {
    return {
      status: 'failed',
      kind: 'video',
      message: err instanceof Error && err.message ? err.message : videoSendOutcomeMessage('failed', 'video'),
    };
  }
}

/**
 * SEND THE PLAIN SUMMARY (text). It is the honest fallback AND a destination of
 * its own: the take's facts, the pair line, and the words that never claim the
 * video carries notes.
 */
export async function sendPracticeSummary(
  rec: VideoSendRecord | null | undefined,
  opts: VideoSendOptions = {},
): Promise<VideoSendOutcome> {
  const deps = opts.deps ?? {};
  if (!practiceRecordHasSomethingToSend(rec)) {
    return { status: 'failed', kind: 'summary', message: VIDEO_SEND_EMPTY_LINE };
  }
  const title = opts.title ?? 'My practice take';
  const text = `${videoSummaryText(rec, { title })}\n\n${SEND_TO_HONESTY}`;
  try {
    const share = deps.shareText ?? sharePracticeSummary;
    const status = (await share(title, text)) ?? 'shared';
    return {
      status: status === 'dismissed' ? 'dismissed' : 'shared',
      kind: 'summary',
      message: videoSendOutcomeMessage(status === 'dismissed' ? 'dismissed' : 'shared', 'summary'),
    };
  } catch (err) {
    return {
      status: 'failed',
      kind: 'summary',
      message: err instanceof Error && err.message ? err.message : videoSendOutcomeMessage('failed', 'summary'),
    };
  }
}
