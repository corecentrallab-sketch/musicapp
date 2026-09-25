import { modernRetailerUrls } from "./modern-retailer";
import { pickModernGenre } from "./modern-genre";
import { logCaptureHeaders } from "./capture-headers";
import {
  crossCheckPdCatalog,
  type PdCrossCheckFn,
  type PdMatchWire,
} from "./modern-pd-crosscheck";

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
//
// PD CROSS-CHECK (backlog 43c1c500 / 718da1e9, added 2026-09-25): the provider
// identifies a RECORDING, and a recording of a public-domain work we already
// hold is not a modern song to sell (owner's Lang Lang / Für Elise card). When
// the provider returns a match this route asks `modern-pd-crosscheck.ts` whether
// the identified work is in our PD catalog and, if the mapping is confident,
// adds `pd_match` alongside the modern data — the app (PD-ROUTING, app master
// 8558419) renders the free PD-library card for it. The key is ABSENT otherwise:
// an ambiguous mapping is never sent as a guess, and a cross-check that cannot
// run leaves this response exactly what it was before.
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // match our existing cap (AudD's own limit is 10 MB)

const PROVIDER = process.env.MODERN_RECOGNITION_PROVIDER || "none"; // "audd" | "acrcloud" | "none"
const AUDD_API_TOKEN = process.env.AUDD_API_TOKEN || "";
const ACR_KEY = process.env.ACRCLOUD_ACCESS_KEY || "";
const ACR_SECRET = process.env.ACRCLOUD_ACCESS_SECRET || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  // x-capture-* are the app's on-device capture diagnostics (V26, 09-25) — logged
  // server-side only, never echoed in a response body.
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, x-user-id, x-capture-duration-ms, x-capture-peak-dbfs, x-capture-bytes",
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
  /**
   * THE REAL GENRE, straight from the provider's own metadata (owner request
   * 09-25: the app used to label every modern match "Modern song"). Apple Music
   * wins over Spotify; first non-empty genre, provider wording kept. OMITTED
   * entirely when the provider carried no genre — the app then shows its honest
   * generic category rather than a guess.
   */
  genre?: string;
  albumArtUrl?: string;
  composer?: string;
  matchConfidence: number;
  source: string;
  /**
   * PRIMARY retailer: Sheet Music Direct (affiliate ID 67650), searched by the
   * TITLE ALONE. Never a recording/ISRC code — SMD's search indexes titles,
   * artists and composers only, and a code search dead-ends on "No Results"
   * (owner on-device bug 09-22). And never title+artist either: SMD scores ~0 for
   * the extra artist tokens and answers its own zero-result page (owner on-device
   * bug 09-23 — `/home/team/shared/SMD-NO-RESULTS-INVESTIGATION-2026-09-23.md`).
   * Absent when the match carries no searchable text at all.
   */
  retailerUrl?: string;
  /**
   * BACKUP retailer (owner-approved: Musicnotes), searched by title+artist (its
   * search handles both tokens), for the app's "Try Musicnotes" secondary button
   * when SMD has nothing. Deliberately carries NO SMD affiliate params —
   * attribution belongs to `retailerUrl` only.
   */
  musicnotesUrl?: string;
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
  // Retailer search links: SMD primary (title only — see modern-retailer.ts) +
  // Musicnotes backup (title+artist). The ISRC is still passed so the builder's
  // call site documents that a code was available and was deliberately NOT used as
  // the query (owner on-device bug 09-22).
  const urls = modernRetailerUrls(r.title, r.artist, isrc);
  // The provider's OWN genre, never an invented taxonomy (owner 09-25). Undefined
  // when neither block carries one — then the key is left off the match entirely.
  const genre = pickModernGenre(r);
  return {
    song: r.title,
    artist: r.artist,
    album: r.album,
    isrc,
    ...(genre ? { genre } : {}),
    albumArtUrl: art,
    composer: am.composerName,
    matchConfidence: typeof r.score === "number" ? r.score : 1,
    source: "audd",
    retailerUrl: urls.primary,
    // Delivered so the app can offer the backup retailer when SMD has nothing —
    // computed before but never sent (the match only carried `.primary`).
    musicnotesUrl: urls.musicnotes,
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

/**
 * Injected dependencies — production callers pass nothing and get the real
 * cross-check; the route test injects a catalog read so the whole pipeline can
 * be pinned (AudD stub -> PD route decision) without a vendor call or a
 * database round trip.
 */
export interface ModernRecognizeDeps {
  crossCheck?: PdCrossCheckFn;
}

export async function handleModernRecognize(
  req: Request,
  deps: ModernRecognizeDeps = {},
): Promise<Response> {
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
  // What the phone actually captured (V26, 09-25): logged when the app sent the
  // numbers, never echoed in the response.
  logCaptureHeaders("[recognize-modern]", req);
  try {
    if (PROVIDER === "audd") match = await auddAdapter(audio.buf, audio.name, AUDD_API_TOKEN);
    else match = await acrcloudAdapter(audio.buf, ACR_KEY, ACR_SECRET);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[recognize-modern] vendor call failed:", err);
    return json({ success: false, error: "modern recognition service unavailable" }, 502);
  }

  // --- PD cross-check (backlog 43c1c500 / 718da1e9) -------------------------
  // The provider identified a RECORDING; when that recording is of a work we
  // already hold in public domain, the app must show OUR free score card
  // instead of the modern interstitial (owner 09-25: Lang Lang's Für Elise came
  // up as a modern song to buy). The cross-check is run ONLY when there is a
  // match — a no-match pass has nothing to map, and must not touch the catalog.
  // It never throws: an unreadable catalog or an ambiguous mapping returns null
  // and the response stays the honest modern result it was before.
  const crossCheck = deps.crossCheck ?? crossCheckPdCatalog;
  let pdMatch: PdMatchWire | null = null;
  if (match) {
    pdMatch = await crossCheck({
      title: match.song,
      artist: match.artist,
      composer: match.composer,
    });
  }

  return json({
    success: true,
    modern: match,            // null -> recognized: "none"
    recognized: match ? "modern" : "none",
    source: PROVIDER,
    query_duration_ms: Date.now() - t0,
    // Present ONLY when the mapping was confident. The app reads this to route
    // the PD-library card; its absence is what keeps a genuine modern song on
    // the modern path (an ambiguous mapping is never sent as a guess).
    ...(pdMatch ? { pd_match: pdMatch } : {}),
  });
}