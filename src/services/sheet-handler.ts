/**
 * Public sheet-music proxy — serves the gated public-domain PDFs from R2.
 *
 * R2's S3 endpoint requires signed requests, so a raw `https://…r2.cloudflare…/sheets/x.pdf`
 * URL is NOT publicly fetchable (400 for anonymous GET). The app's PDF viewer needs a
 * public URL that returns `application/pdf`, so this route streams the object from R2
 * server-side (credentials live in the site env) and returns it with cache headers.
 *
 * GET|HEAD /api/sheets/<piece-id>.pdf
 *   piece-id — uuid of the piece (the R2 object key is `sheets/<piece-id>.pdf`)
 *
 * ---------------------------------------------------------------------------
 * LINK AUDIT 2026-09-22 — why HEAD is here
 * ---------------------------------------------------------------------------
 * Both server entries routed this path with `req.method === "GET"` only, so a
 * HEAD request (what every uptime/link monitor sends to check a URL without
 * downloading the body) fell through to SSR and came back **404** — i.e. all 78
 * scores were reported broken by any HEAD-based monitor while GET returned 200.
 * HEAD now takes the same route as GET and returns the same status + headers
 * (via HeadObject, so the PDF body is never transferred) with an empty body, as
 * the HTTP spec requires.
 *
 * The route guard lives in `isSheetServeMethod` so BOTH entries share one
 * definition; `sheet-handler.test.ts` scans them (the bug class is "an entry
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

/** Methods a score URL answers: GET streams the PDF, HEAD only its metadata. */
export type SheetServeMethod = "GET" | "HEAD";

/**
 * The ONE route guard for score URLs, used by both server entries (Bun `serve.ts`
 * and the Vercel function entry) so a method can never be routed in one and
 * dropped in the other.
 */
export function isSheetServeMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

/**
 * Result of fetching a score object.
 *   ok:true            — `body` is null for HEAD (metadata only), never for GET
 *   reason:"missing"   — no such object → 404
 *   reason:"unavailable" — R2 not configured → 503 (same answer GET gives)
 */
export type SheetFetchResult =
  | { ok: true; body: BodyInit | null; contentLength?: number }
  | { ok: false; reason: "missing" | "unavailable" };

export type SheetObjectFetcher = (
  key: string,
  method: SheetServeMethod,
) => Promise<SheetFetchResult>;

async function fetchSheetObjectFromR2(
  key: string,
  method: SheetServeMethod,
): Promise<SheetFetchResult> {
  const s3 = getS3();
  if (!s3) {
    console.error("[sheet] R2 env not configured");
    return { ok: false, reason: "unavailable" };
  }
  const Bucket = process.env.R2_BUCKET_NAME || "notesnapscores";
  try {
    if (method === "HEAD") {
      // Metadata only — a monitor probing 78 scores must not pull 78 PDFs.
      const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
      return { ok: true, body: null, contentLength: head.ContentLength };
    }
    const obj = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
    const body = obj.Body as ReadableStream | undefined;
    if (!body) throw new Error("empty body");
    return { ok: true, body: body as unknown as BodyInit };
  } catch (err) {
    console.error("[sheet] fetch failed", key, String(err).slice(0, 200));
    return { ok: false, reason: "missing" };
  }
}

let fetchObject: SheetObjectFetcher = fetchSheetObjectFromR2;

/**
 * Swap the R2 accessor. Tests inject a fake here so the 200/HEAD/404/503
 * behaviour is asserted without live R2 credentials or network; production never
 * calls it (a null argument restores the real accessor).
 */
export function setSheetObjectFetcher(fetcher: SheetObjectFetcher | null): void {
  fetchObject = fetcher ?? fetchSheetObjectFromR2;
}

export async function handleSheetServe(req: Request): Promise<Response> {
  const method = (req.method || "GET").toUpperCase();
  if (!isSheetServeMethod(method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: "GET, HEAD" },
    });
  }

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
  const result = await fetchObject(`sheets/${pieceId}.pdf`, method as SheetServeMethod);

  if (!result.ok) {
    return result.reason === "unavailable"
      ? new Response("Sheet music unavailable", { status: 503, headers: CORS_HEADERS })
      : new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }

  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${pieceId}.pdf"`,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
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
