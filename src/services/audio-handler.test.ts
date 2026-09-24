/**
 * Regression tests for the practice-audio proxy (PRE-LAUNCH PASS 2026-09-24).
 *
 * The defect: both server entries routed `/api/audio/*.wav` with
 * `req.method === "GET"`, so a HEAD request — what uptime/link monitors and
 * "is this audio there?" probes send — fell through to SSR and returned
 * **404 `text/html`**, while GET returned 200 `audio/wav`. Live evidence from
 * the deployed backend before the fix: GET `5e74d931-ee6c-4ab5-a92b-3293fe7c7b95.wav`
 * → 200 / 18 088 236 bytes / `audio/wav`; HEAD on the same URL → 404
 * `text/html; charset=utf-8` (the scores route answered HEAD 200 at the same
 * moment — PR #120 fixed that one and left this one behind).
 *
 * These tests pin the handler behaviour (HEAD = same 200 + headers as GET, no
 * body) AND scan the two entry files, because the real bug lived in the route
 * guard, outside anything a handler unit test can reach.
 *
 * Run with: bun test src/services/audio-handler.test.ts
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  handleAudioServe,
  isAudioServeMethod,
  setAudioObjectFetcher,
  type AudioObjectFetcher,
} from "./audio-handler";

const PIECE_ID = "5e74d931-ee6c-4ab5-a92b-3293fe7c7b95";
const AUDIO_URL = `https://site-notesnap.vercel.app/api/audio/${PIECE_ID}.wav`;
// A real riff and its size: the point of HEAD is never transferring this.
const WAV_BYTES = "RIFF....WAVEfmt fake practice-audio bytes";
const CONTENT_LENGTH = String(WAV_BYTES.length);

/** Fake R2: GET streams the bytes, HEAD reports metadata only (as the real one does). */
const fakeR2: AudioObjectFetcher = async (_key, method) =>
  method === "HEAD"
    ? { ok: true, body: null, contentLength: WAV_BYTES.length }
    : { ok: true, body: WAV_BYTES };

const missingR2: AudioObjectFetcher = async () => ({ ok: false, reason: "missing" });
const noR2Config: AudioObjectFetcher = async () => ({ ok: false, reason: "unavailable" });

function req(method: string, url: string = AUDIO_URL): Request {
  return new Request(url, { method });
}

beforeEach(() => setAudioObjectFetcher(fakeR2));
afterEach(() => setAudioObjectFetcher(null));

describe("isAudioServeMethod — the shared route guard", () => {
  test("GET and HEAD are served; anything else is not", () => {
    expect(isAudioServeMethod("GET")).toBe(true);
    expect(isAudioServeMethod("HEAD")).toBe(true);
    // entries read req.method, which may arrive in any case
    expect(isAudioServeMethod("head")).toBe(true);
    expect(isAudioServeMethod("POST")).toBe(false);
    expect(isAudioServeMethod("OPTIONS")).toBe(false);
  });
});

