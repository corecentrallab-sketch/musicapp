/**
 * Regression tests for the score proxy (LINK AUDIT 2026-09-22).
 *
 * The defect: both server entries routed `/api/sheets/*.pdf` with
 * `req.method === "GET"`, so a HEAD request — what uptime/link monitors send —
 * fell through to SSR and returned **404**, making all 78 scores look broken even
 * though GET returned 200. These tests pin the handler behaviour (HEAD = same
 * 200 + headers as GET, no body) AND scan the two entry files, because the real
 * bug lived in the route guard, outside anything a handler unit test can reach.
 *
 * Run with: bun test src/services/sheet-handler.test.ts
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  handleSheetServe,
  isSheetServeMethod,
  setSheetObjectFetcher,
  type SheetObjectFetcher,
} from "./sheet-handler";

const PIECE_ID = "4a1b7d2c-1111-4222-8333-9999aaaabbbb";
const SHEET_URL = `https://site-notesnap.vercel.app/api/sheets/${PIECE_ID}.pdf`;
const PDF_BYTES = "%PDF-1.4 fake score bytes";
const CONTENT_LENGTH = String(PDF_BYTES.length);

/** Fake R2: GET streams the bytes, HEAD reports metadata only (as the real one does). */
const fakeR2: SheetObjectFetcher = async (_key, method) =>
  method === "HEAD"
    ? { ok: true, body: null, contentLength: PDF_BYTES.length }
    : { ok: true, body: PDF_BYTES };

const missingR2: SheetObjectFetcher = async () => ({ ok: false, reason: "missing" });
const noR2Config: SheetObjectFetcher = async () => ({ ok: false, reason: "unavailable" });

function req(method: string, url: string = SHEET_URL): Request {
  return new Request(url, { method });
}

beforeEach(() => setSheetObjectFetcher(fakeR2));
afterEach(() => setSheetObjectFetcher(null));

describe("isSheetServeMethod — the shared route guard", () => {
  test("GET and HEAD are served; anything else is not", () => {
    expect(isSheetServeMethod("GET")).toBe(true);
    expect(isSheetServeMethod("HEAD")).toBe(true);
    // entries read req.method, which may arrive in any case
    expect(isSheetServeMethod("head")).toBe(true);
    expect(isSheetServeMethod("POST")).toBe(false);
    expect(isSheetServeMethod("OPTIONS")).toBe(false);
  });
});

describe("HEAD /api/sheets/<id>.pdf", () => {
  test("HEAD returns the SAME 200 as GET (the audit: it used to 404)", async () => {
    const head = await handleSheetServe(req("HEAD"));
    const get = await handleSheetServe(req("GET"));
    expect(head.status).toBe(200);
    expect(get.status).toBe(200);
    expect(await get.text()).toBe(PDF_BYTES);
  });

  test("HEAD carries the same headers as GET and an empty body", async () => {
    const head = await handleSheetServe(req("HEAD"));
    const get = await handleSheetServe(req("GET"));

    for (const header of [
      "content-type",
      "content-disposition",
      "cache-control",
      "access-control-allow-origin",
    ]) {
      expect(head.headers.get(header)).toBe(get.headers.get(header));
    }
    expect(head.headers.get("content-type")).toBe("application/pdf");
    expect(head.headers.get("content-disposition")).toContain(`${PIECE_ID}.pdf`);
    // HEAD advertises the size without transferring the PDF
    expect(head.headers.get("content-length")).toBe(CONTENT_LENGTH);
    expect(await head.text()).toBe("");
  });

  test("HEAD does not ask R2 for the PDF body", async () => {
    const seen: string[] = [];
    setSheetObjectFetcher(async (_key, method) => {
      seen.push(method);
      return method === "HEAD"
        ? { ok: true, body: null, contentLength: PDF_BYTES.length }
        : { ok: true, body: PDF_BYTES };
    });
    await handleSheetServe(req("HEAD"));
    expect(seen).toEqual(["HEAD"]);
  });

  test("GET still streams the PDF (unchanged behaviour, not re-plumbed)", async () => {
    const get = await handleSheetServe(req("GET"));
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("application/pdf");
    expect(await get.text()).toBe(PDF_BYTES);
  });
});

describe("failure paths are identical for GET and HEAD", () => {
  test("a missing score is 404 for both", async () => {
    setSheetObjectFetcher(missingR2);
    expect((await handleSheetServe(req("HEAD"))).status).toBe(404);
    expect((await handleSheetServe(req("GET"))).status).toBe(404);
  });

  test("R2 not configured is 503 for both (a monitor must not read it as a missing score)", async () => {
    setSheetObjectFetcher(noR2Config);
    expect((await handleSheetServe(req("HEAD"))).status).toBe(503);
    expect((await handleSheetServe(req("GET"))).status).toBe(503);
  });

  test("a non-uuid path is 404 and a non-GET/HEAD method is 405", async () => {
    expect((await handleSheetServe(req("GET", "https://x.test/api/sheets/nope.pdf"))).status).toBe(
      404,
    );
    const post = await handleSheetServe(req("POST"));
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toContain("HEAD");
  });
});

// ---------------------------------------------------------------------------
// Source contract: the entries must route HEAD too. The 404 came from the route
// guard (`req.method === "GET"`), so a handler-only test suite would have been
// green while every monitor saw 404.
// ---------------------------------------------------------------------------
const ROOT = join(import.meta.dir, "..", "..");

/** The single line that guards /api/sheets/ in a server entry. */
function sheetsGuardLine(source: string): string {
  return source.split("\n").find((line) => line.includes('"/api/sheets/"')) ?? "";
}

describe("both server entries route HEAD to the sheet handler", () => {
  test("serve.ts and vercel-entry.ts use the shared method guard", () => {
    for (const entry of ["serve.ts", "vercel-entry.ts"]) {
      const source = readFileSync(join(ROOT, entry), "utf8");
      const guard = sheetsGuardLine(source);
      // floor: the guard must be found at all, or this test proves nothing
      expect(guard).toContain('"/api/sheets/"');
      // HEAD must survive the guard — this is the line that answered 404
      expect(guard).toContain("isSheetServeMethod");
      // and the path must still reach the sheet handler (not SSR)
      expect(source).toContain("handleSheetServe(");
      // `req.method === "GET"` here is exactly the regression: assert it is gone
      expect(guard).not.toContain('req.method === "GET"');
    }
  });

  test("the guard finder is not vacuous: the old GET-only guard fails it", () => {
    const oldGuard =
      '        if (pathname.startsWith("/api/sheets/") && req.method === "GET") {';
    expect(sheetsGuardLine(oldGuard)).toContain('"/api/sheets/"');
    expect(sheetsGuardLine(oldGuard)).not.toContain("isSheetServeMethod");
  });
});
