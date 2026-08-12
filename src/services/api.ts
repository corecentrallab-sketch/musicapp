/**
 * NoteSnap API client.
 *
 * Communicates with the site server for recognition and checkout.
 * The base URL defaults to the production site; override for local dev.
 */
import type { RecognitionResponse, RecognitionError } from "../types";

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
 */ export async function recognizeAudio(
  audioUri: string,
): Promise<RecognitionResponse> {
  const formData = new FormData();
  formData.append("audio", {
    uri: audioUri,
    name: "recording.ogg",
    type: "audio/ogg",
  } as unknown as Blob);

  const response = await fetch(`${BASE_URL}/api/recognize`, {
    method: "POST",
    body: formData,
    headers: { Accept: "application/json" },
  });

  const json: RecognitionResponse | RecognitionError = await response.json();

  if (!json.success) {
    throw new Error(json.error || "Recognition failed");
  }

  return json;
}
