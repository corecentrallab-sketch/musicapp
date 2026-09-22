/**
 * Link-audit regression guards (owner request 2026-09-22, post-SMD-route-fix).
 *
 * Two bug classes the URL tests cannot see:
 *
 * 1. STALE RETAILER COPY. Prose that names a retailer the product does not link
 *    to (`Sheet Music Plus`, dropped 2026-08-24) passes every URL assertion in
 *    the repo because no URL is wrong — the claim is. Scanned live over `src/`.
 *
 * 2. THE MODERN-SONG MONEY PATH. `/api/recognize-modern` returns `retailerUrl`
 *    built by the same `modernRetailerUrls()` the piece pages use. The live
 *    route can only be probed with real audio and burns AudD quota, so the
 *    serialization from an AudD match -> the affiliate URL is pinned here with a
 *    stubbed provider: if the builder or the adapter ever stops attaching
 *    `tid`/`affiliateId`, or drifts off the live `/en-US/Search.aspx` route,
 *    this fails without a single vendor call.
 *
 * Run with: bun test src/services/retailer-copy-contract.test.ts
 */
import { describe, test, expect, afterEach } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  PRIMARY_RETAILER_LABEL,
  USER_FACING_DIRS,
  isUserFacingCopyPath,
  scanCopyForRetiredRetailers,
} from "./retailer-copy-contract";
import {
  SMD_AFFILIATE_ID,
  SMD_SEARCH_PATH,
  auditSmdAffiliateUrl,
  type ScannedSource,
} from "./affiliate-url-contract";

const SRC_ROOT = join(import.meta.dir, "..");
const THIS_FILE = "services/retailer-copy-contract.test.ts";

function walkSources(dir: string, out: ScannedSource[] = []): ScannedSource[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkSources(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    out.push({ path: relative(SRC_ROOT, full), content: readFileSync(full, "utf8") });
  }
  return out;
}

describe("retailer copy — no user-facing name we do not link to", () => {
  test("no route/component copy names a retired retailer", () => {
    const files = walkSources(SRC_ROOT);
    // Floors: an empty or failed walk must never pass.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => isUserFacingCopyPath(f.path))).toBe(true);
    expect(files.some((f) => f.content.includes("Sheet Music Direct"))).toBe(true);

    const offenders = scanCopyForRetiredRetailers(files, [THIS_FILE]);
    expect(offenders.map((o) => `${o.path}:${o.line} ${o.pattern} — ${o.text}`)).toEqual([]);
  });

  test("the homepage names the retailer the CTAs actually resolve to", () => {
    const home = readFileSync(join(SRC_ROOT, "routes", "index.tsx"), "utf8");
    expect(home).toContain(PRIMARY_RETAILER_LABEL);
  });

  test("the scanner actually catches the stale copy (guard cannot silently no-op)", () => {
    const planted: ScannedSource[] = [
      {
        path: "routes/planted.tsx",
        content: 'desc: "one tap to buy from licensed retailers like Musicnotes and Sheet Music Plus.",',
      },
    ];
    const found = scanCopyForRetiredRetailers(planted, []);
    expect(found.length).toBe(1);
    expect(found[0].path).toBe("routes/planted.tsx");
    expect(found[0].pattern).toBe("Sheet Music Plus");
  });

  test("services/ copy is out of scope (retirement history stays documented)", () => {
    const internal: ScannedSource[] = [
      { path: "services/affiliates.ts", content: "// Sheet Music Plus was dropped as primary." },
    ];
    expect(scanCopyForRetiredRetailers(internal, [])).toEqual([]);
    expect(USER_FACING_DIRS).toEqual(["routes", "components"]);
  });
});

describe("modern-song route — an AudD match must serialize to the live affiliate URL", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function auddSuccessPayload() {
    return {
      status: "success",
      result: {
        artist: "Trito Music",
        title: "Elise's Serenade",
        album: "Piano Serenades",
        score: 100,
        apple_music: {
          isrc: "QZTEST0000001",
          composerName: "Ludwig van Beethoven",
          artwork: { url: "https://example.test/{w}x{h}bb.jpg" },
        },
      },
    };
  }

  function stubAudD(payload: unknown) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
  }

  async function callModernRoute() {
    // PROVIDER / AUDD_API_TOKEN are read at module load — set them first, then
    // import the handler so the real code path (adapter -> builder) runs.
    process.env.MODERN_RECOGNITION_PROVIDER = "audd";
    process.env.AUDD_API_TOKEN = "test-token-not-used";
    const { handleModernRecognize } = await import("./modern-recognize-handler");

    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "capture.m4a", { type: "audio/mp4" }));
    const req = new Request("https://site-notesnap.vercel.app/api/recognize-modern", {
      method: "POST",
      body: form,
    });
    const res = await handleModernRecognize(req);
    return { status: res.status, body: (await res.json()) as any };
  }

  test("returns the live .aspx route with BOTH affiliate params", async () => {
    stubAudD(auddSuccessPayload());
    const { status, body } = await callModernRoute();

    expect(status).toBe(200);
    expect(body.recognized).toBe("modern");
    const retailerUrl: string | undefined = body.modern?.retailerUrl;
    expect(retailerUrl).toBeDefined();

    const url = new URL(retailerUrl!);
    expect(url.pathname).toBe(SMD_SEARCH_PATH);
    expect(url.pathname).toBe("/en-US/Search.aspx");
    expect(url.searchParams.get("tid")).toBe(SMD_AFFILIATE_ID);
    expect(url.searchParams.get("affiliateId")).toBe(SMD_AFFILIATE_ID);
    // the deep link prefers the ISRC when the provider gives one
    expect(url.searchParams.get("query")).toBe("QZTEST0000001");
    expect(auditSmdAffiliateUrl(retailerUrl!).ok).toBe(true);
  });

  test("a provider no-match does not invent a retailer URL", async () => {
    stubAudD({ status: "success", result: null });
    const { status, body } = await callModernRoute();
    expect(status).toBe(200);
    expect(body.recognized).toBe("none");
    expect(body.modern).toBeNull();
  });
});
