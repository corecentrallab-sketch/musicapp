/**
 * Guards for POST /api/events (v47.2 instrumentation).
 *
 * Two kinds of assertion, both needed:
 *
 * 1. BEHAVIOUR — the accept/reject rules. These call the pure validators and
 *    the reject paths of the handler, so the suite never writes a row to the
 *    production `events` table. (The accept path is proven live with curl, not
 *    by making the gate insert telemetry on every run.)
 *
 * 2. HOSTING AS WELL AS WIRING — the v46 lesson: a module that exists but is
 *    never mounted passes a wiring guard. So these read `vercel-entry.ts` and
 *    `serve.ts` as text and demand (a) the import, (b) a route for exactly
 *    `/api/events`, (c) that the route block really CALLS handleEvents, and
 *    (d) that it sits BEFORE the SSR fallthrough, or a Vercel request would be
 *    swallowed by TanStack Start and the endpoint would 404 in production while
 *    every unit test stayed green.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EVENT_NAMES,
  MAX_BATCH,
  MAX_BODY_BYTES,
  MAX_PROP_KEYS,
  MAX_PROPS_BYTES,
  MAX_STRING_VALUE,
  PII_DENY_TOKENS,
  findPiiKey,
  handleEvents,
  rateLimitAllows,
  resetRateLimit,
  validateEventsPayload,
} from "./events-handler";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const read = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, relativePath), "utf8");

/** A well-formed random install id (32 hex chars — a real uuid with dashes also passes). */
const INSTALL_ID = "9f2c1a77b0e34d8c8b1f5a6d2e7c4301";

const validEvent = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: "app_open",
  install_id: INSTALL_ID,
  props: { source: "launch" },
  app_version: "0.1.40",
  build_number: "47",
  ...overrides,
});

