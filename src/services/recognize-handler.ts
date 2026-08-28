// Explicit .ts extension: publish.sh provisions the native fpcalc binary beside
// this module as ./fpcalc (no extension), and Bun resolves an extensionless
// "./fpcalc" import to that binary first — which would crash startup by trying
// to parse the ELF file as TypeScript. The explicit extension always targets
// the module.
import { decodeToMonoSamples } from "~/services/fpcalc.ts";
import { extractLandmarksRobust } from "~/services/landmark";
import { matchLandmarks } from "~/services/landmark-matching";
import { generatePurchaseUrls } from "~/services/generate-purchase-urls";
import { hasActiveSubscription } from "~/services/entitlement";
import { applyMatchPolicy } from "~/services/match-policy";

// ---------------------------------------------------------------------------
// Rate limiting (simple in-memory counter for free tier — default 5 per month)
//
// ** IMPORTANT — post-launch hardening needed **
// This implementation resets on every server restart. In-memory Maps do not
// survive cold starts, deploys, or instance scaling. For production, this
// must be migrated to a DB-backed counter using the `recognition_history`
// table. The schema already has `recognition_history(user_identifier, created_at)`
// with an index ready for rate-limit queries. Recommended approach:
//   1. On each recognition, INSERT into recognition_history
//   2. COUNT rows for user_identifier WHERE created_at > NOW() - INTERVAL '30 days'
//   3. If count >= FREE_MONTHLY_LIMIT, reject with 429
//   4. Consider adding a `tier` column to users for Pro unlimited bypass
// ---------------------------------------------------------------------------
//
// Free-tier monthly cap. The code default is 5 (real-user quota semantics).
// The cap can be overridden via the FREE_RECOGNITIONS_PER_MONTH env var — used
// to raise the cap for the pre-launch on-device QA testing window. **This env
// override is a temporary test knob: revert/unset it (or lower it back to 5)
// before public launch so real users keep the real 5/month default.**
// NaN guard: if the env value doesn't parse to a finite number, fall back to 5.
// ---------------------------------------------------------------------------
const FREE_MONTHLY_LIMIT = Number.isFinite(Number(process.env.FREE_RECOGNITIONS_PER_MONTH))
  ? Number(process.env.FREE_RECOGNITIONS_PER_MONTH)
  : 5;

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

  if (entry.count >= FREE_MONTHLY_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// QA / internal test bypass (owner-approved QA recognition testing)
//
// Lets a designated internal test identity read as "has an active subscription"
// and therefore bypass the free tier's 5/month recognition cap — so QA runs
// and owner-device testing can issue UNLIMITED recognitions WITHOUT touching or
// changing the real free-tier quota logic (checkMonthlyLimit is untouched, and
// real users' counts are unaffected).
//
// Two independent conditions must BOTH hold, so an end user can never trigger
// this by accident:
//   1. The client must send `x-user-id` exactly equal to the internal identity
//      below (a value no real app install will ever produce).
//   2. The server must run with `RECOGNITION_QA_BYPASS=1` set in its env — only
//      present in non-production/dev/test environments. Production (Vercel)
//      never sets it, so even if the header value were guessed, the bypass is
//      inert in production. It also never weakens the subscription check for
//      any other identity.
// ---------------------------------------------------------------------------
const QA_TEST_IDENTITY = "qa-internal-test-device-0000";
const QA_BYPASS_ENABLED = process.env.RECOGNITION_QA_BYPASS === "1";

/** True only when the request is the designated internal QA identity AND the
 *  non-production bypass env guard is armed. */
function isQaTestIdentity(deviceId: string | null): boolean {
  return QA_BYPASS_ENABLED && deviceId === QA_TEST_IDENTITY;
}

// ---------------------------------------------------------------------------
// Application-level match-confidence gate.
//
// On clean synthetic renders genuine matches score ~0.39–1.0 (median 1.0) and
// the noise floor for non-catalog audio is ~0.02–0.11, so a threshold alone
// used to separate them. On REAL room-recorded device audio, however, the
// correct piece can land weak (~0.33) while a wrong piece scores higher
// (~0.57) — exactly the "confident-wrong" the launch rule forbids. A plain
// threshold cannot split those. We therefore apply the SHARED policy in
// `match-policy.ts`: an absolute floor PLUS a margin/ratio check against the
// runner-up PLUS a minimum floor when there is no rival. Any ambiguous outcome
// returns an EMPTY matches array (honest "no confident match" + a hint) — never
// a wrong title. The policy lives in one place so the audit tooling exercises
// the exact same numbers `/api/recognize` enforces.
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
    // Internal QA/test identity (non-production only) reads as Pro — unlimited.
    const isPro = isQaTestIdentity(deviceId) || (await hasActiveSubscription(deviceId));
    if (!isPro && !checkMonthlyLimit(deviceId)) {
      return corsResponse(
        {
          success: false,
          error:
            `Monthly recognition limit reached (${FREE_MONTHLY_LIMIT}/month). Upgrade to Pro for unlimited.`,
        },
        { status: 429 },
      );
    }
  } else if (!checkMonthlyLimit(fallbackId)) {
    return corsResponse(
      {
        success: false,
        error:
          `Monthly recognition limit reached (${FREE_MONTHLY_LIMIT}/month). Upgrade to Pro for unlimited.`,
      },
      { status: 429 },
    );
  }

  // --- Generate landmark fingerprint ---
  // The landmark fingerprinter decodes/resamples in JS and computes spectral
  // peak-pairs — robust to compression, mic/room noise, tempo drift and
  // different performances (unlike the old exact-Chromaprint matcher).
  let landmarks: ReturnType<typeof extractLandmarks>;
  let receivedAudio: { bytes: number; duration_s: number; sample_rate: number; channels: number; format: string | null } | null = null;
  try {
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const { mono, sampleRate, channels, durationS } = await decodeToMonoSamples(audioBuffer);
    // Sniff container brand from leading bytes for the diagnostic echo.
    let format: string | null = null;
    try {
      const magic = audioBuffer.subarray(0, 12).toString("latin1");
      if (magic.length >= 8 && magic.slice(4, 8) === "ftyp") {
        format = magic.slice(8, 12).startsWith("M4A") ? "m4a" : `mp4(${magic.slice(8, 12)})`;
      } else if (magic.startsWith("RIFF")) {
        format = "wav";
      } else if (magic.startsWith("OggS")) {
        format = "ogg";
      } else {
        format = "unknown";
      }
    } catch {
      format = null;
    }
    receivedAudio = {
      bytes: audioFile.size,
      duration_s: Math.round(durationS * 100) / 100,
      sample_rate: sampleRate,
      channels,
      format,
    };
    // eslint-disable-next-line no-console
    console.log(
      `[recognize] received ${audioFile.size}B fmt=${String(format)} ` +
        `rate=${sampleRate}Hz ch=${channels} dur=${Math.round(durationS * 1000)}ms`,
    );
    landmarks = extractLandmarksRobust(mono, sampleRate);
    if (landmarks.length === 0) {
      throw new Error("no landmarks — audio may be too short or silent");
    }
  } catch (err) {
    console.error("[recognize] landmark fingerprint generation failed:", err);
    return corsResponse(
      {
        success: false,
        error:
          "Could not process audio — ensure it contains audible music",
        received_audio: receivedAudio,
      },
      { status: 400 },
    );
  }

  // --- Match against database ---
  let matches: unknown[] = [];
  let dbAvailable = false;
  let noConfidentMatch: string | null = null;
  try {
    const rawMatches = await matchLandmarks(landmarks);
    // Apply the shared "no confident-wrong" gate (threshold + margin + single
    // fallback). An ambiguous/weak result yields NO match (honest no-match),
    // never a possibly-wrong title.
    const policy = applyMatchPolicy(rawMatches);
    if (policy.ok) {
      matches = [
        {
          ...(Object.fromEntries(
            Object.entries(policy.top).filter(([k]) => k !== "confidence"),
          ) as Record<string, unknown>),
          // Public-domain pieces get null purchase_url — we already serve the score
          // (or will: is_public_domain=true with no sheet_music_url yet means "coming
          // soon", NOT an affiliate redirect). Everything else gets affiliate search
          // links for the official sheet music.
          is_public_domain: !!policy.top.is_public_domain,
          sheet_music_available: !!policy.top.is_public_domain && !!policy.top.sheet_music_url,
          purchase_url: policy.top.is_public_domain
            ? null
            : generatePurchaseUrls(policy.top.title as string, policy.top.composer as string),
          confidence: Math.round((policy.top.confidence as number) * 100) / 100,
        },
      ];
    } else if (policy.reason !== "below-threshold") {
      // There WAS music-like evidence but it was ambiguous or too weak to be
      // a confident match. Tell the user plainly, instead of guessing.
      noConfidentMatch = policy.hint;
    }
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

  const response: Record<string, unknown> = {
    success: true,
    matches,
    query_duration_ms: queryDurationMs,
    db_available: dbAvailable,
    received_audio: receivedAudio,
  };
  // When the gate declined to name a piece (ambiguous / borderline), give the
  // app a human-readable reason it can surface — still `success: true` with an
  // empty matches array (honest no-match), never a wrong title.
  if (noConfidentMatch) response.no_confident_match_reason = noConfidentMatch;

  return corsResponse(response as Record<string, unknown>);
}
