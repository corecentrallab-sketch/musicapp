/**
 * App → server REQUEST contract guards (09-25).
 *
 * TWO bug classes, both invisible to every other test in this repo:
 *
 * 1. MULTIPART FIELD DRIFT. /api/recognize and /api/hum read "audio";
 *    /api/recognize-modern reads "file". A drift does not 500 — the handler
 *    answers a 400 "missing file", which on a phone looks exactly like a failed
 *    recognition. (The lead's own wrong-field probe hit this on 09-25.) The live
 *    handler sources are read from disk and pinned against
 *    src/services/upload-field-contract.ts, which mirrors the app's call sites.
 *
 * 2. CAPTURE DIAGNOSTICS REACHING THE LOGS. The app sends
 *    x-capture-duration-ms / x-capture-peak-dbfs / x-capture-bytes (V26, 09-25)
 *    so an on-device "No Match Found" is measurable. The readout must be logged
 *    when present, and must NEVER land in a response body.
 *
 * Run with: bun test src/services/upload-contract.test.ts
 */
import { describe, test, expect, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HANDLER_UPLOAD_FIELDS,
  auditUploadFields,
  readUploadField,
} from "./upload-field-contract";
import {
  CAPTURE_HEADER_NAMES,
  formatCaptureHeaders,
  hasCaptureHeaders,
  logCaptureHeaders,
  readCaptureHeaders,
} from "./capture-headers";

const REPO_ROOT = join(import.meta.dir, "..", "..");

function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function liveHandlerFiles() {
  return HANDLER_UPLOAD_FIELDS.map((e) => ({ path: e.path, content: readSource(e.path) }));
}

describe("multipart upload field names — the live handlers read what the app sends", () => {
  test("every handler reads its contracted field", () => {
    const files = liveHandlerFiles();
    // Floors: the walk must have found real handler sources, not empty strings.
    expect(files.length).toBe(HANDLER_UPLOAD_FIELDS.length);
    expect(files.every((f) => f.content.length > 1000)).toBe(true);
    expect(files.some((f) => f.content.includes("formData.get("))).toBe(true);

    expect(auditUploadFields(files)).toEqual([]);
  });

  test("the contract itself states the live names (audio/audio/file)", () => {
    expect(HANDLER_UPLOAD_FIELDS.map((e) => `${e.route}=${e.field}`)).toEqual([
      "/api/recognize=audio",
      "/api/hum=audio",
      "/api/recognize-modern=file",
    ]);
  });

  test("the modern handler really reads `file` and NOT `audio`", () => {
    const modern = readSource("src/services/modern-recognize-handler.ts");
    expect(readUploadField(modern)?.field).toBe("file");
    expect(modern).not.toContain('form.get("audio")');
  });

  test("the recognize + hum handlers really read `audio`", () => {
    expect(readUploadField(readSource("src/services/recognize-handler.ts"))?.field).toBe("audio");
    expect(readUploadField(readSource("src/services/hum/hum-handler.ts"))?.field).toBe("audio");
  });

  test("the audit FAILS on the mutated (drifted) field — the guard is not vacuous", () => {
    const drifted = liveHandlerFiles().map((f) =>
      f.path === "src/services/modern-recognize-handler.ts"
        ? { ...f, content: f.content.replace('form.get("file")', 'form.get("audio")') }
        : f,
    );
    const findings = auditUploadFields(drifted);
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain("src/services/modern-recognize-handler.ts");
    expect(findings[0]).toContain('reads field "audio" but the app uploads "file"');
  });

  test("a handler with no upload read at all is a finding", () => {
    const crippled = liveHandlerFiles().map((f) =>
      f.path === "src/services/hum/hum-handler.ts"
        ? { ...f, content: "export const x = 1;".padEnd(1200, " ") }
        : f,
    );
    const findings = auditUploadFields(crippled);
    expect(findings.length).toBe(1);
    expect(findings[0]).toContain("src/services/hum/hum-handler.ts");
    expect(findings[0]).toContain("no form.get(...) upload read found");
  });

  test("readUploadField reports the line and ignores non-reads", () => {
    const src = ["// formData.get(\"audio\") in a comment only", "const a = 1;", 'const f = formData.get("file");'].join(
      "\n",
    );
    expect(readUploadField(src)).toEqual({ field: "audio", line: 1 });
    expect(readUploadField("const f = formData.get('audio');")).toEqual({ field: "audio", line: 1 });
  });
});

