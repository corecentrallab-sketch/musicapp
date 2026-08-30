import { modernRetailerUrls } from "./modern-retailer";

// ---------------------------------------------------------------------------
// Modern-song recognition wrapper — PREP/DRY-RUN skeleton (Backlog #12).
//
// Proxies an app audio capture (.m4a — the same upload our PD /api/recognize
// receives) to a commercial music-ID API (primary: AudD; Plan B: ACRCloud) and
// returns a NORMALIZED result so the app keeps ONE recognition surface.
//
// Copyright-safe: we only pass the ID/metadata out and a retailer URL back; we
// never store or serve the vendor's audio or fingerprints. The capture reuses
// our existing not-stored-or-scoped policy (PERSIST_RECOGNIZE_AUDIO is a debug
// flag, off in prod).
//
// WITHOUT a provider/key configured this returns 503 "not configured" — the
// feature is inert and safe to deploy in this state (dry-run). Turning it on
// is purely an env change: set MODERN_RECOGNITION_PROVIDER=audd + AUDD_API_TOKEN
// (or ACRCLOUD_ACCESS_KEY / ACRCLOUD_ACCESS_SECRET). See
// /home/team/shared/MODERN-SONG-ID-EVALUATION.md.
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // match our existing cap (AudD's own limit is 10 MB)

const PROVIDER = process.env.MODERN_RECOGNITION_PROVIDER || "none"; // "audd" | "acrcloud" | "none"
const AUDD_API_TOKEN = process.env.AUDD_API_TOKEN || "";
const ACR_KEY = process.env.ACRCLOUD_ACCESS_KEY || "";
const ACR_SECRET = process.env.ACRCLOUD_ACCESS_SECRET || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, x-user-id",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export interface ModernMatch {
  song: string;
  artist: string;
  album?: string;
  isrc?: string;
  albumArtUrl?: string;
  composer?: string;
  matchConfidence: number;
  source: string;
  retailerUrl?: string;
}

/** Get the audio file out of a multipart POST (mirrors /api/recognize). */
async function extractAudio(req: Request): Promise<{ buf: ArrayBuffer; size: number; name: string } | null> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return null;
  }
  const file = form.get("file");
  if (!(file instanceof File)) return null;
  const buf = await file.arrayBuffer();
  return { buf, size: buf.byteLength, name: file.name ?? "capture.m4a" };
}

// --- Adapters: map each vendor's raw response to our normalized ModernMatch. ---

async function auddAdapter(buf: ArrayBuffer, name: string, token: string): Promise<ModernMatch | null> {
  const body = new FormData();
  body.append("file", new File([buf], name || "capture.m4a", { type: "audio/mp4" }));
  body.append("api_token", token);
  // Ask for the metadata block that carries ISRC + artwork + composer.
  body.append("return", "apple_music,spotify");

  const res = await fetch("https://api.audd.io/", { method: "POST", body });
  if (!res.ok) throw new Error(`AudD HTTP ${res.status}`);
  const data = (await res.json()) as any;
  if (data?.status !== "success" || !data?.result) return null; // no match

  const r = data.result;
  const am = r.apple_music || {};
  const sp = r.spotify || {};
  const isrc =
    typeof am.isrc === "string" && am.isrc
      ? am.isrc
      : sp?.external_ids?.isrc;
  let art: string | undefined;
  if (am?.artwork?.url) {
    // Apple artwork URL uses {w}x{h} placeholders -> request a fixed square.
    art = am.artwork.url.replace("{w}x{h}bb", "400x400bb");
  } else if (sp?.album?.images?.[0]?.url) {
    art = sp.album.images[0].url;
  }
  return {
    song: r.title,
    artist: r.artist,
    album: r.album,
    isrc,
    albumArtUrl: art,
    composer: am.composerName,
    matchConfidence: typeof r.score === "number" ? r.score : 1,
    source: "audd",
    retailerUrl: modernRetailerUrls(r.title, r.artist, isrc).primary,
  };
}

async function acrcloudAdapter(_buf: ArrayBuffer, _key: string, _secret: string): Promise<ModernMatch | null> {
  // Plan B — ACRCloud v1 identify: HMAC-SHA1 signed HTTPS POST of the raw audio.
  // Token/secret derived signature required. Response metadata.music[0] carries
  // title/artist/album; ISRC via external_metadata levels (field TBD-to-verify
  // on a trial account). Skeleton: audible "not yet wired" fallback so the
  // feature fails soft if ACRCloud is selected before the adapter is finished.
  throw new Error("ACRCloud adapter not yet implemented (Plan B); wire during vendor trial.");
}

export async function handleModernRecognize(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed. Use POST." }, 405);

  // 503 / not configured -> feature off, dry-run safe.
  if (PROVIDER === "none" || (PROVIDER === "audd" && !AUDD_API_TOKEN) || (PROVIDER === "acrcloud" && (!ACR_KEY || !ACR_SECRET))) {
    return json({ success: false, error: "modern recognition not configured" }, 503);
  }

  const audio = await extractAudio(req);
  if (!audio) return json({ success: false, error: "Missing audio file field 'file'." }, 400);
  if (audio.size > MAX_UPLOAD_BYTES) return json({ success: false, error: "Audio file too large (max 4 MB)." }, 413);

  let match: ModernMatch | null;
  const t0 = Date.now();
  try {
    if (PROVIDER === "audd") match = await auddAdapter(audio.buf, audio.name, AUDD_API_TOKEN);
    else match = await acrcloudAdapter(audio.buf, ACR_KEY, ACR_SECRET);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[recognize-modern] vendor call failed:", err);
    return json({ success: false, error: "modern recognition service unavailable" }, 502);
  }

  return json({
    success: true,
    modern: match,            // null -> recognized: "none"
    recognized: match ? "modern" : "none",
    source: PROVIDER,
    query_duration_ms: Date.now() - t0,
  });
}
