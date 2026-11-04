/**
 * Public NOTES proxy — serves the stored Standard MIDI File for a piece.
 *
 * Same problem the score proxy solves (`sheet-handler.ts`): R2's S3 endpoint requires signed
 * requests, so a raw `https://…r2.cloudflare…/notes/x.mid` URL is not publicly fetchable. The
 * TAB engine and the app therefore need a public URL that returns a MIDI file, and this route
 * streams the object from R2 server-side with the site's credentials.
 *
 * GET|HEAD /api/notes/<piece-id>.mid
 *   piece-id — uuid of the piece (the R2 object key is `notes/<piece-id>.mid`)
 *
 * ---------------------------------------------------------------------------
 * CONTENT-TYPE IS ASSERTED AT SERVE TIME TOO
 * ---------------------------------------------------------------------------
 * The ingest gate (`pd-notes-gate.ts`) refuses to STORE a payload that is not a MIDI file, but a
 * route that hands back whatever happens to be at the key would re-open the same defect from the
 * other end: a stale or wrongly-written object would be served to the app as `audio/sp-midi` and
 * the app's parser would choke on HTML. So the object's stored ContentType is checked on the way
 * out and anything that is not a MIDI type is answered `415 Unsupported Media Type` — the client
 * is told the truth instead of being handed a lie with a MIDI label.
 *
 * HEAD is supported for the same reason it is on `/api/sheets/`: link/uptime monitors probe with
 * HEAD, and a GET-only guard made every score look broken in the 2026-09-22 link audit.
 */
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { MIDI_CONTENT_TYPES, NOTES_CONTENT_TYPE } from "./pd-notes-gate";

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

/** Methods a notes URL answers: GET streams the MIDI, HEAD only its metadata. */
export type NotesServeMethod = "GET" | "HEAD";

/**
 * The ONE route guard for notes URLs, used by both server entries (Bun `serve.ts` and the
 * Vercel function entry) so a method can never be routed in one and dropped in the other.
 */
export function isNotesServeMethod(method: string): boolean {
  const m = String(method ?? "").toUpperCase();
  return m === "GET" || m === "HEAD";
}

export type NotesFetchResult =
  | { ok: true; body: BodyInit | null; contentLength?: number; contentType?: string | null }
  | { ok: false; reason: "missing" | "unavailable" };

export type NotesObjectFetcher = (
  key: string,
  method: NotesServeMethod,
) => Promise<NotesFetchResult>;

async function fetchNotesObjectFromR2(
  key: string,
  method: NotesServeMethod,
): Promise<NotesFetchResult> {
  const s3 = getS3();
  if (!s3) {
    console.error("[notes] R2 env not configured");
    return { ok: false, reason: "unavailable" };
  }
  const Bucket = process.env.R2_BUCKET_NAME || "notesnapscores";
  try {
    if (method === "HEAD") {
      const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
      return { ok: true, body: null, contentLength: head.ContentLength, contentType: head.ContentType };
    }
    const obj = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
    const body = obj.Body as ReadableStream | undefined;
    if (!body) throw new Error("empty body");
    return {
      ok: true,
      body: body as unknown as BodyInit,
      contentLength: obj.ContentLength,
      contentType: obj.ContentType,
    };
  } catch (err) {
    console.error("[notes] fetch failed", key, String(err).slice(0, 200));
    return { ok: false, reason: "missing" };
  }
}

let fetchObject: NotesObjectFetcher = fetchNotesObjectFromR2;

/**
 * Swap the R2 accessor. Tests inject a fake here so the 200/HEAD/404/415/503 behaviour is
 * asserted without live R2 credentials or network; production never calls it.
 */
export function setNotesObjectFetcher(fetcher: NotesObjectFetcher | null): void {
  fetchObject = fetcher ?? fetchNotesObjectFromR2;
}

/** True when the stored object's content type is one we will hand out as MIDI. */
export function isServableMidiContentType(contentType: string | null | undefined): boolean {
  const ct = String(contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return MIDI_CONTENT_TYPES.includes(ct);
}

export async function handleNotesServe(req: Request): Promise<Response> {
  const method = (req.method || "GET").toUpperCase();
  if (!isNotesServeMethod(method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: "GET, HEAD" },
    });
  }

  const { pathname } = new URL(req.url);
  // /api/notes/<uuid>.mid
  const m = pathname.match(/^\/api\/notes\/([0-9a-f-]{36})\.mid$/i);
  if (!m) {
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }
  const pieceId = m[1].toLowerCase();
  const result = await fetchObject(`notes/${pieceId}.mid`, method as NotesServeMethod);

  if (!result.ok) {
    return result.reason === "unavailable"
      ? new Response("Notes unavailable", { status: 503, headers: CORS_HEADERS })
      : new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }

  // The object exists but is not a MIDI file: say so rather than label it as one.
  if (!isServableMidiContentType(result.contentType)) {
    console.error(
      `[notes] refusing to serve ${pieceId}: stored content-type ${JSON.stringify(result.contentType)} is not MIDI`,
    );
    return new Response("Stored object is not a MIDI file", {
      status: 415,
      headers: CORS_HEADERS,
    });
  }

  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": NOTES_CONTENT_TYPE,
    "Content-Disposition": `inline; filename="${pieceId}.mid"`,
    "Cache-Control": "public, max-age=31536000, immutable",
  };
  if (result.contentLength != null) headers["Content-Length"] = String(result.contentLength);

  return new Response(method === "HEAD" ? null : (result.body as BodyInit), {
    status: 200,
    headers,
  });
}
