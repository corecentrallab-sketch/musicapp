/**
 * RecognitionDemo — "Try it now" widget for the marketing-site hero.
 *
 * Captures ~8s of microphone audio in the browser (MediaRecorder, no
 * dependencies), POSTs it to the site's own /api/recognize endpoint exactly
 * like the mobile app does (multipart/form-data, `audio` field, `x-user-id`
 * header), and renders the top match with an honest availability state.
 *
 * Request contract mirrored from the app client (musicapp-update/src/services/api.ts)
 * and the backend handler (src/services/recognize-handler.ts):
 *   POST /api/recognize
 *   Content-Type: multipart/form-data
 *   body: { audio: File }            (max 4 MB)
 *   headers: { Accept: application/json, x-user-id: <anonymous device id> }
 * Response:
 *   { success: true, matches: [{ piece_id, title, composer, catalog, confidence,
 *     album_art_url, sheet_music_url, tab_url, matched_at_s, is_public_domain,
 *     sheet_music_available, purchase_url }], query_duration_ms, db_available }
 *   Errors: { success: false, error } with 400/413/429 (and 200 when the
 *   recognition service itself is unavailable).
 *
 * All browser APIs are used only inside event handlers — this component is
 * SSR-safe (renders the idle state on the server).
 */
import { useCallback, useEffect, useRef, useState } from "react";

const RECORD_MS = 8000; // target listening window (~8s)
const REQUEST_TIMEOUT_MS = 20000; // widget cap; backend caps fpcalc at 30s
const DEVICE_ID_KEY = "notesnap:web:deviceId";
const PLAY_TEST_URL = "https://play.google.com/apps/testing/com.notesnap.sheetmusic";

type Phase =
  | "idle"
  | "requesting-mic"
  | "recording"
  | "uploading"
  | "result"
  | "error";

interface Match {
  piece_id: string;
  title: string;
  composer: string;
  catalog: string | null;
  confidence: number;
  album_art_url: string | null;
  sheet_music_url: string | null;
  tab_url: string | null;
  matched_at_s: number;
  is_public_domain: boolean;
  sheet_music_available: boolean;
  purchase_url: Record<string, string> | null;
}

interface RecognizeResponse {
  success: boolean;
  matches?: Match[];
  query_duration_ms?: number;
  db_available?: boolean;
  purchase_url?: Record<string, string>;
  error?: string;
}

/** Stable anonymous device id (mirrors the app's x-user-id). */
function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
  } catch {
    // localStorage unavailable (private mode) — fall through to session id
  }
  let id: string;
  try {
    id = crypto.randomUUID();
  } catch {
    id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  try {
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    // Non-fatal: the id still works for this session.
  }
  return id;
}

/** First MediaRecorder mime type the browser supports (webm/opus preferred). */
function pickMimeType(): { mime: string; ext: string; label: string } {
  const candidates: Array<[string, string]> = [
    ["audio/webm;codecs=opus", "webm"],
    ["audio/webm", "webm"],
    ["audio/ogg;codecs=opus", "ogg"],
    ["audio/mp4", "m4a"],
  ];
  for (const [mime, ext] of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) {
        return { mime, ext, label: mime };
      }
    } catch {
      // isTypeSupported can throw for exotic values — try the next one
    }
  }
  return { mime: "", ext: "webm", label: "" };
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4" />
    </svg>
  );
}

