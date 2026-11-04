/**
 * THE LICENCE + PAYLOAD GATE for public-domain score *notes* (Stage 1 of the guitar plan).
 *
 * Why this module exists. Until this build the catalogue stored no notes at all: `/api/pieces`
 * returned eleven fields, none of them a note, a MIDI or an instrument (see
 * `catalog-handler.ts`). A TAB engine cannot be fed a PDF, so the notes are the prerequisite —
 * and the moment we start storing notes we are storing *copyrightable subject matter*, not
 * merely a link. This module is the one place that decides whether a source row may become
 * stored notes. It is pure: no network, no database, no filesystem. Everything it needs is on
 * the row, so the decision can be unit-tested and mutation-proven (see
 * `pd-notes-gate.test.ts`).
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES (each one is a defect this project has already shipped once)
 * ---------------------------------------------------------------------------
 *
 * 1. LICENCE IS THE ROW'S OWN FIELD, AND ONLY "Public Domain" PASSES.
 *    Mutopia prints a per-piece licence on every search-result row. Exactly one value is
 *    accepted: `Public Domain`. `Creative Commons Attribution` (CC-BY) and
 *    `Creative Commons Attribution-ShareAlike` (CC-BY-SA) are REJECTED, not skipped: the owner
 *    has not approved any CC content for this build, and a CC-BY-SA score's derivative (our
 *    TAB) would carry a ShareAlike obligation that is a counsel question, not an engineering
 *    one. "Anything else" — including an empty licence cell — is rejected too: silence is not
 *    a licence (the classtab.org rule, which is why 0 of its 3,955 files pass).
 *    Every rejection is COUNTED and REPORTED with its reason; a silent skip is the failure mode
 *    this rule exists to prevent.
 *
 * 2. A PD LABEL DOES NOT BEAT AN ALIVE COMPOSER.
 *    Mutopia id 2201 (*Recuerdos de la Luna*, "by Jeffrey Olson (1947–)") is labelled Public
 *    Domain while its composer is alive. The label is the contributor's assertion about their
 *    own typeset; the composer's life dates are a fact about the work. So the general rule is:
 *    a composer with no death year (alive, or unknown) is rejected, and so is a composer who
 *    died after the PD baseline. Id 2201 is ALSO pinned by explicit id in
 *    `ALIVE_COMPOSER_DENYLIST`, because a general rule that only happens to catch the known
 *    trap is one refactor away from not catching it — and because a named exclusion documents
 *    *why* for the next reader. The denylist and the general rule are independent: the tests
 *    prove each one alone rejects 2201.
 *
 * 3. CONTENT-TYPE, NEVER STATUS.
 *    Mutopia's `.mid` paths and its *directories* have the same URL shape, and a directory URL
 *    answers HTTP 200 — that exact defect class (asserting the status instead of the bytes)
 *    already produced a false "all links verified" once in this project. So a notes payload is
 *    accepted only when BOTH hold: the response's Content-Type is a MIDI audio type, AND the
 *    body really is a Standard MIDI File (`MThd` magic, header length 6, at least one track,
 *    a sane division). `validateMidiPayload` is that check; the ingest script fetches with a
 *    ranged GET (not HEAD) so the bytes it validates are the bytes it stores.
 *
 * 4. ONE WORK, ONE ROW.
 *    The catalogue already carries ~31 surplus rows from duplicate title+composer groups; this
 *    build must not add to that. A row's identity is (source platform, source id) — unique per
 *    Mutopia piece — and its *work* identity is composer + title + opus. Two source ids that
 *    resolve to the same work identity are a collision: the first (lowest source id) is kept,
 *    the rest are rejected as `duplicate-identity` and reported with both ids. The database
 *    enforces the same thing (`piece_notes` has UNIQUE(source_platform, source_id) and
 *    UNIQUE(piece_id)), so a bug in the planner cannot double-insert either.
 */
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Row shape (a Mutopia advanced-search result row)
// ---------------------------------------------------------------------------

/**
 * One Mutopia advanced-search result row, as parsed by `scripts/mutopia-guitar-sweep.ts`.
 * The field names mirror the page's own columns; nothing here is inferred.
 */
