import { fingerprintFromBuffer } from "~/services/fpcalc";
import { matchFingerprint } from "~/services/matching";
import { generatePurchaseUrls } from "~/services/generate-purchase-urls";
import { hasActiveSubscription } from "~/services/entitlement";

// ---------------------------------------------------------------------------
// Rate limiting (simple in-memory counter for free tier — 5 per month)
//
// ** IMPORTANT — post-launch hardening needed **
// This implementation resets on every server restart. In-memory Maps do not
// survive cold starts, deploys, or instance scaling. For production, this
// must be migrated to a DB-backed counter using the `recognition_history`
// table. The schema already has `recognition_history(user_identifier, created_at)`
// with an index ready for rate-limit queries. Recommended approach:
//   1. On each recognition, INSERT into recognition_history
//   2. COUNT rows for user_identifier WHERE created_at > NOW() - INTERVAL '30 days'
//   3. If count >= 5, reject with 429
//   4. Consider adding a `tier` column to users for Pro unlimited bypass
// ---------------------------------------------------------------------------
const monthlyLimits = new Map<string, { count: number; resetAt: number }>();

function checkMonthlyLimit(userId: string): boolean {
  const now = Date.now();
  const entry = monthlyLimits.get(userId);

  // Reset if the month window has passed (30-day rolling window)
  if (!entry || now > entry.resetAt) {
    monthlyLimits.set(userId, {
      count: 1,
      resetAt: now + 30 * 24 * 60 * 60 * 1000,
    });
    return true;
  }

  if (entry.count >= 5) {
    return false;
  }

  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Maximum upload size: 4 MB (Vercel's function payload hard limit is 4.5MB —
// keep margin so the platform never rejects the request with 413 before we
// can return a friendly error).
// ---------------------------------------------------------------------------
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// CORS headers — required for cross-origin requests from the mobile app
// and any web-based clients. Applied to every response (success and error).
// ---------------------------------------------------------------------------
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, x-user-id",
};

function corsResponse(
  body: Record<string, unknown>,
  init?: ResponseInit,
): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init?.headers as Record<string, string> | undefined) },
  });
}

/**
 * POST /api/recognize handler
 *
 * Accepts multipart/form-data with an `audio` file (Opus/OGG preferred, WAV/PCM fallback).
 * Returns JSON with a matches array, confidence scores, and query duration.
 *
 * Error responses:
 *   400 — invalid audio / missing file
 *   405 — wrong method
 *   413 — file too large (>4MB)
 *   429 — rate limit exceeded (free tier: 5/month)
 *   500 — processing error
 */
