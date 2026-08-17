// Vercel Build Output API function entry.
//
// The Build Output Node launcher invokes the default export as a classic Node
// `(req, res)` handler — NOT a web handler. TanStack Start emits a portable web
// fetch handler (dist/server/server.js), so we adapt: Node IncomingMessage → web
// Request, run the fetch handler, stream the web Response back onto ServerResponse.
// Node 22 has global Request/Response/Headers/ReadableStream.
//
// Bundled (with its deps + the SSR handler's dynamic ./assets chunks) into
// .vercel/output/functions/render.func/index.mjs by build-vercel.sh.
import type { IncomingMessage, ServerResponse } from "node:http";

import handler from "./dist/server/server.js";
import { handleRecognize } from "./src/services/recognize-handler";
import { handleCreateCheckoutSession } from "./src/services/checkout-handler";
import { handleStripeWebhook } from "./src/services/webhook-handler";
import { handleEntitlement } from "./src/services/entitlement";
import { handleSheetServe } from "./src/services/sheet-handler";
import { handleDailyChallenge } from "./src/services/daily-challenge-handler";
import {
  handleCatalogList,
  handleCatalogDetail,
} from "./src/services/catalog-handler";
import { handleSitemap } from "./src/services/sitemap-handler";

// --- Health check handler ---
async function handleHealth(): Promise<Response> {
  let db = false;
  try {
    const { sql } = await import("./src/db");
    const result = await sql()`SELECT 1 AS ok`;
    db = result.length > 0;
  } catch {
    db = false;
  }
  return Response.json(
    { status: "ok", db },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

const fetchHandler = handler as {
  fetch: (request: Request) => Response | Promise<Response>;
};

const toWebRequest = (req: IncomingMessage): Request => {
  const host = req.headers.host ?? "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value != null) headers.set(key, value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    ...(hasBody
      ? { body: req as unknown as ReadableStream, duplex: "half" }
      : {}),
  } as RequestInit);
};

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    // --- API route interception (before SSR) ---
    const url = req.url ?? "/";
    // Simple pathname extraction (no URL object needed for routing)
    const pathname = url.split("?")[0];
    if (pathname === "/api/health" && req.method === "GET") {
      const webRes = await handleHealth();
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }

    if (pathname === "/api/recognize") {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "Method not allowed. Use POST." }));
        return;
      }
      const webReq = toWebRequest(req);
      const webRes = await handleRecognize(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }

    if (pathname === "/api/create-checkout-session") {
      const webReq = toWebRequest(req);
      const webRes = await handleCreateCheckoutSession(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    if (pathname === "/api/stripe-webhook") {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "Method not allowed. Use POST." }));
        return;
      }
      const webReq = toWebRequest(req);
      const webRes = await handleStripeWebhook(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    if (pathname === "/api/entitlement") {
      const webReq = toWebRequest(req);
      const webRes = await handleEntitlement(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    if (pathname.startsWith("/api/sheets/") && req.method === "GET") {
      const webReq = toWebRequest(req);
      const webRes = await handleSheetServe(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    if (pathname === "/api/daily-challenge") {
      const webReq = toWebRequest(req);
      const webRes = await handleDailyChallenge(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    if (pathname === "/api/pieces") {
      const webReq = toWebRequest(req);
      const webRes = await handleCatalogList(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    if (pathname.startsWith("/api/pieces/")) {
      const webReq = toWebRequest(req);
      const webRes = await handleCatalogDetail(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    if (pathname === "/sitemap.xml") {
      const webReq = toWebRequest(req);
      const webRes = await handleSitemap(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }

    const webRes = await fetchHandler.fetch(toWebRequest(req));
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    if (webRes.body) {
      const reader = webRes.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    // Log the detail server-side (captured by the host's function logs); never
    // return a stack trace to the public visitor of the site.
    console.error("[team-site] SSR request failed", error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("Internal Server Error");
  }
}
