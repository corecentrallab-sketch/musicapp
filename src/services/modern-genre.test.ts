/**
 * Modern-song GENRE mapping tests (owner request 09-25).
 *
 * The app used to label every modern-song match "Modern song" — a category
 * mistake the owner reported as "ZZ Top is not classical" and then, after the
 * neutral label landed, as "the label must be a REAL genre". The provider
 * (AudD) carries the genre in its Apple Music / Spotify blocks; this file pins
 * the mapping from a stubbed provider response all the way to the serialized
 * `/api/recognize-modern` body:
 *
 *   • genre PRESENT (appleMusic wins over spotify)
 *   • genre present on SPOTIFY ONLY (the fallback)
 *   • genre ABSENT (field omitted entirely — never invented)
 *   • genre EMPTY ARRAY (same: omitted)
 *
 * Run with: bun test src/services/modern-genre.test.ts
 */
import { describe, test, expect, afterEach } from "bun:test";
import { cleanModernGenre, pickModernGenre } from "./modern-genre";

describe("cleanModernGenre — provider wording kept, only neatened", () => {
  test("title-cases an all-lowercase provider genre", () => {
    expect(cleanModernGenre("hard rock")).toBe("Hard Rock");
    expect(cleanModernGenre("hip hop")).toBe("Hip Hop");
    expect(cleanModernGenre("electronic dance music")).toBe("Electronic Dance Music");
  });

  test("leaves already-cased, punctuated provider genres untouched", () => {
    expect(cleanModernGenre("Modern Jazz")).toBe("Modern Jazz");
    expect(cleanModernGenre("R&B/Soul")).toBe("R&B/Soul");
    expect(cleanModernGenre("Alt- Rock")).toBe("Alt- Rock");
  });

  test("trims, collapses whitespace, and rejects non-strings / blanks", () => {
    expect(cleanModernGenre("  Rock  ")).toBe("Rock");
    expect(cleanModernGenre("")).toBeUndefined();
    expect(cleanModernGenre("   ")).toBeUndefined();
    expect(cleanModernGenre(7)).toBeUndefined();
    expect(cleanModernGenre(null)).toBeUndefined();
    expect(cleanModernGenre(undefined)).toBeUndefined();
  });
});

describe("pickModernGenre — appleMusic.genres > spotify.genres", () => {
  test("prefers the Apple Music genre", () => {
    expect(
      pickModernGenre({
        apple_music: { genres: ["hard rock"] },
        spotify: { genres: ["rock"] },
      }),
    ).toBe("Hard Rock");
  });

  test("falls back to Spotify when Apple Music carries none", () => {
    expect(pickModernGenre({ apple_music: {}, spotify: { genres: ["Modern Jazz"] } })).toBe(
      "Modern Jazz",
    );
  });

  test("skips a blank entry and takes the next usable one", () => {
    expect(pickModernGenre({ apple_music: { genres: ["  ", "Ambient"] } })).toBe("Ambient");
  });

  test("tolerates object entries (Apple Music's own genreNames shape)", () => {
    expect(pickModernGenre({ apple_music: { genreNames: [{ name: "ambient" }] } })).toBe("Ambient");
    expect(pickModernGenre({ apple_music: { genres: [{ genreName: "Jazz" }] } })).toBe("Jazz");
  });

  test("no genre anywhere → undefined (the caller omits the field)", () => {
    expect(pickModernGenre({})).toBeUndefined();
    expect(pickModernGenre({ apple_music: {}, spotify: {} })).toBeUndefined();
    expect(pickModernGenre({ apple_music: { genres: [] } })).toBeUndefined();
    expect(pickModernGenre({ apple_music: { genres: [] }, spotify: { genres: [] } })).toBeUndefined();
    expect(pickModernGenre(null)).toBeUndefined();
    expect(pickModernGenre(undefined)).toBeUndefined();
  });
});

describe("/api/recognize-modern — the genre reaches the app, or the key is absent", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubAudD(result: unknown) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: "success", result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
  }

  function auddResult(extra: Record<string, unknown>) {
    return {
      artist: "ZZ Top",
      title: "Sharp Dressed Man",
      album: "Eliminator",
      score: 100,
      apple_music: { isrc: "USWB1000001", ...(extra.apple as object) },
      ...(extra.spotify ? { spotify: extra.spotify } : {}),
    };
  }

  async function callModernRoute() {
    process.env.MODERN_RECOGNITION_PROVIDER = "audd";
    process.env.AUDD_API_TOKEN = "test-token-not-used";
    const { handleModernRecognize } = await import("./modern-recognize-handler");
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "capture.m4a", { type: "audio/mp4" }));
    const req = new Request("https://site-notesnap.vercel.app/api/recognize-modern", {
      method: "POST",
      body: form,
      headers: {
        "x-capture-duration-ms": "12400",
        "x-capture-peak-dbfs": "-18.5",
        "x-capture-bytes": "198345",
      },
    });
    const res = await handleModernRecognize(req);
    return { status: res.status, body: (await res.json()) as any };
  }

  test("a provider genre is serialized as the match's genre (title-cased)", async () => {
    stubAudD(auddResult({ apple: { genres: ["hard rock"] } }));
    const { status, body } = await callModernRoute();
    expect(status).toBe(200);
    expect(body.modern.genre).toBe("Hard Rock");
  });

  test("Apple Music wins over Spotify in the serialized match", async () => {
    stubAudD(
      auddResult({ apple: { genres: ["hard rock"] }, spotify: { genres: ["rock"] } }),
    );
    const { body } = await callModernRoute();
    expect(body.modern.genre).toBe("Hard Rock");
  });

  test("Spotify-only genre still reaches the app", async () => {
    stubAudD(auddResult({ spotify: { genres: ["Modern Jazz"] } }));
    const { body } = await callModernRoute();
    expect(body.modern.genre).toBe("Modern Jazz");
  });

  test("no genre → the field is OMITTED, not null and not invented", async () => {
    stubAudD(auddResult({}));
    const { body } = await callModernRoute();
    expect("genre" in body.modern).toBe(false);
    expect(body.modern.genre).toBeUndefined();
  });

  test("an empty genres array → the field is OMITTED", async () => {
    stubAudD(auddResult({ apple: { genres: [] }, spotify: { genres: [] } }));
    const { body } = await callModernRoute();
    expect("genre" in body.modern).toBe(false);
  });

  test("the capture diagnostics headers are NOT echoed in the body", async () => {
    stubAudD(auddResult({ apple: { genres: ["hard rock"] } }));
    const { body } = await callModernRoute();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("12400");
    expect(serialized).not.toContain("-18.5");
    expect(serialized).not.toContain("198345");
    expect(serialized).not.toContain("x-capture");
  });
});