export async function handleRecognize(req: Request): Promise<Response> {
  const startTime = performance.now();

  // --- Validate Content-Type ---
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return corsResponse(
      { success: false, error: "Content-Type must be multipart/form-data" },
      { status: 400 },
    );
  }

  // --- Check content-length ---
  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return corsResponse(
      { success: false, error: "Audio file too large (max 4 MB)" },
      { status: 413 },
    );
  }

  // --- Parse form data ---
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return corsResponse(
      { success: false, error: "Invalid form data" },
      { status: 400 },
    );
  }

  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof File)) {
    return corsResponse(
      { success: false, error: "Missing 'audio' file in form data" },
      { status: 400 },
    );
  }

  if (audioFile.size === 0) {
    return corsResponse(
      { success: false, error: "Audio file is empty" },
      { status: 400 },
    );
  }

  if (audioFile.size > MAX_UPLOAD_BYTES) {
    return corsResponse(
      { success: false, error: "Audio file too large (max 4 MB)" },
      { status: 413 },
    );
  }

  // --- Rate limiting ---
  // Devices that send x-user-id (the app's anonymous device UUID) are checked
  // against the subscriptions table: an active subscription bypasses the free
  // tier's 5/month limit. Clients without the header fall back to per-IP
  // limiting (the in-memory counter above — see its hardening note).
  const deviceId = req.headers.get("x-user-id");
  const fallbackId = req.headers.get("x-forwarded-for") || "anonymous";
  if (deviceId) {
    const isPro = await hasActiveSubscription(deviceId);
    if (!isPro && !checkMonthlyLimit(deviceId)) {
      return corsResponse(
        {
          success: false,
          error:
            "Monthly recognition limit reached (5/month). Upgrade to Pro for unlimited.",
        },
        { status: 429 },
      );
    }
  } else if (!checkMonthlyLimit(fallbackId)) {
    return corsResponse(
      {
        success: false,
        error:
          "Monthly recognition limit reached (5/month). Upgrade to Pro for unlimited.",
      },
      { status: 429 },
    );
  }

  // --- Generate fingerprint ---
  // NOTE: fingerprintFromBuffer runs fpcalc via child_process.execFile with a
  // 30s timeout (see fpcalc.ts) — a hang on corrupted audio is killed and
  // surfaces as the 400 below instead of stalling the request indefinitely.
  let fingerprint: number[];
  try {
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const result = await fingerprintFromBuffer(audioBuffer);
    fingerprint = result.fingerprint;
  } catch (err) {
    console.error("[recognize] fingerprint generation failed:", err);
    return corsResponse(
      {
        success: false,
        error:
          "Could not process audio — ensure it contains audible music",
      },
      { status: 400 },
    );
  }

  // --- Match against database ---
  let matches: unknown[] = [];
  let dbAvailable = false;
  let bestGuessTitle: string | null = null;
  let bestGuessComposer: string | null = null;
  try {
    const rawMatches = await matchFingerprint(fingerprint);
    matches = rawMatches.map((m) => {
      // Keep best-guess metadata for fallback when no match found
      if (!bestGuessTitle && m.title) {
        bestGuessTitle = m.title;
        bestGuessComposer = m.composer;
      }
      // Public-domain pieces get null purchase_url — we already serve the score
      // (or will: is_public_domain=true with no sheet_music_url yet means "coming
      // soon", NOT an affiliate redirect). Everything else gets affiliate search
      // links for the official sheet music.
      const isPublicDomain = !!m.is_public_domain;
      return {
        piece_id: m.piece_id,
        title: m.title,
        composer: m.composer,
        catalog: m.catalog,
        confidence: Math.round(m.confidence * 100) / 100,
        album_art_url: m.album_art_url,
        sheet_music_url: m.sheet_music_url,
        tab_url: m.tab_url,
        matched_at_s: m.segment_start_s,
        // Honest signal: PD pieces NEVER get a purchase redirect, even when the
        // score itself is not curated yet. App shows a "coming soon" state.
        is_public_domain: isPublicDomain,
        sheet_music_available: isPublicDomain && !!m.sheet_music_url,
        purchase_url: isPublicDomain
          ? null
          : generatePurchaseUrls(m.title, m.composer),
      };
    });
    dbAvailable = true;
  } catch (err) {
    console.error(
      "[recognize] database lookup failed (recognition service unavailable):",
      err,
    );
    // The recognition service is broken — never report success with empty
    // matches, or every query would look like a clean "no match".
    return corsResponse({
      success: false,
      error: "recognition service unavailable",
      db_available: false,
    });
  }

  const queryDurationMs = Math.round(performance.now() - startTime);

  // Build response. When there are no matches, include a top-level
  // purchase_url ONLY if we have a best-guess title (the DB returned
  // close-but-below-threshold candidates) — never a hardcoded empty-query
  // search link.
  const response: Record<string, unknown> = {
    success: true,
    matches,
    query_duration_ms: queryDurationMs,
    db_available: dbAvailable,
  };

  if (matches.length === 0 && bestGuessTitle) {
    response.purchase_url = generatePurchaseUrls(
      bestGuessTitle,
      bestGuessComposer || "",
    );
  }

  return corsResponse(response as Record<string, unknown>);
}
