/**
 * SEO shared constants + helpers.
 *
 * SITE_URL is the canonical production origin (matches CATALOG_API_BASE in
 * src/lib/catalog-client.ts). All absolute URLs in sitemaps, canonicals, OG
 * tags and JSON-LD use it so search engines never see a preview/deployment URL.
 */
export const SITE_URL = "https://site-notesnap.vercel.app";

/** Escape a string for safe inclusion in XML (sitemap). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
