/**
 * GET /sitemap.xml — XML sitemap for search engines.
 *
 * Covers the static routes (/, /library, /privacy, /terms, /data-deletion,
 * /subscription/*) plus one URL per public-domain piece in the catalog
 * (/library/:id). The piece list is read live from the DB so new pieces appear
 * without a redeploy. If the DB is unreachable the handler degrades to the
 * static routes only (still a valid sitemap, never a 500 to the crawler).
 *
 * Wired into serve.ts (preview) and vercel-entry.ts (Vercel) BEFORE the SSR
 * fallthrough. robots.txt (static, in public/) points crawlers here.
 */
import { sql } from "~/db";
import { SITE_URL, escapeXml } from "./seo";

const STATIC_PATHS = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/library", priority: "0.9", changefreq: "weekly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
  { path: "/terms", priority: "0.3", changefreq: "yearly" },
  { path: "/data-deletion", priority: "0.3", changefreq: "yearly" },
  { path: "/subscription/cancel", priority: "0.1", changefreq: "yearly" },
  { path: "/subscription/success", priority: "0.1", changefreq: "yearly" },
];

function urlXml(path: string, priority: string, changefreq: string): string {
  return [
    "  <url>",
    `    <loc>${escapeXml(SITE_URL + path)}</loc>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}

export async function handleSitemap(_req: Request): Promise<Response> {
  const staticXml = STATIC_PATHS.map((p) => urlXml(p.path, p.priority, p.changefreq)).join("\n");

  let pieceUrls = "";
  try {
    const rows = (await sql().query(
      `SELECT id FROM pieces WHERE is_public_domain = true ORDER BY title, id`,
    )) as unknown as { id: string }[];
    pieceUrls = rows
      .map((row) => urlXml(`/library/${encodeURIComponent(row.id)}`, "0.6", "monthly"))
      .join("\n");
  } catch (err) {
    // DB unavailable — serve the static-only sitemap so crawling of the key
    // pages still works; the piece list catches up on the next request.
    console.error("[sitemap] piece query failed (serving static-only sitemap):", err);
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    staticXml,
    pieceUrls,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