describe("capture diagnostics headers — logged when present, never in a body", () => {
  function reqWith(headers: Record<string, string>): Request {
    return new Request("https://site-notesnap.vercel.app/api/recognize", { method: "POST", headers });
  }

  test("reads the three numbers, tolerating junk and absences", () => {
    const readout = readCaptureHeaders(
      reqWith({
        "x-capture-duration-ms": "12400",
        "x-capture-peak-dbfs": "-18.5",
        "x-capture-bytes": "198345",
      }),
    );
    expect(readout).toEqual({ durationMs: 12400, peakDbFS: -18.5, bytes: 198345 });

    expect(readCaptureHeaders(reqWith({}))).toEqual({ durationMs: null, peakDbFS: null, bytes: null });
    expect(
      readCaptureHeaders(
        reqWith({ "x-capture-duration-ms": "not-a-number", "x-capture-bytes": "Infinity" }),
      ),
    ).toEqual({ durationMs: null, peakDbFS: null, bytes: null });
  });

  test("the header names are the ones the app sends", () => {
    expect(CAPTURE_HEADER_NAMES).toEqual([
      "x-capture-duration-ms",
      "x-capture-peak-dbfs",
      "x-capture-bytes",
    ]);
  });

  test("the log line carries duration, level and size — and nothing when absent", () => {
    const line = formatCaptureHeaders({ durationMs: 12400, peakDbFS: -18.5, bytes: 198345 });
    expect(line).toContain("dur=12400ms");
    expect(line).toContain("peak=-18.5dB");
    expect(line).toContain("bytes=198345B");
    expect(hasCaptureHeaders({ durationMs: null, peakDbFS: null, bytes: null })).toBe(false);
    expect(formatCaptureHeaders({ durationMs: null, peakDbFS: null, bytes: null })).toBeNull();
  });

  test("logCaptureHeaders logs a labelled line only when the app sent numbers", () => {
    const logged: string[] = [];
    logCaptureHeaders("[recognize]", reqWith({ "x-capture-bytes": "198345" }), (l) => logged.push(l));
    expect(logged.length).toBe(1);
    expect(logged[0]).toStartWith("[recognize] capture ");
    expect(logged[0]).toContain("bytes=198345B");

    logged.length = 0;
    logCaptureHeaders("[recognize]", reqWith({}), (l) => logged.push(l));
    expect(logged).toEqual([]);
  });

  test("every recognition route logs them (live sources)", () => {
    expect(readSource("src/services/recognize-handler.ts")).toContain('logCaptureHeaders("[recognize]", req)');
    expect(readSource("src/services/hum/hum-handler.ts")).toContain('logCaptureHeaders("[hum]", req)');
    expect(readSource("src/services/modern-recognize-handler.ts")).toContain(
      'logCaptureHeaders("[recognize-modern]", req)',
    );
  });

  test("the live /api/recognize-modern logs the headers and keeps them out of the body", async () => {
    const realFetch = globalThis.fetch;
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            status: "success",
            result: { artist: "ZZ Top", title: "Sharp Dressed Man", score: 100, apple_music: {} },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )) as typeof fetch;

      process.env.MODERN_RECOGNITION_PROVIDER = "audd";
      process.env.AUDD_API_TOKEN = "test-token-not-used";
      const { handleModernRecognize } = await import("./modern-recognize-handler");

      const form = new FormData();
      form.append(
        "file",
        new File([new Uint8Array([1, 2, 3, 4])], "capture.m4a", { type: "audio/mp4" }),
      );
      const req = new Request("https://site-notesnap.vercel.app/api/recognize-modern", {
        method: "POST",
        body: form,
        headers: { "x-capture-duration-ms": "9100", "x-capture-peak-dbfs": "-31.2" },
      });
      const res = await handleModernRecognize(req);
      const body = (await res.json()) as Record<string, unknown>;

      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.startsWith("[recognize-modern] capture ") && l.includes("dur=9100ms"))).toBe(true);
      expect(JSON.stringify(body)).not.toContain("9100");
      expect(JSON.stringify(body)).not.toContain("-31.2");
    } finally {
      globalThis.fetch = realFetch;
      log.mockRestore();
    }
  });
});
