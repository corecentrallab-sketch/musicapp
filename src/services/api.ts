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
} from "../types";
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

/**
 * Upload an audio recording for recognition.
 * Sends the anonymous device id as x-user-id so the server can apply
 * subscription-based (Pro) limits instead of per-IP limits.
 */ export async function recognizeAudio(
  audioUri: string,
): Promise<RecognitionResponse> {
  const formData = new FormData();
  formData.append("audio", {
    uri: audioUri,
    name: "recording.m4a",
    type: "audio/mp4",
  } as unknown as Blob);

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
