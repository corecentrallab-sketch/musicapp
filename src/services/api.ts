/**
 * NoteSnap API client.
 *
 * Communicates with the recognition endpoint running on the site server.
 * The base URL is configurable — defaults to localhost:3000 for development
 * but should be set to the production URL when going live.
 */

import type { RecognitionResponse, RecognitionError } from "../types";

/** Override with the live site URL in production. */
let BASE_URL = "https://site-ten-sigma-27.vercel.app";

export function setApiBaseUrl(url: string): void {
  BASE_URL = url.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  return BASE_URL;
}

/**
 * Upload an audio recording for recognition.
 *
 * Sends the audio file as multipart/form-data to POST /api/recognize.
 * Returns the parsed response on success, or throws with a user-friendly
 * message on failure.
 */
export async function recognizeAudio(
  audioUri: string,
): Promise<RecognitionResponse> {
  const formData = new FormData();

  // React Native's FormData accepts { uri, name, type } for file uploads
  formData.append("audio", {
    uri: audioUri,
    name: "recording.ogg",
    type: "audio/ogg",
  } as unknown as Blob);

  const response = await fetch(`${BASE_URL}/api/recognize`, {
    method: "POST",
    body: formData,
    headers: {
      // Don't set Content-Type — fetch sets it with the boundary for multipart
      Accept: "application/json",
    },
  });

  const json: RecognitionResponse | RecognitionError = await response.json();

  if (!json.success) {
    throw new Error(json.error || "Recognition failed");
  }

  return json;
}
