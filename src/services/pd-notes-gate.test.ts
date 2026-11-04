/**
 * Regression tests for the PD notes gate (`pd-notes-gate.ts`) — Stage 1 of the guitar plan.
 *
 * These are the four guards the brief demands, plus the parsing rules they rest on. Each guard
 * is written so that DELETING the rule it protects makes it fail; the mutation evidence for
 * every one is captured in the session report (`/home/team/shared/PD-GUITAR-NOTES-EVIDENCE.md`).
 *
 *   1. a non-PD row cannot be ingested      → CC-BY-SA (Mutopia 2041) and CC-BY (Mutopia 1656)
 *   2. the Olson / alive-composer trap      → Mutopia 2201, refused by the denylist AND, with
 *                                             the denylist emptied, by the general death-year
 *                                             rule — each on its own
 *   3. a bad notes payload cannot be stored → a directory/HTML body served as audio/sp-midi, a
 *                                             MIDI body served as text/html, and a truncated body
 *   4. duplicate identity cannot enter      → the same work under two Mutopia ids (Bach's
 *                                             *Menuet in G*, 102 & 695) keeps one and reports
 *                                             the other, and the migration's UNIQUE constraints
 *                                             are asserted on the SQL text
 *
 * Run with: bun test src/services/pd-notes-gate.test.ts
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALIVE_COMPOSER_DENYLIST,
  MIDI_CONTENT_TYPES,
  NOTES_CONTENT_TYPE,
  PD_DEATH_YEAR_BASELINE,
  PD_LICENCE_TEXT,
  foldForIdentity,
  identityKey,
  isCreativeCommonsLicence,
  isProvablyPublicDomainComposer,
  isPublicDomainLicence,
  isSingleGuitar,
  notesObjectKey,
  notesUrlForPieceId,
  parseComposerLife,
  planNotesIngest,
  validateMidiPayload,
  workKey,
  type MutopiaRow,
} from "./pd-notes-gate";

// ---------------------------------------------------------------------------
// Fixtures — REAL rows from the 2026-11-04 Mutopia sweep, verbatim
// ---------------------------------------------------------------------------

/** Mutopia 44 — Bach, BWV 997 Prelude, `for Guitar`, Public Domain. The happy path. */
const BACH_44: MutopiaRow = {
  id: 44,
  title: "Prelude to Suite in C Major",
  composer: "by J. S. Bach (1685–1750)",
  opus: "BWV 997",
  instrument: "for Guitar",
  year: "&nbsp;",
  style: "Baroque",
  lic_key: "publicdomain",
  lic_text: "Public Domain",
  mid: "https://www.mutopiaproject.org/ftp/BachJS/BWV997/Bach_Preludio_BWV997/Bach_Preludio_BWV997.mid",
  ly: "https://www.mutopiaproject.org/ftp/BachJS/BWV997/Bach_Preludio_BWV997/Bach_Preludio_BWV997.ly",
};

/** Mutopia 2201 — the trap. Labelled Public Domain; composer Jeffrey Olson was born in 1947. */
const OLSON_2201: MutopiaRow = {
  id: 2201,
  title: "Recuerdos de la Luna",
  composer: "by Jeffrey Olson (1947–)",
  opus: "&nbsp;",
  instrument: "for Guitar",
  year: "1896",
  style: "Romantic",
  lic_key: "publicdomain",
  lic_text: "Public Domain",
  mid: "https://www.mutopiaproject.org/ftp/OlsonJJ/recuerdos-luna/recuerdos-luna.mid",
  ly: "https://www.mutopiaproject.org/ftp/OlsonJJ/recuerdos-luna/recuerdos-luna.ly",
};

/** Mutopia 2041 — Aguado, CC-BY-SA 4.0, single guitar. Refused on the licence alone. */
const AGUADO_2041_CCBYSA: MutopiaRow = {
  id: 2041,
  title: "8 Petites Pièces for Guitar, No. 1",
  composer: "by D. Aguado (1784–1849)",
  opus: "Op. 3 No. 1",
  instrument: "for Guitar",
  year: "1830",
  style: "Romantic",
  lic_key: "ccasa",
  lic_text: "Creative Commons Attribution-ShareAlike 4.0",
  mid: "https://www.mutopiaproject.org/ftp/AguadoD/O3/aguado-op03n01/aguado-op03n01.mid",
  ly: "https://www.mutopiaproject.org/ftp/AguadoD/O3/aguado-op03n01/aguado-op03n01.ly",
};

