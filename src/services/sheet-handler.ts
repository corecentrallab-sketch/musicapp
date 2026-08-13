/**
 * Public sheet-music proxy — serves the gated public-domain PDFs from R2.
 *
 * R2's S3 endpoint requires signed requests, so a raw `https://…r2.cloudflare…/sheets/x.pdf`
 * URL is NOT publicly fetchable (400 for anonymous GET). The app's PDF viewer needs a
 * public URL that returns `application/pdf`, so this route streams the object from R2
 * server-side (credentials live in the site env) and returns it with cache headers.
 *
 * GET /api/sheets/<piece-id>.pdf
 *   piece-id — uuid of the piece (the R2 object key is `sheets/<piece-id>.pdf`)
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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

export async function handleSheetServe(
  req: Request,
): Promise<Response> {
  const { pathname } = new URL(req.url);
  // /api/sheets/<uuid>.pdf
  const m = pathname.match(/^\/api\/sheets\/([0-9a-f-]{36})\.pdf$/i);
  if (!m) {
    return new Response("Not Found", {
      status: 404,
      headers: CORS_HEADERS,
    });
  }
  const pieceId = m[1].toLowerCase();
  const s3 = getS3();
  if (!s3) {
    console.error("[sheet] R2 env not configured");
    return new Response("Sheet music unavailable", {
      status: 503,
      headers: CORS_HEADERS,
    });
  }
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME || "notesnapscores",
      Key: `sheets/${pieceId}.pdf`,
    });
    const obj = await s3.send(command);
    const body = obj.Body as ReadableStream | undefined;
    if (!body) throw new Error("empty body");
    return new Response(body as unknown as BodyInit, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${pieceId}.pdf"`,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("[sheet] fetch failed", pieceId, String(err).slice(0, 200));
    return new Response("Not Found", {
      status: 404,
      headers: CORS_HEADERS,
    });
  }
}
