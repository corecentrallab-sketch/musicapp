/**
 * NoteSnap API client.
 *
 * Communicates with the site server for recognition and checkout.
 * The base URL defaults to the production site; override for local dev.
 */
import type {
  RecognitionResponse,
  RecognitionError,
  DailyChallengePiece,
  HumResponse,
  ModernResponse,
} from "../types";
import { parseHumResponse, parseModernResponse } from "./tier1";
import { getDeviceId } from "./device";

/** Production NoteSnap site URL (stable — the Vercel production alias; every deploy lands here). Set EXPO_PUBLIC_API_URL to override for local dev. */
let BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  "https://site-notesnap.vercel.app";

export function setApiBaseUrl(url: string): void {
  BASE_URL = url.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  return BASE_URL;
}

/** Map a file extension to a sensible MIME type for the recognition upload. */
const MIME_BY_EXT: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  caf: 'audio/x-caf',
  wav: 'audio/wav',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  '3gp': 'audio/3gpp',
};

/** Lower-case extension (no dot, no query string) of a local file URI. */
function extensionOf(uri: string): string {
  const tail = (uri.split('/').pop() ?? uri).split('?')[0];
  const m = /\.([a-zA-Z0-9]+)$/.exec(tail);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Build the multipart file part for a recorded clip using the REAL extension
 * and a matching MIME type taken from the file, rather than a hardcoded label.
 * The recorder always produces a .m4a AAC clip today, but deriving it from the
 * actual URI keeps the label honest if that ever changes — and the backend
 * additionally sniffs the bytes, so the label is informational, not trusted.
 */
function buildAudioFilePart(
  audioUri: string,
): { uri: string; name: string; type: string } {
  const ext = extensionOf(audioUri);
  const tail = (audioUri.split('/').pop() ?? 'recording').split('?')[0];
  // Preserve the real filename if present; otherwise fall back to recording.<ext>.
  const name = /\./.test(tail) && tail.length > 0 ? tail : `recording.${ext || 'm4a'}`;
  const type = MIME_BY_EXT[ext] ?? 'audio/mp4';
  return { uri: audioUri, name, type };
}

/**
 * Thrown when the free-tier monthly recognition quota is exhausted
 * (backend HTTP 429). The UI MUST surface this as an explicit "limit reached"
 * state — never as a generic "No Match Found" or a bare network error.
 * Backend error message (e.g. "Monthly recognition limit reached (5/month).
 * Upgrade to Pro for unlimited.") is preserved verbatim as the message.
 */
export class RecognitionLimitError extends Error {
  readonly statusCode = 429;
  constructor(message: string) {
    super(message);
    this.name = "RecognitionLimitError";
  }
}

/** Narrowing guard so callers can branch on the quota-exhausted error. */
export function isRecognitionLimitError(
  err: unknown,
): err is RecognitionLimitError {
  return err instanceof RecognitionLimitError;
}

/**
 * Upload an audio recording for recognition.
 * Sends the anonymous device id as x-user-id so the server can apply
 * subscription-based (Pro) limits instead of per-IP limits.
 */
export async function recognizeAudio(
  audioUri: string,
): Promise<RecognitionResponse> {
  const formData = new FormData();
  const filePart = buildAudioFilePart(audioUri);
  formData.append("audio", filePart as unknown as Blob);

  const deviceId = await getDeviceId();

  // 30s cap so a stalled server fails fast instead of hanging the spinner.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api/recognize`, {
      method: "POST",
      body: formData,
      headers: { Accept: "application/json", "x-user-id": deviceId },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Recognition took too long. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // Prefer the backend's JSON error (e.g. 400 "Could not process audio");
    // fall back to a generic message when the body isn't JSON (502/HTML).
    let errBody: RecognitionError | null = null;
    try {
      errBody = (await response.json()) as RecognitionError;
    } catch {
      errBody = null;
    }
    // 429 = free-tier monthly quota exhausted. Throw the dedicated limit error
    // so the UI can render an explicit, honest "limit reached" modal instead of
    // a generic failure. NEVER let this path look like "No Match Found".
    if (response.status === 429) {
      throw new RecognitionLimitError(
        errBody?.error ||
          "You've reached your free recognition limit for this month. Upgrade to Pro for unlimited, or try again next month.",
      );
    }
    throw new Error(errBody?.error || "Something went wrong. Please try again.");
  }

  let json: RecognitionResponse | RecognitionError;
  try {
    json = await response.json();
  } catch {
    throw new Error("Something went wrong. Please try again.");
  }

  if (!json.success) {
    throw new Error(json.error || "Recognition failed");
  }

  return json;
}

/**
 * Shared multipart upload for the Tier-1 endpoints (/api/hum and
 * /api/recognize-modern). Builds the same audio file part and device-id header
 * as recognizeAudio, POSTs to `path` with the given multipart `fieldName`, then
 * returns the parsed JSON body (raw) or throws a user-facing Error. A 429 is
 * surfaced as a RecognitionLimitError so the UI can show the honest free-tier
 * limit state for these flows too.
 */