/** Mutopia 1656 — Carulli, CC-BY 4.0, single guitar. Refused on the licence alone. */
const CARULLI_1656_CCBY: MutopiaRow = {
  id: 1656,
  title: "Guitar-Skole no. 1 : Waltz, op. 241, no 1",
  composer: "by F. Carulli (1770–1841)",
  opus: "&nbsp;",
  instrument: "for Guitar",
  year: "&nbsp;",
  style: "Classical",
  lic_key: "cca",
  lic_text: "Creative Commons Attribution 4.0",
  mid: "https://www.mutopiaproject.org/ftp/CarulliF/guitar-skole-no-01/guitar-skole-no-01.mid",
  ly: "",
};

/** Mutopia 2206 — Bach BWV 846 arranged `for 2 Guitars`. Out of scope: two fretboards. */
const BACH_2206_TWO_GUITARS: MutopiaRow = {
  id: 2206,
  title: "Das Wohltemperierte Klavier I, Praeludium I",
  composer: "by J. S. Bach (1685–1750)",
  opus: "BWV 846",
  instrument: "for 2 Guitars",
  year: "1722",
  style: "Baroque",
  lic_key: "publicdomain",
  lic_text: "Public Domain",
  mid: "https://www.mutopiaproject.org/ftp/BachJS/BWV846/wtk1-prelude1-guitar-duo/wtk1-prelude1-guitar-duo.mid",
  ly: "https://www.mutopiaproject.org/ftp/BachJS/BWV846/wtk1-prelude1-guitar-duo/wtk1-prelude1-guitar-duo.ly",
};

/** A real Standard MIDI File header: format 1, 3 tracks, 480 ticks/quarter. */
function midiBytes(opts: { format?: number; tracks?: number; division?: number; headerLen?: number } = {}) {
  const b = new Uint8Array(14);
  b.set([0x4d, 0x54, 0x68, 0x64], 0); // MThd
  const len = opts.headerLen ?? 6;
  b[4] = (len >>> 24) & 0xff;
  b[5] = (len >>> 16) & 0xff;
  b[6] = (len >>> 8) & 0xff;
  b[7] = len & 0xff;
  const fmt = opts.format ?? 1;
  b[8] = (fmt >>> 8) & 0xff;
  b[9] = fmt & 0xff;
  const tracks = opts.tracks ?? 3;
  b[10] = (tracks >>> 8) & 0xff;
  b[11] = tracks & 0xff;
  const div = opts.division ?? 480;
  b[12] = (div >>> 8) & 0xff;
  b[13] = div & 0xff;
  return b;
}

const HTML_BODY = new TextEncoder().encode(
  "<!DOCTYPE html><html><body><h1>Index of /ftp/BachJS/BWV997/</h1></body></html>",
);

// ---------------------------------------------------------------------------
// GUARD 1 — a non-PD row can never be ingested
// ---------------------------------------------------------------------------