export default function RecognitionDemo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0); // 0–100 during recording
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null); // e.g. query duration

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const progressTimerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const busy = phase === "recording" || phase === "uploading" || phase === "requesting-mic";

  const cleanup = useCallback(() => {
    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // recorder already failed — ignore
      }
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    chunksRef.current = [];
  }, []);

  // Unmount safety: never leave the mic or timers running.
  useEffect(() => cleanup, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setPhase("idle");
    setProgress(0);
    setMatch(null);
    setError(null);
    setDetail(null);
    busyRef.current = false;
  }, [cleanup]);

  const finishRecording = useCallback(async () => {
    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    const stream = streamRef.current;
    mediaRecorderRef.current = null;
    streamRef.current = null;
    if (!recorder || recorder.state === "inactive") {
      // Nothing recorded — treat as a quiet cancel, return to idle.
      stream?.getTracks().forEach((t) => t.stop());
      setPhase("idle");
      setProgress(0);
      busyRef.current = false;
      return;
    }
    try {
      recorder.stop(); // fires onstop → upload
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      setPhase("error");
      setError("Couldn't finish the recording. Please try again.");
      busyRef.current = false;
    }
  }, []);

  const upload = useCallback(async (blob: Blob, mimeInfo: { ext: string; label: string }) => {
    setPhase("uploading");
    setProgress(0);

    const formData = new FormData();
    formData.append(
      "audio",
      new File([blob], `recording.${mimeInfo.ext}`, {
        type: mimeInfo.label || "audio/webm",
      }),
    );

    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch("/api/recognize", {
        method: "POST",
        body: formData,
        headers: { Accept: "application/json", "x-user-id": getDeviceId() },
        signal: controller.signal,
      });
    } catch (err) {
      const aborted =
        err instanceof DOMException && err.name === "AbortError";
      setPhase("error");
      setError(
        aborted
          ? "Recognition took too long. Please try again."
          : "Couldn't reach the recognition service — check your connection and try again.",
      );
      busyRef.current = false;
      return;
    } finally {
      window.clearTimeout(timeout);
      abortRef.current = null;
    }

    let json: RecognizeResponse | null = null;
    try {
      json = (await response.json()) as RecognizeResponse;
    } catch {
      json = null;
    }

    if (!json || typeof json.success !== "boolean") {
      setPhase("error");
      setError("Something went wrong on our side. Please try again.");
      busyRef.current = false;
      return;
    }

    if (!json.success) {
      const serverError = json.error || "Recognition failed. Please try again.";
      // Rate limit is the one error with a clear product answer — be honest
      // about the free limit and point at the app for unlimited.
      if (response.status === 429 || /limit/i.test(serverError)) {
        setPhase("error");
        setError(
          "You've used this browser's free recognitions for the month. Get the app for unlimited recognition.",
        );
      } else {
        setPhase("error");
        setError(
          serverError === "recognition service unavailable"
            ? "Recognition is temporarily unavailable. Please try again in a moment."
            : serverError,
        );
      }
      busyRef.current = false;
      return;
    }

    const top = json.matches && json.matches.length > 0 ? json.matches[0] : null;
    if (!top) {
      setPhase("result");
      setMatch(null);
      setDetail(null);
      busyRef.current = false;
      return;
    }

    setPhase("result");
    setMatch(top);
    setDetail(
      json.query_duration_ms != null
        ? `Identified in ${(json.query_duration_ms / 1000).toFixed(1)}s`
        : null,
    );
    busyRef.current = false;
  }, []);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setMatch(null);
    setDetail(null);

    // Guard: MediaRecorder / getUserMedia absent (insecure context or old browser).
    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      busyRef.current = false;
      setPhase("error");
      setError(
        "Your browser doesn't support in-page audio capture (it needs HTTPS and a recent browser). You can still try NoteSnap in the app.",
      );
      return;
    }

    setPhase("requesting-mic");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      busyRef.current = false;
      setPhase("error");
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError(
          "Microphone access was blocked. Allow the mic in your browser (or site settings), then try again — or get the app.",
        );
      } else if (err instanceof DOMException && err.name === "NotFoundError") {
        setError(
          "No microphone was found on this device. Try again with a mic connected, or get the app.",
        );
      } else {
        setError(
          "Couldn't access the microphone. Allow mic access in your browser, or get the app.",
        );
      }
      return;
    }

    const mimeInfo = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeInfo.mime
        ? new MediaRecorder(stream, { mimeType: mimeInfo.mime })
        : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      busyRef.current = false;
      setPhase("error");
      setError(
        "Your browser can't record audio in a format we can read. Please try the app instead.",
      );
      return;
    }

    streamRef.current = stream;
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeInfo.label });
      if (blob.size === 0) {
        stream.getTracks().forEach((t) => t.stop());
        setPhase("error");
        setError("Nothing was captured — is your mic working? Please try again.");
        busyRef.current = false;
        return;
      }
      void upload(blob, mimeInfo);
    };
    recorder.onerror = () => {
      stream.getTracks().forEach((t) => t.stop());
      busyRef.current = false;
      setPhase("error");
      setError("Recording failed. Please try again.");
    };

    try {
      recorder.start();
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      busyRef.current = false;
      setPhase("error");
      setError("Couldn't start recording. Please try again.");
      return;
    }

    setPhase("recording");
    setProgress(0);
    const startedAt = Date.now();
    progressTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setProgress(Math.min(100, Math.round((elapsed / RECORD_MS) * 100)));
    }, 100);
    stopTimerRef.current = window.setTimeout(() => {
      void finishRecording();
    }, RECORD_MS);
  }, [finishRecording, upload]);

  const purchaseUrl = match?.purchase_url;

  return (
    <div className="mt-10 w-full max-w-xl rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <MicIcon className="h-4 w-4" />
        </span>
        <h2 className="text-lg font-semibold text-stone-900">
          Try it now — right here
        </h2>
      </div>
      <p className="mt-2 text-sm text-stone-600 leading-relaxed">
        Tap the button, play a piece nearby for a few seconds, and we&rsquo;ll
        identify it — no app needed. Works best with the music playing loud
        enough for your mic to hear.
      </p>

      {/* Button row */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {phase === "recording" ? (
          <button
            type="button"
            onClick={() => void finishRecording()}
            className="inline-flex min-h-12 items-center gap-2 rounded-full bg-amber-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 active:bg-amber-800"
          >
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
            </span>
            Listening… tap to stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="inline-flex min-h-12 items-center gap-2 rounded-full bg-amber-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 active:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <MicIcon className="h-5 w-5" />
            {phase === "uploading" || phase === "requesting-mic"
              ? "Working…"
              : "Recognize music"}
          </button>
        )}
        {phase === "result" || phase === "error" ? (
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-12 items-center rounded-full border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-700 transition-colors hover:border-amber-400 hover:text-amber-700"
          >
            Try again
          </button>
        ) : null}
      </div>

      {/* Listening progress */}
      {phase === "recording" ? (
        <div className="mt-4" aria-live="polite">
          <div className="flex items-center justify-between text-xs font-medium text-stone-500">
            <span>Listening for music…</span>
            <span>{Math.round((progress / 100) * RECORD_MS / 1000)}s / {RECORD_MS / 1000}s</span>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-stone-200"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Recording progress"
          >
            <div
              className="h-full rounded-full bg-amber-600 transition-[width] duration-100 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Identifying state */}
      {phase === "uploading" ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-stone-600" aria-live="polite">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-amber-600" />
          Identifying what you played…
        </p>
      ) : null}

      {/* Result: match */}
      {phase === "result" && match ? (
        <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:p-5" aria-live="polite">
          <div className="flex items-start gap-4">
            {match.album_art_url ? (
              <img
                src={match.album_art_url}
                alt=""
                loading="lazy"
                className="h-16 w-16 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-2xl">
                🎵
              </span>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                {match.is_public_domain ? "Public domain" : "Recognized"}
              </p>
              <h3 className="mt-0.5 truncate text-lg font-bold text-stone-900">
                {match.title}
              </h3>
              {match.composer ? (
                <p className="truncate text-sm text-stone-600">{match.composer}</p>
              ) : null}
              {(match.catalog || match.confidence != null) ? (
                <p className="mt-0.5 text-xs text-stone-500">
                  {[match.catalog, match.confidence != null
                    ? `${Math.round(match.confidence * 100)}% match`
                    : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {match.is_public_domain && match.sheet_music_available && match.sheet_music_url ? (
              <a
                href={match.sheet_music_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
              >
                View sheet music →
              </a>
            ) : null}
            {match.is_public_domain && !match.sheet_music_available ? (
              <p className="text-sm text-stone-500">
                <span className="font-medium text-stone-700">Score coming soon</span>{" "}
                — this public-domain piece isn&rsquo;t in our quality-checked
                library yet.
              </p>
            ) : null}
            {!match.is_public_domain ? (
              <p className="text-sm text-stone-600">
                Official sheet music is available from licensed retailers:
              </p>
            ) : null}
            {!match.is_public_domain && purchaseUrl ? (
              <div className="flex flex-wrap gap-2">
                <a
                  href={purchaseUrl.musicnotes}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded-full bg-stone-800 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-stone-900"
                >
                  Get the official sheet music
                </a>
                {purchaseUrl.sheetmusicplus ? (
                  <a
                    href={purchaseUrl.sheetmusicplus}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center rounded-full border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:border-amber-400 hover:text-amber-700"
                  >
                    Sheet Music Plus
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>

          {detail ? (
            <p className="mt-3 text-xs text-stone-400">{detail}</p>
          ) : null}
        </div>
      ) : null}

      {/* Result: no match */}
      {phase === "result" && !match ? (
        <p className="mt-5 text-sm text-stone-600" aria-live="polite">
          Couldn&rsquo;t identify that one — try again with the music a bit
          louder, or{" "}
          <a
            href={PLAY_TEST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-800"
          >
            get the app
          </a>{" "}
          for the full experience.
        </p>
      ) : null}

      {/* Error */}
      {phase === "error" && error ? (
        <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4" aria-live="polite">
          <p className="text-sm text-stone-700">{error}</p>
          <a
            href={PLAY_TEST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
          >
            Get the app
          </a>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-stone-400">
        Audio is processed on our server to identify the piece and is not
        stored. Recognized songs you don&rsquo;t own stay on the retailer
        sites — we never host copyrighted sheet music.
      </p>
    </div>
  );
}
