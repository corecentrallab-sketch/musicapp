/**
 * Tests for the notes proxy (`notes-handler.ts`) and the routing of `/api/notes/` in BOTH
 * server entries.
 *
 * Two defect classes are pinned here:
 *   1. HEAD falling through to SSR (the 2026-09-22 link audit made all 78 scores look broken
 *      because the route guard was GET-only). The same guard exists here, and the entry files
 *      are scanned as TEXT because the real bug lives outside anything a handler test reaches.
 *   2. Serving a non-MIDI object with a MIDI label. The ingest gate refuses to store one; this
 *      route refuses to hand one out (`415`), so a stale or wrongly-written object cannot reach
 *      the app dressed as notes.
 *
 * Run with: bun test src/services/notes-handler.test.ts
 */
import { describe, test, expect, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  handleNotesServe,
  isNotesServeMethod,
  isServableMidiContentType,
  setNotesObjectFetcher,
  type NotesObjectFetcher,
} from "./notes-handler";

const PIECE_ID = "0e1e4700-dc96-47f5-8ef9-11c7324150ef";
const NOTES_URL = `https://site-notesnap.vercel.app/api/notes/${PIECE_ID}.mid`;

const MIDI_BYTES = new Uint8Array(14);
MIDI_BYTES.set([0x4d, 0x54, 0x68, 0x64], 0); // MThd
MIDI_BYTES.set([0, 0, 0, 6, 0, 1, 0, 3, 0x01, 0xe0], 4);

/** Fake R2: GET streams the bytes, HEAD reports metadata only (as the real one does). */
const fakeR2: NotesObjectFetcher = async (_key, method) =>
  method === "HEAD"
    ? { ok: true, body: null, contentLength: MIDI_BYTES.byteLength, contentType: "audio/sp-midi" }
    : { ok: true, body: MIDI_BYTES as unknown as BodyInit, contentLength: MIDI_BYTES.byteLength, contentType: "audio/sp-midi" };

afterEach(() => setNotesObjectFetcher(null));

function req(method = "GET", url = NOTES_URL): Request {
  return new Request(url, { method });
}

describe("GET /api/notes/<id>.mid", () => {
  test("streams the stored MIDI with the MIDI content type and immutable caching", async () => {
    setNotesObjectFetcher(fakeR2);
    const res = await handleNotesServe(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/sp-midi");
    expect(res.headers.get("Content-Disposition")).toBe(`inline; filename="${PIECE_ID}.mid"`);
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBe(MIDI_BYTES.byteLength);
    expect(Buffer.from(body.subarray(0, 4)).toString("latin1")).toBe("MThd");
  });

  test("HEAD answers the same status + headers with no body", async () => {
    setNotesObjectFetcher(fakeR2);
    const res = await handleNotesServe(req("HEAD"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/sp-midi");
    expect(res.headers.get("Content-Length")).toBe(String(MIDI_BYTES.byteLength));
    expect(await res.text()).toBe("");
  });

  test("a missing object is 404 (never a 200 with an empty body)", async () => {
    setNotesObjectFetcher(async () => ({ ok: false, reason: "missing" }));
    expect((await handleNotesServe(req())).status).toBe(404);
  });

  test("unconfigured R2 is 503, not 404", async () => {
    setNotesObjectFetcher(async () => ({ ok: false, reason: "unavailable" }));
    expect((await handleNotesServe(req())).status).toBe(503);
  });

  test("a stored object that is NOT a MIDI file is 415 — never served under a MIDI label", async () => {
    setNotesObjectFetcher(async () => ({
      ok: true,
      body: new TextEncoder().encode("<html>directory listing</html>") as unknown as BodyInit,
      contentLength: 31,
      contentType: "text/html",
    }));
    const res = await handleNotesServe(req());
    expect(res.status).toBe(415);
    expect(await res.text()).toContain("not a MIDI file");
  });

  test("a stored object with no content type is 415", async () => {
    setNotesObjectFetcher(async () => ({
      ok: true,
      body: MIDI_BYTES as unknown as BodyInit,
      contentType: null,
    }));
    expect((await handleNotesServe(req())).status).toBe(415);
  });

  test("the R2 key is derived from the piece id", async () => {
    const seen: string[] = [];
    setNotesObjectFetcher(async (key, method) => {
      seen.push(key);
      return fakeR2(key, method);
    });
    await handleNotesServe(req());
    expect(seen).toEqual([`notes/${PIECE_ID}.mid`]);
  });

  test("a non-.mid path and a non-uuid id are both 404", async () => {
    setNotesObjectFetcher(fakeR2);
    expect((await handleNotesServe(req("GET", `https://x/api/notes/${PIECE_ID}.pdf`))).status).toBe(404);
    expect((await handleNotesServe(req("GET", "https://x/api/notes/not-a-uuid.mid"))).status).toBe(404);
  });

  test("POST/PUT are 405 with an Allow header", async () => {
    setNotesObjectFetcher(fakeR2);
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await handleNotesServe(req(method));
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("GET, HEAD");
    }
  });
});

describe("route guard + entry wiring", () => {
  test("isNotesServeMethod accepts exactly GET and HEAD", () => {
    expect(isNotesServeMethod("GET")).toBe(true);
    expect(isNotesServeMethod("head")).toBe(true);
    expect(isNotesServeMethod("POST")).toBe(false);
    expect(isNotesServeMethod("OPTIONS")).toBe(false);
  });

  test("isServableMidiContentType accepts the MIDI types and nothing else", () => {
    expect(isServableMidiContentType("audio/sp-midi")).toBe(true);
    expect(isServableMidiContentType("audio/sp-midi; charset=binary")).toBe(true);
    expect(isServableMidiContentType("audio/midi")).toBe(true);
    expect(isServableMidiContentType("text/html")).toBe(false);
    expect(isServableMidiContentType("application/pdf")).toBe(false);
    expect(isServableMidiContentType("")).toBe(false);
    expect(isServableMidiContentType(null)).toBe(false);
  });

  test("SOURCE SCAN: BOTH server entries route /api/notes/ with the shared guard", () => {
    // The defect this catches: adding a route to serve.ts and forgetting vercel-entry.ts
    // (or vice versa) — the handler is then dead in production while the dev server works.
    for (const entry of ["serve.ts", "vercel-entry.ts"]) {
      const src = readFileSync(join(import.meta.dir, "..", "..", entry), "utf8");
      expect(src).toContain('pathname.startsWith("/api/notes/")');
      expect(src).toContain("isNotesServeMethod(req.method)");
      expect(src).toContain("handleNotesServe(");
      expect(src).toContain('from "./src/services/notes-handler"');
    }
  });
});