describe("HEAD /api/audio/<id>.wav", () => {
  test("HEAD returns the SAME 200 as GET (the bug: it used to 404 text/html)", async () => {
    const head = await handleAudioServe(req("HEAD"));
    const get = await handleAudioServe(req("GET"));
    expect(head.status).toBe(200);
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("audio/wav");
    expect(await get.text()).toBe(WAV_BYTES);
  });

  test("HEAD carries the same headers as GET and an empty body", async () => {
    const head = await handleAudioServe(req("HEAD"));
    const get = await handleAudioServe(req("GET"));

    for (const header of [
      "content-type",
      "content-disposition",
      "cache-control",
      "access-control-allow-origin",
    ]) {
      expect(head.headers.get(header)).toBe(get.headers.get(header));
    }
    expect(head.headers.get("content-type")).toBe("audio/wav");
    expect(head.headers.get("content-disposition")).toContain(`${PIECE_ID}.wav`);
    // HEAD advertises the size without transferring the WAV
    expect(head.headers.get("content-length")).toBe(CONTENT_LENGTH);
    expect(await head.text()).toBe("");
  });

  test("HEAD does not ask R2 for the WAV body", async () => {
    const seen: string[] = [];
    setAudioObjectFetcher(async (_key, method) => {
      seen.push(method);
      return method === "HEAD"
        ? { ok: true, body: null, contentLength: WAV_BYTES.length }
        : { ok: true, body: WAV_BYTES };
    });
    await handleAudioServe(req("HEAD"));
    expect(seen).toEqual(["HEAD"]);
  });

  test("the R2 key is the piece uuid under audio/ (unchanged by the HEAD fix)", async () => {
    const keys: string[] = [];
    setAudioObjectFetcher(async (key, method) => {
      keys.push(key);
      return method === "HEAD"
        ? { ok: true, body: null, contentLength: 1 }
        : { ok: true, body: WAV_BYTES };
    });
    await handleAudioServe(req("HEAD"));
    await handleAudioServe(req("GET"));
    expect(keys).toEqual([`audio/${PIECE_ID}.wav`, `audio/${PIECE_ID}.wav`]);
  });

  test("GET still streams the WAV (unchanged behaviour, not re-plumbed)", async () => {
    const get = await handleAudioServe(req("GET"));
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("audio/wav");
    expect(await get.text()).toBe(WAV_BYTES);
  });
});

describe("failure paths are identical for GET and HEAD", () => {
  test("a missing audio object is 404 for both", async () => {
    setAudioObjectFetcher(missingR2);
    expect((await handleAudioServe(req("HEAD"))).status).toBe(404);
    expect((await handleAudioServe(req("GET"))).status).toBe(404);
  });

  test("R2 not configured is 503 for both (a monitor must not read it as missing audio)", async () => {
    setAudioObjectFetcher(noR2Config);
    expect((await handleAudioServe(req("HEAD"))).status).toBe(503);
    expect((await handleAudioServe(req("GET"))).status).toBe(503);
  });

  test("a non-uuid path is 404 and a non-GET/HEAD method is 405", async () => {
    expect((await handleAudioServe(req("GET", "https://x.test/api/audio/nope.wav"))).status).toBe(
      404,
    );
    const post = await handleAudioServe(req("POST"));
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toContain("HEAD");
  });
});

// ---------------------------------------------------------------------------
// Source contract: the entries must route HEAD too. The 404 came from the route
// guard (`req.method === "GET"`), so a handler-only test suite would have been
// green while every audio probe saw 404.
// ---------------------------------------------------------------------------
const ROOT = join(import.meta.dir, "..", "..");

/** The single line that guards /api/audio/ in a server entry. */
function audioGuardLine(source: string): string {
  return source.split("\n").find((line) => line.includes('"/api/audio/"')) ?? "";
}

describe("both server entries route HEAD to the audio handler", () => {
  test("serve.ts and vercel-entry.ts use the shared method guard", () => {
    for (const entry of ["serve.ts", "vercel-entry.ts"]) {
      const source = readFileSync(join(ROOT, entry), "utf8");
      const guard = audioGuardLine(source);
      // floor: the guard must be found at all, or this test proves nothing
      expect(guard).toContain('"/api/audio/"');
      // HEAD must survive the guard — this is the line that answered 404
      expect(guard).toContain("isAudioServeMethod");
      // and the path must still reach the audio handler (not SSR)
      expect(source).toContain("handleAudioServe(");
      // `req.method === "GET"` here is exactly the regression: assert it is gone
      expect(guard).not.toContain('req.method === "GET"');
    }
  });

  test("the guard finder is not vacuous: the old GET-only guard fails it", () => {
    const oldGuard =
      '        if (pathname.startsWith("/api/audio/") && req.method === "GET") {';
    expect(audioGuardLine(oldGuard)).toContain('"/api/audio/"');
    expect(audioGuardLine(oldGuard)).not.toContain("isAudioServeMethod");
  });
});