async function postAudioMultipart(
  audioUri: string,
  path: string,
  fieldName: string,
): Promise<unknown> {
  const formData = new FormData();
  const filePart = buildAudioFilePart(audioUri);
  formData.append(fieldName, filePart as unknown as Blob);

  const deviceId = await getDeviceId();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      body: formData,
      headers: { Accept: "application/json", "x-user-id": deviceId },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request took too long. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let errBody: RecognitionError | null = null;
    try {
      errBody = (await response.json()) as RecognitionError;
    } catch {
      errBody = null;
    }
    if (response.status === 429) {
      throw new RecognitionLimitError(
        errBody?.error ||
          "You've reached your free recognition limit for this month. Upgrade to Pro for unlimited, or try again next month.",
      );
    }
    throw new Error(errBody?.error || "Something went wrong. Please try again.");
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error("Something went wrong. Please try again.");
  }
  return json;
}

/**
 * POST /api/hum — hum/whistle/sing-to-search (the SoundHound-style Tier-1
 * differentiator). Uploads the recorded clip as multipart field `audio` (the
 * same field name as /api/recognize) and returns the normalized response. The
 * honest match/no-match decision lives in tier1.ts.
 */
export async function humToSearch(audioUri: string): Promise<HumResponse> {
  const json = await postAudioMultipart(audioUri, "/api/hum", "audio");
  const parsed = parseHumResponse(json);
  if (!parsed) {
    throw new Error("Couldn't read the hum-to-search result. Please try again.");
  }
  return parsed;
}

/**
 * POST /api/recognize-modern — modern-song recognition (the Tier-1
 * recognize→buy funnel). IMPORTANT GOTCHA: this endpoint expects the multipart
 * field named `file` (NOT `audio`). Returns normalized metadata for a
 * recognized copyrighted song (or an honest no-match). We never host or
 * provide any copyrighted file — only identity + metadata + a retailer link.
 */
export async function recognizeModernSong(
  audioUri: string,
): Promise<ModernResponse> {
  const json = await postAudioMultipart(
    audioUri,
    "/api/recognize-modern",
    "file",
  );
  const parsed = parseModernResponse(json);
  if (!parsed) {
    throw new Error("Couldn't read the recognition result. Please try again.");
  }
  return parsed;
}

/**
 * GET /api/daily-challenge — today's deterministic featured piece from the live
 * catalog. Returns null (never throws) when the endpoint is unreachable or the
 * response is malformed, so the Home card can show a retry state instead of a
 * placeholder piece.
 */
export async function fetchDailyChallenge(): Promise<DailyChallengePiece | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE_URL}/api/daily-challenge`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    if (!json || typeof json !== "object") return null;
    const d = json as Record<string, unknown>;
    if (!d.piece_id || !d.title) return null;
    return {
      id: String(d.piece_id),
      title: String(d.title),
      composer: String(d.composer ?? ""),
      genre: d.genre ? String(d.genre) : "Classical",
      difficulty: d.difficulty_label
        ? String(d.difficulty_label)
        : "Intermediate",
      sheetMusicUrl: d.sheet_music_url ? String(d.sheet_music_url) : undefined,
      audioUrl: d.audio_url ? String(d.audio_url) : undefined,
      isPublicDomain: !!d.is_public_domain,
      sheetMusicAvailable: !!d.sheet_music_available,
      difficultyGrade:
        typeof d.difficulty === "number" ? d.difficulty : null,
      catalog: d.catalog ? String(d.catalog) : null,
      challengeDate: d.date ? String(d.date) : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Start a Stripe Checkout session for the given plan (price id) and device.
 * Returns the hosted checkout URL to open in a browser.
 */
export async function createCheckoutSession(
  priceId: string,
  deviceId: string,
): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      priceId,
      deviceId,
      successUrl: `${BASE_URL}/subscription/success`,
      cancelUrl: `${BASE_URL}/subscription/cancel`,
    }),
  });

  const json = (await response.json()) as { url?: string; error?: string };
  if (!response.ok || !json.url) {
    throw new Error(json.error || "Could not start checkout.");
  }
  return json.url;
}

/** Entitlement state returned by GET /api/entitlement. */
export interface EntitlementStatus {
  pro: boolean;
  plan: string | null;
  currentPeriodEnd: string | null;
}

/** Check whether the device currently has an active (Pro) subscription. */
export async function checkEntitlement(
  deviceId: string,
): Promise<EntitlementStatus> {
  const response = await fetch(
    `${BASE_URL}/api/entitlement?device=${encodeURIComponent(deviceId)}`,
    { headers: { Accept: "application/json" } },
  );
  const json = (await response.json()) as EntitlementStatus & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(json.error || "Could not check subscription status.");
  }
  return { pro: !!json.pro, plan: json.plan ?? null, currentPeriodEnd: json.currentPeriodEnd ?? null };
}