describe("GUARD 1 — only a row whose own licence field reads 'Public Domain' may be ingested", () => {
  test("CC-BY-SA 4.0 single-guitar row (Mutopia 2041) is REJECTED, not skipped", () => {
    const plan = planNotesIngest([AGUADO_2041_CCBYSA]);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].reason).toBe("licence-not-public-domain");
    expect(plan.rejected[0].detail).toContain("Creative Commons Attribution-ShareAlike 4.0");
    expect(plan.rejectionCounts["licence-not-public-domain"]).toBe(1);
    // The row is otherwise perfectly ingestible — this is the licence doing the work.
    expect(isProvablyPublicDomainComposer(AGUADO_2041_CCBYSA.composer)).toBe(true);
    expect(isSingleGuitar(AGUADO_2041_CCBYSA.instrument)).toBe(true);
    expect(AGUADO_2041_CCBYSA.mid).not.toBe("");
  });

  test("CC-BY 4.0 single-guitar row (Mutopia 1656) is REJECTED, not skipped", () => {
    const plan = planNotesIngest([CARULLI_1656_CCBY]);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected[0].reason).toBe("licence-not-public-domain");
    expect(plan.rejected[0].detail).toContain("Creative Commons Attribution 4.0");
    expect(plan.rejected[0].detail).toContain("not approved for this build");
  });

  test("a PD row beside a CC row: exactly one is accepted, the CC one is counted", () => {
    const plan = planNotesIngest([BACH_44, CARULLI_1656_CCBY, AGUADO_2041_CCBYSA]);
    expect(plan.examined).toBe(3);
    expect(plan.accepted.map((a) => a.row.id)).toEqual([44]);
    expect(plan.rejectionCounts["licence-not-public-domain"]).toBe(2);
  });

  test("the licence comparison is exact — a phrase containing 'Public Domain' is not PD", () => {
    expect(isPublicDomainLicence(PD_LICENCE_TEXT)).toBe(true);
    expect(isPublicDomainLicence("  public   domain. ")).toBe(true);
    expect(isPublicDomainLicence("Public Domain in the US; not for commercial use")).toBe(false);
    expect(isPublicDomainLicence("Public Domain Mark 1.0")).toBe(false);
    expect(isPublicDomainLicence("")).toBe(false);
    expect(isPublicDomainLicence("CC0")).toBe(false);
    expect(isCreativeCommonsLicence("Creative Commons Attribution 4.0")).toBe(true);
    expect(isCreativeCommonsLicence("Public Domain")).toBe(false);
  });

  test("a row with no licence at all is refused as 'licence-missing' (silence is not a licence)", () => {
    const plan = planNotesIngest([{ ...BACH_44, lic_text: "", lic_key: "" }]);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected[0].reason).toBe("licence-missing");
    expect(plan.rejectionCounts["licence-missing"]).toBe(1);
  });

  test("every rejection reason is present in the totals, even at zero", () => {
    const plan = planNotesIngest([BACH_44]);
    expect(Object.keys(plan.rejectionCounts).sort()).toEqual(
      [
        "composer-not-provably-pd",
        "denylisted-alive-composer",
        "duplicate-identity",
        "instrument-not-single-guitar",
        "licence-missing",
        "licence-not-public-domain",
        "no-midi-source",
      ].sort(),
    );
    expect(plan.rejected).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GUARD 2 — the alive-composer trap
// ---------------------------------------------------------------------------

describe("GUARD 2 — a 'Public Domain' label never beats a living composer (Mutopia 2201)", () => {
  test("id 2201 is refused by the explicit denylist", () => {
    const plan = planNotesIngest([OLSON_2201]);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].reason).toBe("denylisted-alive-composer");
    expect(plan.rejected[0].detail).toContain("1947");
    expect(ALIVE_COMPOSER_DENYLIST["2201"]).toBeTruthy();
    // Its licence label really does say Public Domain — the label is what the trap exploits.
    expect(isPublicDomainLicence(OLSON_2201.lic_text)).toBe(true);
  });

  test("with the denylist EMPTY the general death-year rule still refuses it", () => {
    const plan = planNotesIngest([OLSON_2201], { denylist: {} });
    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected[0].reason).toBe("composer-not-provably-pd");
    expect(plan.rejected[0].detail).toContain("no death year");
  });

  test("the general rule is about the DATES, not the name — an unknown composer is refused too", () => {
    const unknown = { ...BACH_44, id: 9999, composer: "by Anon." };
    const plan = planNotesIngest([unknown]);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected[0].reason).toBe("composer-not-provably-pd");
  });

  test("a composer who died after the baseline is refused even with a PD label", () => {
    const late = { ...BACH_44, id: 9998, composer: "by A. Latecomer (1901–1985)" };
    const plan = planNotesIngest([late]);
    expect(plan.rejected[0].reason).toBe("composer-not-provably-pd");
    expect(plan.rejected[0].detail).toContain("1985");
  });

  test("life dates parse from both live shapes, including the en-dash", () => {
    expect(parseComposerLife("by D. Aguado (1784–1849)")).toEqual({
      birth: 1784,
      death: 1849,
      name: "D. Aguado",
    });
    expect(parseComposerLife("by Jeffrey Olson (1947–)")).toEqual({
      birth: 1947,
      death: null,
      name: "Jeffrey Olson",
    });
    expect(parseComposerLife("by Jeffrey Olson (1947-)")).toEqual({
      birth: 1947,
      death: null,
      name: "Jeffrey Olson",
    });
    expect(parseComposerLife("by Anon.")).toEqual({ birth: null, death: null, name: "Anon." });
    expect(PD_DEATH_YEAR_BASELINE).toBe(1929);
    expect(isProvablyPublicDomainComposer("by J. S. Bach (1685–1750)")).toBe(true);
    expect(isProvablyPublicDomainComposer("by F. Tárrega (1852–1909)")).toBe(true);
    expect(isProvablyPublicDomainComposer("by Jeffrey Olson (1947–)")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GUARD 3 — content-type, never status
// ---------------------------------------------------------------------------

describe("GUARD 3 — a notes payload that fails content-type/magic validation cannot be stored", () => {
  test("a real MIDI file with the right content-type validates", () => {
    const v = validateMidiPayload(midiBytes(), NOTES_CONTENT_TYPE);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.tracks).toBe(3);
      expect(v.format).toBe(1);
      expect(v.division).toBe(480);
      expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("an HTML directory listing served as audio/sp-midi is REJECTED (the 200-from-a-directory trap)", () => {
    const v = validateMidiPayload(HTML_BODY, "audio/sp-midi");
    expect(v.ok).toBe(false);
    // Specifically the MAGIC check, not a downstream header-field complaint: an HTML body
    // would also fail the header-length test, and a test that accepted either would keep
    // passing if the magic check were deleted.
    if (!v.ok) expect(v.reason).toContain("does not start with MThd");
  });

  test("a real MIDI file served with the wrong content-type is REJECTED", () => {
    const v = validateMidiPayload(midiBytes(), "text/html; charset=utf-8");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("not a MIDI type");
  });

  test("a response with no content-type is REJECTED", () => {
    const v = validateMidiPayload(midiBytes(), null);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("no content-type");
  });

  test("a truncated body is REJECTED", () => {
    const v = validateMidiPayload(midiBytes().subarray(0, 8), "audio/sp-midi");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("shorter than a MIDI header");
  });

  test("a malformed header (wrong length, zero tracks, zero division) is REJECTED", () => {
    for (const [opts, needle] of [
      [{ headerLen: 8 }, "header length"],
      [{ tracks: 0 }, "zero tracks"],
      [{ division: 0 }, "division is 0"],
      [{ format: 3 }, "format 3"],
    ] as const) {
      const v = validateMidiPayload(midiBytes(opts), "audio/sp-midi");
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toContain(needle);
    }
  });

  test("every accepted content-type is a MIDI audio type", () => {
    for (const ct of MIDI_CONTENT_TYPES) {
      expect(validateMidiPayload(midiBytes(), ct).ok).toBe(true);
    }
    expect(MIDI_CONTENT_TYPES).toContain("audio/sp-midi");
    expect(MIDI_CONTENT_TYPES).not.toContain("text/html");
    expect(MIDI_CONTENT_TYPES).not.toContain("application/pdf");
  });
});

// ---------------------------------------------------------------------------
// GUARD 4 — duplicate identity
// ---------------------------------------------------------------------------

describe("GUARD 4 — the same work cannot be ingested twice", () => {
  // Bach's Menuet in G is published twice on Mutopia (ids 102 and 695) — the real collision.
  const MENUET_102: MutopiaRow = {
    id: 102,
    title: "Menuet in G",
    composer: "by J. S. Bach (1685–1750)",
    opus: "&nbsp;",
    instrument: "for Guitar",
    year: "&nbsp;",
    style: "Baroque",
    lic_key: "publicdomain",
    lic_text: "Public Domain",
    mid: "https://www.mutopiaproject.org/ftp/BachJS/BWV114/menuet1/menuet1.mid",
    ly: "https://www.mutopiaproject.org/ftp/BachJS/BWV114/menuet1/menuet1.ly",
  };
  const MENUET_695: MutopiaRow = { ...MENUET_102, id: 695 };

  test("two ids for one work: the first is kept, the second is rejected and reported", () => {
    const plan = planNotesIngest([MENUET_695, MENUET_102]); // order-independent
    expect(plan.accepted).toHaveLength(1);
    expect(plan.accepted[0].row.id).toBe(102);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].reason).toBe("duplicate-identity");
    expect(plan.rejected[0].collidesWith).toBe(102);
    expect(plan.rejectionCounts["duplicate-identity"]).toBe(1);
    expect(plan.collisions).toEqual([
      { workKey: workKey(MENUET_102), keptId: 102, droppedIds: [695] },
    ]);
  });

  test("the same row twice is a collision (idempotent re-run cannot double-insert)", () => {
    const plan = planNotesIngest([BACH_44, { ...BACH_44 }]);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected[0].reason).toBe("duplicate-identity");
  });

  test("identity keys are stable and differ per source id", () => {
    expect(identityKey(BACH_44)).toBe("mutopia:44:j s bach:prelude to suite in c major");
    expect(identityKey({ ...BACH_44, id: 45 })).not.toBe(identityKey(BACH_44));
    // Diacritics, case, punctuation and "&" fold away — one work, one key.
    expect(foldForIdentity("Pièces & Airs")).toBe("pieces and airs");
    // Mutopia titles really do carry ordinals and trailing periods; both fold out.
    expect(foldForIdentity("Nº. 1. March by Rossini.")).toBe("n 1 march by rossini");
    expect(workKey(MENUET_102)).toBe(workKey(MENUET_695));
  });

  test("a near-collision (same title+composer, different opus) is reported, not dropped", () => {
    const other = { ...BACH_44, id: 9001, opus: "BWV 998" };
    const plan = planNotesIngest([BACH_44, other]);
    expect(plan.accepted).toHaveLength(2);
    expect(plan.nearCollisions).toHaveLength(1);
    expect(plan.nearCollisions[0].ids).toEqual([44, 9001]);
  });

  test("the migration enforces uniqueness in the DATABASE, not only in the planner", () => {
    const ddl = readFileSync(join(import.meta.dir, "..", "..", "scripts", "migrate-piece-notes.ts"), "utf8");
    expect(ddl).toContain("UNIQUE (source_platform, source_id)");
    expect(ddl).toContain("UNIQUE (piece_id)");
    expect(ddl).toContain("CREATE TABLE IF NOT EXISTS piece_notes");
  });
});

// ---------------------------------------------------------------------------
// Scope + plumbing rules the ingest depends on
// ---------------------------------------------------------------------------

describe("scope — single guitar only", () => {
  test("'for Guitar' and 'for Classical Guitar' pass; every other cell does not", () => {
    expect(isSingleGuitar("for Guitar")).toBe(true);
    expect(isSingleGuitar("for Classical Guitar")).toBe(true);
    for (const bad of [
      "for 2 Guitars",
      "for Guitar Duet",
      "for Lute, Guitar",
      "for Flute, and 'Cello or Guitar",
      "for Lute",
      "",
    ]) {
      expect(isSingleGuitar(bad)).toBe(false);
    }
  });

  test("a two-guitar row is refused with its own reason", () => {
    const plan = planNotesIngest([BACH_2206_TWO_GUITARS]);
    expect(plan.accepted).toHaveLength(0);
    expect(plan.rejected[0].reason).toBe("instrument-not-single-guitar");
  });

  test("a row with no .mid is refused rather than stored broken", () => {
    const plan = planNotesIngest([{ ...BACH_44, mid: "" }]);
    expect(plan.rejected[0].reason).toBe("no-midi-source");
  });
});

describe("storage wiring — one builder for where the notes live", () => {
  test("the object key and public URL are derived from the piece id", () => {
    const id = "0e1e4700-dc96-47f5-8ef9-11c7324150ef";
    expect(notesObjectKey(id)).toBe(`notes/${id}.mid`);
    expect(notesUrlForPieceId(id)).toBe(
      `https://site-notesnap.vercel.app/api/notes/${id}.mid`,
    );
    // Same host as the score proxy, so the app has one API base to trust.
    expect(notesUrlForPieceId(id).startsWith("https://")).toBe(true);
    expect(NOTES_CONTENT_TYPE).toBe("audio/sp-midi");
  });
});