export interface MutopiaRow {
  /** Mutopia's own piece id (`piece-info.cgi?id=N`). The stable source id. */
  id: number;
  title: string;
  /** The composer cell verbatim, e.g. `by D. Aguado (1784–1849)` or `by Jeffrey Olson (1947–)`. */
  composer: string;
  /** Opus/catalog cell, e.g. `Op. 3 No. 1`. Empty when the row has none. */
  opus: string;
  /** The "for …" cell, e.g. `for Guitar`, `for Classical Guitar`, `for 2 Guitars`. */
  instrument: string;
  year: string;
  style: string;
  /** Mutopia's licence anchor (`legal.html#<key>`), e.g. `pd`, `ccby`, `ccasa`. */
  lic_key: string;
  /** The licence text printed on the row — the field the gate reads. */
  lic_text: string;
  /** Absolute URL of the Standard MIDI File (empty when the row publishes none). */
  mid: string;
  /** Absolute URL of the LilyPond source (empty when the row publishes none). */
  ly: string;
}

// ---------------------------------------------------------------------------
// Rule 1 — licence
// ---------------------------------------------------------------------------

/** The ONLY licence text this build accepts, verbatim from Mutopia's row. */
export const PD_LICENCE_TEXT = "Public Domain";

/**
 * Text that is a Creative Commons grant rather than a PD dedication. Named separately from
 * "anything not PD" so the report can say *which* CC licence was refused — the owner will
 * want that number when CC-BY becomes a decision.
 */
export const CC_LICENCE_PATTERNS: RegExp[] = [
  /creative\s+commons/i,
  /\bCC[ -]?BY\b/i,
  /attribution[- ]?share\s?alike/i,
  /\bBY[- ]?SA\b/i,
];

/** Normalise a licence cell for comparison: collapse whitespace, drop a trailing period. */
export function normalizeLicenceText(text: string): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}

/**
 * True only when the row's own licence field reads exactly `Public Domain`.
 *
 * Deliberately NOT a substring/pattern match: "Public Domain in the US; not for commercial use"
 * contains the phrase and is not a licence we may host under. Exact equality after whitespace
 * normalisation, case-insensitive, is the rule.
 */
export function isPublicDomainLicence(text: string): boolean {
  return normalizeLicenceText(text).toLowerCase() === PD_LICENCE_TEXT.toLowerCase();
}

/** True when the cell carries a Creative Commons grant (used only to label the rejection). */
export function isCreativeCommonsLicence(text: string): boolean {
  const t = String(text ?? "");
  return CC_LICENCE_PATTERNS.some((p) => p.test(t));
}

// ---------------------------------------------------------------------------
// Rule 2 — composer life dates
// ---------------------------------------------------------------------------

/**
 * Death year at or below which a work is treated as public domain. The same baseline the app's
 * `sheetLicenseGate.PD_DEATH_YEAR_BASELINE` uses (US: published before 1930; EU life+70 is
 * stricter but every accepted composer here died before 1910). Kept in sync by a test that
 * reads the app repo's constant when that checkout is present.
 */
export const PD_DEATH_YEAR_BASELINE = 1929;

/**
 * Named exclusions. A row here is refused no matter what its licence cell says.
 *
 * 2201 — *Recuerdos de la Luna*, Jeffrey Olson (b. 1947). Labelled `Public Domain` on Mutopia
 * and the composer is alive. This is the trap the 2026-10-01 audit and the 2026-11-04 scoping
 * sweep both found; it is pinned here by id as well as caught by the general rule below.
 */
export const ALIVE_COMPOSER_DENYLIST: Record<string, string> = {
  "2201":
    "Jeffrey Olson (b. 1947) is alive — a 'Public Domain' label on a living composer's work " +
    "is the contributor's assertion about their typeset, not a grant of the composition",
};

export interface ComposerLife {
  /** Four-digit birth year when the row states one. */
  birth: number | null;
  /** Four-digit death year, or null when the row shows the composer as alive/unknown. */
  death: number | null;
  /** The composer name with the "by " prefix and the life-dates group removed. */
  name: string;
}

/**
 * Parse Mutopia's composer cell. The two live shapes are `by D. Aguado (1784–1849)` and
 * `by Jeffrey Olson (1947–)` — note the en-dash, and note that the *absence* of a death year is
 * how Mutopia prints a living composer. A cell with no parenthesised dates at all yields
 * `{birth: null, death: null}`, which the gate treats as unverifiable and refuses.
 */
