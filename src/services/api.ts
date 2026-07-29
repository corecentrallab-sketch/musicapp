/**
 * NoteSnap API client.
 *
 * Communicates with the site server for recognition and checkout.
 * The base URL defaults to the production site; override for local dev.
 */
import type { RecognitionResponse, RecognitionError, CheckoutSessionResponse } from "../types";

/** Production NoteSnap site URL. */
let BASE_URL = "https://site-mmafqjfbo-notesnap.vercel.app";

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

/**
 * Create a Stripe Checkout Session for a subscription plan.
 *
 * Returns the Checkout URL that should be opened in the browser
 * (via expo-web-browser or similar).
 */
export async function createCheckoutSession(
  priceId: string,
): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priceId }),
  });

  const json: CheckoutSessionResponse = await response.json();

  if (!json.url) {
    throw new Error(
      (json as { error?: string }).error || "Failed to create checkout session",
    );
  }

  return json.url;
}