const post = (body: unknown, init: RequestInit = {}): Request =>
  new Request("https://site-notesnap.vercel.app/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });

describe("events: the allowlist is the contract, pinned on both sides", () => {
  test("exactly the nine brief event names, in order", () => {
    expect([...EVENT_NAMES]).toEqual([
      "app_open",
      "recognition_start",
      "recognition_result",
      "result_open",
      "save_piece",
      "wishlist_add",
      "plans_view",
      "upgrade_tap",
      "pro_feature_use",
    ]);
  });

  test("the PII deny list is exactly the brief's words", () => {
    expect([...PII_DENY_TOKENS]).toEqual([
      "email",
      "name",
      "phone",
      "address",
      "token",
      "password",
      "audio",
      "score",
      "lyrics",
    ]);
  });

  test("purchase_complete is NOT accepted from the client (server-side only, deferred)", () => {
    // The brief lists purchase_complete as an event but it must never be
    // client-reported: it needs a Stripe webhook or a server-side Stripe key.
    // A client that sends it gets a 400 rather than a fake purchase row.
    expect(EVENT_NAMES as readonly string[]).not.toContain("purchase_complete");
    const result = validateEventsPayload(validEvent({ name: "purchase_complete" }));
    expect(result.ok).toBe(false);
  });
});

describe("events: accepts what the app will actually send", () => {
  test("one event with every envelope field", () => {
    const result = validateEventsPayload(validEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      install_id: INSTALL_ID,
      name: "app_open",
      props: { source: "launch" },
      app_version: "0.1.40",
      build_number: "47",
    });
  });

  test("props are optional and default to an empty object", () => {
    const result = validateEventsPayload({
      name: "recognition_start",
      install_id: INSTALL_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].props).toEqual({});
    expect(result.events[0].app_version).toBeNull();
    expect(result.events[0].build_number).toBeNull();
  });

  test("a batch of exactly MAX_BATCH (20) events is accepted", () => {
    const batch = Array.from({ length: MAX_BATCH }, () => validEvent());
    const result = validateEventsPayload(batch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(MAX_BATCH);
  });

  test("every KPI event the plan needs, with the props the app will use", () => {
    // These are the real shapes the client delegation will emit. If any of them
    // ever fails here, the app would be sending events the server refuses.
    const shapes: Array<Record<string, unknown>> = [
      { name: "app_open", props: { source: "launch" } },
      { name: "recognition_start", props: { source: "hum" } },
      { name: "recognition_result", props: { source: "audio", success: true, piece_id: INSTALL_ID } },
      { name: "result_open", props: { piece_id: INSTALL_ID, hosted: false } },
      { name: "save_piece", props: { piece_id: INSTALL_ID } },
      { name: "wishlist_add", props: { piece_id: INSTALL_ID } },
      { name: "plans_view", props: { trigger: "limit_reached" } },
      { name: "upgrade_tap", props: { tier: "pro_complete", checkout: "opened" } },
      { name: "pro_feature_use", props: { feature: "transpose", count: 3 } },
    ];
    for (const shape of shapes) {
      const result = validateEventsPayload({ install_id: INSTALL_ID, ...shape });
      expect(`${String(shape.name)}:${result.ok}`).toBe(`${String(shape.name)}:true`);
    }
  });
});

describe("events: rejects what must never reach the table", () => {
  test("an unknown event name is rejected, not stored", () => {
    const result = validateEventsPayload(validEvent({ name: "delete_everything" }));
    expect(result).toEqual({ ok: false, status: 400, error: "unknown event name" });
  });

  test("a batch of 21 events is rejected", () => {
    const batch = Array.from({ length: MAX_BATCH + 1 }, () => validEvent());
    const result = validateEventsPayload(batch);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toBe(`at most ${MAX_BATCH} events per request`);
  });

  test("an empty batch is rejected", () => {
    const result = validateEventsPayload([]);
    expect(result.ok).toBe(false);
  });

  test("install_id must be an opaque id of the right shape", () => {
    for (const bad of [
      "short",
      "",
      "has spaces in it 1234",
      "has/slash/instead/of/urlsafe",
      "x".repeat(65),
      "<script>alert(1)</script>",
      12345,
      null,
    ]) {
      const result = validateEventsPayload(validEvent({ install_id: bad }));
      expect(`${String(bad)}:${result.ok}`).toBe(`${String(bad)}:false`);
    }
  });

  test("every PII-shaped prop key is refused, not silently stripped", () => {
    for (const token of PII_DENY_TOKENS) {
      // exact, camelCase, and snake_case forms all have to be caught
      for (const key of [token, `user${token}`, `user_${token}_value`]) {
        const result = validateEventsPayload(
          validEvent({ props: { [key]: "anything" } }),
        );
        expect(`${key}:${result.ok}`).toBe(`${key}:false`);
      }
    }
  });

  test("a PII-shaped key in the ENVELOPE is refused too", () => {
    const result = validateEventsPayload(validEvent({ email: "someone@example.com" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('event key "email" is not allowed');
  });

  test("an unknown non-PII envelope field is refused (no free-text smuggling)", () => {
    const result = validateEventsPayload(validEvent({ note: "hello there" }));
    expect(result.ok).toBe(false);
  });

  test("props must be flat: nested objects and arrays are refused", () => {
    expect(validateEventsPayload(validEvent({ props: { nested: { a: 1 } } })).ok).toBe(false);
    expect(validateEventsPayload(validEvent({ props: { list: [1, 2, 3] } })).ok).toBe(false);
    expect(validateEventsPayload(validEvent({ props: [] })).ok).toBe(false);
  });

  test("props are size-capped in keys, bytes and string length", () => {
    const tooManyKeys: Record<string, number> = {};
    for (let i = 0; i < MAX_PROP_KEYS + 1; i++) tooManyKeys[`k${i}`] = i;
    expect(validateEventsPayload(validEvent({ props: tooManyKeys })).ok).toBe(false);

    expect(
      validateEventsPayload(validEvent({ props: { blob: "x".repeat(MAX_PROPS_BYTES) } })).ok,
    ).toBe(false);

    expect(
      validateEventsPayload(validEvent({ props: { blob: "x".repeat(MAX_STRING_VALUE + 1) } })).ok,
    ).toBe(false);
  });

  test("app_version / build_number are version-shaped, never free text", () => {
    expect(validateEventsPayload(validEvent({ app_version: "not a version!" })).ok).toBe(false);
    expect(validateEventsPayload(validEvent({ build_number: "47 <b>" })).ok).toBe(false);
  });

  test("findPiiKey normalises case and separators", () => {
    expect(findPiiKey(["E-Mail"])).toBe("E-Mail");
    expect(findPiiKey(["USER_PHONE_NUMBER"])).toBe("USER_PHONE_NUMBER");
    expect(findPiiKey(["piece_id", "hosted", "success"])).toBeNull();
  });
});

describe("events: the handler's HTTP contract", () => {
  test("GET and PUT answer 405", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const res = await handleEvents(
        new Request("https://site-notesnap.vercel.app/api/events", { method }),
      );
      expect(`${method}:${res.status}`).toBe(`${method}:405`);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Method not allowed. Use POST.");
    }
  });

  test("OPTIONS answers 204 and echoes only OUR origins", async () => {
    const ours = await handleEvents(
      new Request("https://site-notesnap.vercel.app/api/events", {
        method: "OPTIONS",
        headers: { origin: "https://site-notesnap.vercel.app" },
      }),
    );
    expect(ours.status).toBe(204);
    expect(ours.headers.get("access-control-allow-origin")).toBe(
      "https://site-notesnap.vercel.app",
    );

    const foreign = await handleEvents(
      new Request("https://site-notesnap.vercel.app/api/events", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(foreign.status).toBe(204);
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("an oversized body answers 413 without touching the database", async () => {
    const res = await handleEvents(post("x".repeat(MAX_BODY_BYTES + 1)));
    expect(res.status).toBe(413);
  });

  test("malformed JSON answers 400", async () => {
    const res = await handleEvents(post("{not json"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("body must be valid JSON");
  });

  test("the three documented rejections answer 400 over HTTP", async () => {
    const unknownName = await handleEvents(post(validEvent({ name: "nope" })));
    expect(unknownName.status).toBe(400);

    const pii = await handleEvents(post(validEvent({ props: { email: "a@b.co" } })));
    expect(pii.status).toBe(400);

    const tooMany = await handleEvents(
      post(Array.from({ length: MAX_BATCH + 1 }, () => validEvent())),
    );
    expect(tooMany.status).toBe(400);
  });

  test("error bodies never carry a stack or a database message", async () => {
    const res = await handleEvents(post(validEvent({ name: "nope" })));
    const text = await res.text();
    expect(text).not.toContain("at ");
    expect(text).not.toContain("Error:");
    expect(text.length).toBeLessThan(200);
  });
});

describe("events: the rate limit is bounded and honest about being best-effort", () => {
  test("a window allows up to the cap, then refuses", () => {
    resetRateLimit();
    const now = 1_700_000_000_000;
    // 120 events per 60s window: six batches of 20 fit, the seventh does not.
    for (let i = 0; i < 6; i++) expect(rateLimitAllows(INSTALL_ID, 20, now)).toBe(true);
    expect(rateLimitAllows(INSTALL_ID, 20, now)).toBe(false);
    // A different install id has its own window.
    expect(rateLimitAllows("other-install-id-0001", 20, now)).toBe(true);
    // After the window resets, the same id is allowed again.
    expect(rateLimitAllows(INSTALL_ID, 20, now + 60_001)).toBe(true);
    resetRateLimit();
  });
});

describe("events: HOSTED, not merely wired (the v46 lesson)", () => {
  const ROUTE = "/api/events";
  const CONDITION = 'pathname === "/api/events"';

  /**
   * Pull out the `if (...) { ... }` block whose condition mentions
   * `pathname === "<routePath>"`, brace-matched to its real end.
   *
   * A plain "does the file contain the string" check is NOT enough — the first
   * version of this guard passed with the route disabled as
   * `if (false && pathname === "/api/events")`, because both the condition text
   * and the handler call were still present. Mutation-probing that exact edit is
   * what turned this into a condition + body check.
   */
  function routeBlock(
    source: string,
    routePath: string,
  ): { condition: string; body: string } | null {
    const lines = source.split("\n");
    const header = `pathname === "${routePath}"`;
    const idx = lines.findIndex(
      (line) => line.includes("if (") && line.includes(header),
    );
    if (idx === -1) return null;
    const headerLine = lines[idx];
    const open = headerLine.indexOf("{", headerLine.indexOf("if ("));
    if (open === -1) return null;
    const condition = headerLine
      .slice(headerLine.indexOf("if (") + 4, open)
      .trim()
      .replace(/\)$/, "")
      .trim();
    let depth = 0;
    let body = "";
    for (let i = idx; i < lines.length; i++) {
      const line = i === idx ? lines[i].slice(open) : lines[i];
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      if (i > idx) body += `${lines[i]}\n`;
      if (depth <= 0) break;
    }
    return { condition, body };
  }

  test("vercel-entry.ts imports the handler", () => {
    expect(read("vercel-entry.ts")).toContain(
      'import { handleEvents } from "./src/services/events-handler"',
    );
  });

  test("vercel-entry.ts routes /api/events, calls the handler, and cannot fall through", () => {
    const block = routeBlock(read("vercel-entry.ts"), ROUTE);
    expect(block).not.toBeNull();
    if (!block) return;
    // The condition must be the path test ALONE — no `false &&`, no `||`, no
    // flag that could switch the endpoint off in production while every unit
    // test stays green.
    expect(block.condition).toBe(CONDITION);
    // It must actually CALL the handler (a route that exists but does nothing
    // is the exact v46 failure mode)…
    expect(block.body).toContain("handleEvents(webReq)");
    // …and it must return, so a request can never reach the SSR handler below.
    expect(block.body).toContain("return;");
  });

  test("the /api/events route sits BEFORE the SSR fallthrough", () => {
    const source = read("vercel-entry.ts");
    expect(source.indexOf(CONDITION)).toBeGreaterThan(-1);
    expect(source.indexOf(CONDITION)).toBeLessThan(source.indexOf("fetchHandler.fetch("));
  });

  test("serve.ts (the Bun dev entry) routes /api/events too, so dev and prod agree", () => {
    const source = read("serve.ts");
    const block = routeBlock(source, ROUTE);
    expect(block).not.toBeNull();
    if (!block) return;
    expect(block.condition).toBe(CONDITION);
    expect(block.body).toContain("handleEvents(req)");
    expect(source.indexOf(CONDITION)).toBeLessThan(source.indexOf("SSR handler"));
  });

  test("the migration script creates the table, both indexes, and no PII columns", () => {
    const migration = read("scripts/migrate-events-table.ts");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS events");
    for (const column of ["install_id", "name", "props", "app_version", "build_number", "created_at"]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain("events_name_created_at_idx");
    expect(migration).toContain("events_install_id_created_at_idx");
    expect(migration).toContain("jsonb");

    // The DDL block may not declare a personal-data column.
    const ddl = migration.slice(
      migration.indexOf("CREATE TABLE IF NOT EXISTS events"),
      migration.indexOf("applying") > 0
        ? migration.indexOf("CREATE TABLE IF NOT EXISTS events") + 800
        : migration.length,
    );
    for (const forbidden of ["email", "phone", "address", "user_agent", "ip_address", "free_text"]) {
      expect(ddl).not.toContain(forbidden);
    }
  });
});