export function parseComposerLife(composer: string): ComposerLife {
  const raw = String(composer ?? "").replace(/\s+/g, " ").trim();
  const name = raw.replace(/^by\s+/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  const m = raw.match(/\((\d{3,4})\s*[–—−-]\s*(\d{3,4})?\s*\)/);
  if (!m) return { birth: null, death: null, name };
  const birth = Number(m[1]);
  const death = m[2] ? Number(m[2]) : null;
  return { birth, death, name };
}

/**
 * True only when the composer is provably public domain: a stated death year at or below the
 * baseline. Alive (no death year) and unknown (no dates) both fail — unverifiable is excluded.
 */
export function isProvablyPublicDomainComposer(
  composer: string,
  baseline: number = PD_DEATH_YEAR_BASELINE,
): boolean {
  const { death } = parseComposerLife(composer);
  return death !== null && death <= baseline;
}

// ---------------------------------------------------------------------------
// Instruments — this batch is SINGLE guitar
// ---------------------------------------------------------------------------

/**
 * The row's "for …" cells that mean one solo guitar. `for 2 Guitars`, `for Guitar Duet`,
 * mixed ensembles and lute-only rows are out of scope for this build: the TAB engine renders
 * one fretboard, and a two-guitar typeset would need a second voice model we do not have.
 */
export const SINGLE_GUITAR_INSTRUMENTS: string[] = ["for Guitar", "for Classical Guitar"];

export function isSingleGuitar(instrument: string): boolean {
  return SINGLE_GUITAR_INSTRUMENTS.includes(String(instrument ?? "").trim());
}

// ---------------------------------------------------------------------------
// Rule 3 — the payload
// ---------------------------------------------------------------------------

/** Content types that are a MIDI file. A directory (or an HTML error page) is never one. */
export const MIDI_CONTENT_TYPES: string[] = [
  "audio/sp-midi",
  "audio/midi",
  "audio/x-midi",
  "application/x-midi",
];

/** Smallest possible SMF: 14-byte `MThd` chunk. Anything shorter is not a MIDI file. */
export const MIN_MIDI_BYTES = 14;

export type MidiValidation =
  | { ok: true; bytes: number; sha256: string; tracks: number; format: number; division: number }
  | { ok: false; reason: string };

/**
 * Validate a downloaded notes payload. Status codes are NOT consulted here on purpose — the
 * caller may have got a 200 from a directory URL, and this is the function that decides.
 *
 * Accepts only when the Content-Type is a MIDI audio type AND the bytes are a Standard MIDI
 * File with a well-formed `MThd` chunk. Returns the measured facts (bytes, sha256, track count,
 * format, division) so the ledger records what was actually stored rather than what was hoped.
 */
export function validateMidiPayload(
  bytes: Uint8Array,
  contentType: string | null | undefined,
): MidiValidation {
  const ct = String(contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (ct === "") return { ok: false, reason: "no content-type on the response" };
  if (!MIDI_CONTENT_TYPES.includes(ct)) {
    return { ok: false, reason: `content-type "${ct}" is not a MIDI type` };
  }
  if (!bytes || bytes.byteLength < MIN_MIDI_BYTES) {
    return {
      ok: false,
      reason: `payload is ${bytes ? bytes.byteLength : 0} bytes — shorter than a MIDI header`,
    };
  }
  const magic = Buffer.from(bytes.subarray(0, 4)).toString("latin1");
  if (magic !== "MThd") {
    return { ok: false, reason: `payload does not start with MThd (starts ${JSON.stringify(magic)})` };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(4);
  if (headerLength !== 6) {
    return { ok: false, reason: `MThd header length is ${headerLength}, expected 6` };
  }
  const format = view.getUint16(8);
  const tracks = view.getUint16(10);
  const division = view.getUint16(12);
  if (format > 2) return { ok: false, reason: `SMF format ${format} does not exist` };
  if (tracks < 1) return { ok: false, reason: "SMF declares zero tracks" };
  if (division === 0) return { ok: false, reason: "SMF division is 0 (no timing)" };
  return {
    ok: true,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    tracks,
    format,
    division,
  };
}

// ---------------------------------------------------------------------------
// Rule 4 — identity
// ---------------------------------------------------------------------------

/** Fold a string to a comparison form: diacritics stripped, lowercase, alphanumerics only. */
export function foldForIdentity(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The composer name without "by " or life dates, folded — e.g. `d aguado`. */
export function foldedComposer(composer: string): string {
  return foldForIdentity(parseComposerLife(composer).name);
}

/**
 * The stable per-source identity: platform + source id + composer + title. This is what the
 * database's UNIQUE(source_platform, source_id) mirrors, and what the ledger keys on.
 */
export function identityKey(row: MutopiaRow, platform = "mutopia"): string {
  return `${platform}:${row.id}:${foldedComposer(row.composer)}:${foldForIdentity(row.title)}`;
}

/**
 * The *work* identity — composer + title + opus. Two Mutopia ids that resolve to the same work
 * (Bach's *Menuet in G* is published twice: ids 102 and 695) collide here.
 */
export function workKey(row: MutopiaRow): string {
  return [
    foldedComposer(row.composer),
    foldForIdentity(row.title),
    foldForIdentity(row.opus ?? ""),
  ].join("|");
}

/** Composer + title only — used to REPORT near-collisions (same work, different opus cell). */
export function titleComposerKey(row: MutopiaRow): string {
  return `${foldedComposer(row.composer)}|${foldForIdentity(row.title)}`;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** Every way a row can be refused. Grouped so the report can total by reason. */
export type RejectionReason =
  | "denylisted-alive-composer"
  | "composer-not-provably-pd"
  | "licence-not-public-domain"
  | "licence-missing"
  | "instrument-not-single-guitar"
  | "no-midi-source"
  | "duplicate-identity";

export interface AcceptedRow {
  row: MutopiaRow;
  identityKey: string;
  workKey: string;
  composerName: string;
  composerDeathYear: number;
  licenceEvidence: string[];
}

export interface RejectedRow {
  row: MutopiaRow;
  reason: RejectionReason;
  detail: string;
  /** For `duplicate-identity`: the source id of the row that won. */
  collidesWith?: number;
}

export interface IngestPlan {
  examined: number;
  accepted: AcceptedRow[];
  rejected: RejectedRow[];
  /** Totals by reason, in a stable order, including zero counts for reasons that did not fire. */
  rejectionCounts: Record<RejectionReason, number>;
  /** Same work identity, same opus — the dedupe that ran. */
  collisions: Array<{ workKey: string; keptId: number; droppedIds: number[] }>;
  /** Same composer+title but a DIFFERENT opus cell — reported, not dropped. */
  nearCollisions: Array<{ titleComposerKey: string; ids: number[] }>;
}

const REJECTION_ORDER: RejectionReason[] = [
  "denylisted-alive-composer",
  "composer-not-provably-pd",
  "licence-missing",
  "licence-not-public-domain",
  "instrument-not-single-guitar",
  "no-midi-source",
  "duplicate-identity",
];

/**
 * Decide, for every row, whether its notes may be stored. Pure: same input, same output.
 *
 * Order matters and is deliberate — a row that fails more than one rule is reported under the
 * FIRST rule it fails, so the totals do not double-count:
 *   denylist → composer → licence (missing, then not-PD) → instrument → notes present → dedupe.
 * The denylist runs first because an explicitly named exclusion should read as exactly that in
 * the report, not as a generic composer failure.
 */
export function planNotesIngest(
  rows: MutopiaRow[],
  options: {
    baseline?: number;
    denylist?: Record<string, string>;
  } = {},
): IngestPlan {
  const baseline = options.baseline ?? PD_DEATH_YEAR_BASELINE;
  const denylist = options.denylist ?? ALIVE_COMPOSER_DENYLIST;

  const accepted: AcceptedRow[] = [];
  const rejected: RejectedRow[] = [];
  const seenWork = new Map<string, AcceptedRow>();
  const collisions: Array<{ workKey: string; keptId: number; droppedIds: number[] }> = [];
  const byTitleComposer = new Map<string, number[]>();

  // Deterministic: Mutopia ids ascending, so "the first" is always the lowest id.
  const sorted = [...rows].sort((a, b) => a.id - b.id);

  for (const row of sorted) {
    const tk = titleComposerKey(row);
    const list = byTitleComposer.get(tk);
    if (list) list.push(row.id);
    else byTitleComposer.set(tk, [row.id]);

    const deny = denylist[String(row.id)];
    if (deny) {
      rejected.push({ row, reason: "denylisted-alive-composer", detail: deny });
      continue;
    }

    const life = parseComposerLife(row.composer);
    if (life.death === null) {
      rejected.push({
        row,
        reason: "composer-not-provably-pd",
        detail:
          `composer life dates "${row.composer}" state no death year ` +
          `(alive or unknown) — unverifiable, so excluded`,
      });
      continue;
    }
    if (life.death > baseline) {
      rejected.push({
        row,
        reason: "composer-not-provably-pd",
        detail: `composer died ${life.death}, after the PD baseline ${baseline}`,
      });
      continue;
    }

    const licenceText = normalizeLicenceText(row.lic_text);
    if (licenceText === "") {
      rejected.push({
        row,
        reason: "licence-missing",
        detail: "the row prints no licence — silence is not a licence",
      });
      continue;
    }
    if (!isPublicDomainLicence(row.lic_text)) {
      rejected.push({
        row,
        reason: "licence-not-public-domain",
        detail:
          `row licence is "${licenceText}"` +
          (isCreativeCommonsLicence(row.lic_text) ? " (Creative Commons — not approved for this build)" : ""),
      });
      continue;
    }

    if (!isSingleGuitar(row.instrument)) {
      rejected.push({
        row,
        reason: "instrument-not-single-guitar",
        detail: `instrument cell is "${row.instrument}"`,
      });
      continue;
    }

    if (!row.mid) {
      rejected.push({
        row,
        reason: "no-midi-source",
        detail: "row publishes no .mid (notes unavailable from this source)",
      });
      continue;
    }

    const wk = workKey(row);
    const winner = seenWork.get(wk);
    if (winner) {
      rejected.push({
        row,
        reason: "duplicate-identity",
        detail: `same work identity as Mutopia id ${winner.row.id} (${wk})`,
        collidesWith: winner.row.id,
      });
      const c = collisions.find((x) => x.workKey === wk);
      if (c) c.droppedIds.push(row.id);
      else collisions.push({ workKey: wk, keptId: winner.row.id, droppedIds: [row.id] });
      continue;
    }

    const entry: AcceptedRow = {
      row,
      identityKey: identityKey(row),
      workKey: wk,
      composerName: life.name,
      composerDeathYear: life.death,
      licenceEvidence: [
        `licence cell: "${licenceText}" (Mutopia legal.html#${row.lic_key || "?"})`,
        `composer life dates: "${row.composer}" — died ${life.death} <= ${baseline}`,
        `instrument cell: "${row.instrument}"`,
        `notes source: ${row.mid}`,
        `engraving source: ${row.ly || "(none published)"}`,
      ],
    };
    accepted.push(entry);
    seenWork.set(wk, entry);
  }

  const rejectionCounts = Object.fromEntries(
    REJECTION_ORDER.map((r) => [r, rejected.filter((x) => x.reason === r).length]),
  ) as Record<RejectionReason, number>;

  const nearCollisions = [...byTitleComposer.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ titleComposerKey: key, ids: [...ids].sort((a, b) => a - b) }));

  return {
    examined: rows.length,
    accepted,
    rejected,
    rejectionCounts,
    collisions,
    nearCollisions,
  };
}

/**
 * Build the public URL a stored notes object is served from. ONE builder, so the ingest script,
 * the API and the tests cannot disagree about where the notes live.
 *
 * Mirrors the score convention exactly: the object is private in R2 (`notes/<piece-id>.mid`)
 * and the site proxies it at `/api/notes/<piece-id>.mid` (see `notes-handler.ts`), because R2's
 * S3 endpoint answers 400 to an anonymous GET. The host is the app-facing API host, the same
 * one `sheetUrlForPieceId()` in the app repo uses for `/api/sheets/…`.
 */
export const NOTES_API_BASE = "https://site-notesnap.vercel.app";

/** The R2 object key for a piece's notes. */
export function notesObjectKey(pieceId: string): string {
  return `notes/${pieceId}.mid`;
}

/** The public URL for a piece's notes. */
export function notesUrlForPieceId(pieceId: string): string {
  return `${NOTES_API_BASE}/api/notes/${pieceId}.mid`;
}

/** The content type stored and served for these objects. */
export const NOTES_CONTENT_TYPE = "audio/sp-midi";
