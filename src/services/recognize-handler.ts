import { fingerprintFromBuffer } from "~/services/fpcalc";
import { matchFingerprint } from "~/services/matching";

// ---------------------------------------------------------------------------
// Rate limiting (simple in-memory counter for free tier — 5 per month)
// In production, replace with a DB-backed counter using recognition_history.
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
// Maximum upload size: 5 MB
// ---------------------------------------------------------------------------
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/recognize handler
 *
 * Accepts multipart/form-data with an `audio` file (Opus/OGG preferred, WAV/PCM fallback).
 * Returns JSON with a matches array, confidence scores, and query duration.
 *
 * Error responses:
 *   400 — invalid audio / missing file
 *   405 — wrong method
 *   413 — file too large (>5MB)
 *   429 — rate limit exceeded (free tier: 5/month)
 *   500 — processing error
 */
export async function handleRecognize(req: Request): Promise<Response> {
  const startTime = performance.now();

  // --- Validate Content-Type ---
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { success: false, error: "Content-Type must be multipart/form-data" },
      { status: 400 },
    );
  }

  // --- Check content-length ---
  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return Response.json(
      { success: false, error: "Audio file too large (max 5 MB)" },
      { status: 413 },
    );
  }

  // --- Parse form data ---
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json(
      { success: false, error: "Invalid form data" },
      { status: 400 },
    );
  }

  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof File)) {
    return Response.json(
      { success: false, error: "Missing 'audio' file in form data" },
      { status: 400 },
    );
  }

  if (audioFile.size === 0) {
    return Response.json(
      { success: false, error: "Audio file is empty" },
      { status: 400 },
    );
  }

  if (audioFile.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      { success: false, error: "Audio file too large (max 5 MB)" },
      { status: 413 },
    );
  }

  // --- Rate limiting ---
  const userId =
    req.headers.get("x-user-id") ||
    req.headers.get("x-forwarded-for") ||
    "anonymous";

  if (!checkMonthlyLimit(userId)) {
    return Response.json(
      {
        success: false,
        error:
          "Monthly recognition limit reached (5/month). Upgrade to Pro for unlimited.",
      },
      { status: 429 },
    );
  }

  // --- Generate fingerprint ---
  let fingerprint: number[];
  try {
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const result = await fingerprintFromBuffer(audioBuffer);
    fingerprint = result.fingerprint;
  } catch (err) {
    console.error("[recognize] fingerprint generation failed:", err);
    return Response.json(
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
  try {
    const rawMatches = await matchFingerprint(fingerprint);
    matches = rawMatches.map((m) => ({
      piece_id: m.piece_id,
      title: m.title,
      composer: m.composer,
      catalog: m.catalog,
      confidence: Math.round(m.confidence * 100) / 100,
      album_art_url: m.album_art_url,
      sheet_music_url: m.sheet_music_url,
      tab_url: m.tab_url,
      matched_at_s: m.segment_start_s,
    }));
    dbAvailable = true;
  } catch (err) {
    console.warn(
      "[recognize] database lookup skipped (DATABASE_URL not set or query failed):",
      (err as Error).message,
    );
  }

  const queryDurationMs = Math.round(performance.now() - startTime);

  return Response.json({
    success: true,
    matches,
    query_duration_ms: queryDurationMs,
    db_available: dbAvailable,
  });
}
