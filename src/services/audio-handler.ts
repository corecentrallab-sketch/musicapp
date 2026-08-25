/**
 * Public practice-audio proxy — serves curated public-domain score audio from R2.
 *
 * R2's S3 endpoint requires signed requests, so a raw `https://…r2.cloudflare…/`
 * URL is NOT publicly fetchable (400 for anonymous GET). The app's expo-av
 * practice player needs a plain remote URI, so this route streams the object
 * from R2 server-side (credentials live in the site env) and returns it with
 * `audio/wav` content-type, CORS and a long immutable cache header.
 *
 * GET /api/audio/<piece-id>.wav
 *   piece-id — uuid of the piece (the R2 object key is `audio/<piece-id>.wav`)
 *
 * Mirrors the sheet-music proxy (src/services/sheet-handler.ts). Standing
 * copyright rule: only clearly public-domain renders are stored/uploaded.
 */
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

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
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

export async function handleAudioServe(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  // /api/audio/<uuid>.wav
  const m = pathname.match(/^\/api\/audio\/([0-9a-f-]{36})\.wav$/i);
  if (!m) {
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }
  const pieceId = m[1].toLowerCase();
  const s3 = getS3();
  if (!s3) {
    console.error("[audio] R2 env not configured");
    return new Response("Audio unavailable", {
      status: 503,
      headers: CORS_HEADERS,
    });
  }
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME || "notesnapscores",
      Key: `audio/${pieceId}.wav`,
    });
    const obj = await s3.send(command);
    const body = obj.Body as ReadableStream | undefined;
    if (!body) throw new Error("empty body");
    return new Response(body as unknown as BodyInit, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "audio/wav",
        "Content-Disposition": `inline; filename="${pieceId}.wav"`,
        "Cache-Control":
          process.env.NODE_ENV === "production"
            ? "public, max-age=31536000, immutable"
            : "no-cache",
      },
    });
  } catch (err) {
    console.error("[audio] fetch failed", pieceId, String(err).slice(0, 200));
    return new Response("Not Found", {
      status: 404,
      headers: CORS_HEADERS,
    });
  }
}
