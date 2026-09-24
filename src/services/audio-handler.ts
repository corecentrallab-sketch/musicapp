/**
 * Public practice-audio proxy — serves curated public-domain score audio from R2.
 *
 * R2's S3 endpoint requires signed requests, so a raw `https://…r2.cloudflare…/`
 * URL is NOT publicly fetchable (400 for anonymous GET). The app's expo-av
 * practice player needs a plain remote URI, so this route streams the object
 * from R2 server-side (credentials live in the site env) and returns it with
 * `audio/wav` content-type, CORS and a long immutable cache header.
 *
 * GET|HEAD /api/audio/<piece-id>.wav
 *   piece-id — uuid of the piece (the R2 object key is `audio/<piece-id>.wav`)
 *
 * Mirrors the sheet-music proxy (src/services/sheet-handler.ts). Standing
 * copyright rule: only clearly public-domain renders are stored/uploaded.
 *
 * ---------------------------------------------------------------------------
 * PRE-LAUNCH PASS 2026-09-24 — why HEAD is here
 * ---------------------------------------------------------------------------
 * This route carried the same defect PR #120 fixed for scores: both server
 * entries routed it with `req.method === "GET"`, so a HEAD request (what every
 * uptime/link monitor and the app's "is this audio there?" probe sends) fell
 * through to SSR and came back **404 `text/html`** — i.e. every practice-audio
 * URL reported broken while GET returned 200 `audio/wav` (live evidence: GET
 * `5e74d931-….wav` → 200 / 18 088 236 bytes / `audio/wav`, HEAD → 404
 * `text/html`). The scores route answered HEAD 200 at the same moment, which is
 * what made the audio gap obvious.
 *
 * HEAD now takes the same route as GET and returns the same status + headers
 * (via HeadObject, so an 18 MB WAV body is never transferred) with an empty
 * body, as the HTTP spec requires.
 *
 * The route guard lives in `isAudioServeMethod` so BOTH entries share one
 * definition; `audio-handler.test.ts` scans them (the bug class is "an entry
 * guard forgot a method", which no unit test of the handler can see).
 */
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

let _s3: S3Client | null = null;
function getS3(): S3Client | null {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  if (!_s3) {
    _s3 = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }
  return _s3;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

/** Methods a practice-audio URL answers: GET streams the WAV, HEAD only its metadata. */
export type AudioServeMethod = "GET" | "HEAD";

/**
 * The ONE route guard for audio URLs, used by both server entries (Bun
 * `serve.ts` and the Vercel function entry) so a method can never be routed in
 * one and dropped in the other.
 */
export function isAudioServeMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

/**
 * Result of fetching an audio object.
 *   ok:true              — `body` is null for HEAD (metadata only), never for GET
 *   reason:"missing"     — no such object → 404
 *   reason:"unavailable" — R2 not configured → 503 (same answer GET gives)
 */
export type AudioFetchResult =
  | { ok: true; body: BodyInit | null; contentLength?: number }
  | { ok: false; reason: "missing" | "unavailable" };

export type AudioObjectFetcher = (
  key: string,
  method: AudioServeMethod,
) => Promise<AudioFetchResult>;

async function fetchAudioObjectFromR2(
  key: string,
  method: AudioServeMethod,
): Promise<AudioFetchResult> {
  const s3 = getS3();
  if (!s3) {
    console.error("[audio] R2 env not configured");
    return { ok: false, reason: "unavailable" };
  }
  const Bucket = process.env.R2_BUCKET_NAME || "notesnapscores";
  try {
    if (method === "HEAD") {
      // Metadata only — a probe must not pull an 18 MB WAV per piece.
      const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
      return { ok: true, body: null, contentLength: head.ContentLength };
    }
    const obj = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
    const body = obj.Body as ReadableStream | undefined;
    if (!body) throw new Error("empty body");
    return { ok: true, body: body as unknown as BodyInit };
  } catch (err) {
    console.error("[audio] fetch failed", key, String(err).slice(0, 200));
    return { ok: false, reason: "missing" };
  }
}

let fetchObject: AudioObjectFetcher = fetchAudioObjectFromR2;

/**
 * Swap the R2 accessor. Tests inject a fake here so the 200/HEAD/404/503
 * behaviour is asserted without live R2 credentials or network; production never
 * calls it (a null argument restores the real accessor).
 */
export function setAudioObjectFetcher(fetcher: AudioObjectFetcher | null): void {
  fetchObject = fetcher ?? fetchAudioObjectFromR2;
}

export async function handleAudioServe(req: Request): Promise<Response> {
  const method = (req.method || "GET").toUpperCase();
  if (!isAudioServeMethod(method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: "GET, HEAD" },
    });
  }

  const { pathname } = new URL(req.url);
  // /api/audio/<uuid>.wav
  const m = pathname.match(/^\/api\/audio\/([0-9a-f-]{36})\.wav$/i);
  if (!m) {
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }
  const pieceId = m[1].toLowerCase();
  const result = await fetchObject(`audio/${pieceId}.wav`, method as AudioServeMethod);

  if (!result.ok) {
    return result.reason === "unavailable"
      ? new Response("Audio unavailable", { status: 503, headers: CORS_HEADERS })
      : new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }

  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": "audio/wav",
    "Content-Disposition": `inline; filename="${pieceId}.wav"`,
    "Cache-Control":
      process.env.NODE_ENV === "production"
        ? "public, max-age=31536000, immutable"
        : "no-cache",
  };
  if (result.contentLength != null) {
    headers["Content-Length"] = String(result.contentLength);
  }

  // HEAD: identical status and headers to GET, no body.
  return new Response(method === "HEAD" ? null : (result.body as BodyInit), {
    status: 200,
    headers,
  });
}
