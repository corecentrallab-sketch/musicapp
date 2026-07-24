#!/usr/bin/env bun
/**
 * fetch-cover-art.ts — Query Wikimedia Commons for composer portraits
 * and upload them to R2 for all pieces in the database.
 *
 * Usage: bun run scripts/fetch-cover-art.ts [--limit N] [--verbose]
 */

import { neon } from "@neondatabase/serverless";
import { writeFileSync, mkdirSync } from "node:fs";
import { uploadScore } from "../src/services/storage.ts";

const LIMIT = process.argv.includes("--limit")
  ? parseInt(process.argv[process.argv.indexOf("--limit") + 1], 10)
  : undefined;
const VERBOSE = process.argv.includes("--verbose");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function getComposerPortrait(composer: string): Promise<string | null> {
  try {
    const searchTerm = encodeURIComponent(`${composer} portrait`);
    const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${searchTerm}&format=json&srlimit=3&origin=*`;

    const response = await fetchWithTimeout(apiUrl, {
      headers: { "User-Agent": "NoteSnap/1.0 (curation-pipeline; music-education)" },
    }, 8000);

    if (!response.ok) return null;
    const data = await response.json();
    const searchResults = data?.query?.search || [];

    if (searchResults.length === 0) return null;

    for (const sr of searchResults) {
      const imageInfoUrl = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|size&pageids=${sr.pageid}&format=json&origin=*`;
      const imgResponse = await fetchWithTimeout(imageInfoUrl, {
        headers: { "User-Agent": "NoteSnap/1.0 (curation-pipeline)" },
      }, 8000);

      if (!imgResponse.ok) continue;
      const imgData = await imgResponse.json();
      const pages = imgData?.query?.pages || {};
      for (const pageId of Object.keys(pages)) {
        const imageInfo = pages[pageId]?.imageinfo?.[0];
        if (imageInfo?.url) {
          return imageInfo.url;
        }
      }
    }
  } catch (err) {
    if (VERBOSE) console.log(`  [wikimedia] Error for ${composer}: ${(err as Error).message}`);
  }
  return null;
}

async function downloadAndUpload(url: string, key: string): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(url, {
      headers: { "User-Agent": "NoteSnap/1.0" },
    }, 15000);

    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const result = await uploadScore(key, buffer, "image/jpeg");
    return result.url;
  } catch (err) {
    if (VERBOSE) console.log(`  [upload] Failed: ${(err as Error).message}`);
    return null;
  }
}

async function main() {
  console.log("NoteSnap — Cover Art Fetcher");
  console.log(`Limit: ${LIMIT || "all"}\n`);

  const sql = neon(DB_URL);

  // Get all distinct composers from pieces that don't have cover art
  let query = sql`
    SELECT DISTINCT composer FROM pieces
    WHERE (album_art_url IS NULL OR album_art_url = '')
    ORDER BY composer
  `;

  if (LIMIT) {
    // Simple limit via subquery
    query = sql`
      SELECT DISTINCT composer FROM pieces
      WHERE (album_art_url IS NULL OR album_art_url = '')
      ORDER BY composer
      LIMIT ${LIMIT}
    `;
  }

  const composers = await query;
  console.log(`Found ${composers.length} composers needing cover art`);

  // Cache: one portrait per composer, reuse for all their pieces
  const portraitCache: Record<string, string> = {};
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < composers.length; i++) {
    const composer = composers[i].composer as string;
    console.log(`[${i + 1}/${composers.length}] ${composer}`);

    // Check cache
    if (portraitCache[composer]) {
      console.log(`  → cached: ${portraitCache[composer].substring(0, 60)}...`);
      successCount++;
      continue;
    }

    // Query Wikimedia
    const imageUrl = await getComposerPortrait(composer);

    if (!imageUrl) {
      console.log(`  → no portrait found`);
      failCount++;
      continue;
    }

    if (VERBOSE) console.log(`  → found: ${imageUrl.substring(0, 80)}...`);

    // Upload to R2
    const composerSlug = composer.toLowerCase().replace(/\s+/g, "-");
    const key = `cover-art/${composerSlug}/portrait.jpg`;
    const r2Url = await downloadAndUpload(imageUrl, key);

    if (r2Url) {
      portraitCache[composer] = r2Url;
      console.log(`  → uploaded: ${r2Url.substring(0, 60)}...`);

      // Update all pieces by this composer
      const result = await sql`
        UPDATE pieces SET album_art_url = ${r2Url}
        WHERE composer = ${composer}
        RETURNING id
      `;
      console.log(`  → updated ${result.length} pieces`);

      // Also insert into cover_art table for each piece
      for (const row of result) {
        try {
          await sql`
            INSERT INTO cover_art (piece_id, source_platform, source_url, is_primary, attribution_text)
            VALUES (${row.id as string}, 'wikimedia', ${r2Url}, true, 'Wikimedia Commons')
          `;
        } catch { /* skip duplicates */ }
      }

      successCount++;
    } else {
      console.log(`  → upload failed`);
      failCount++;
    }

    // Brief delay for politeness
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nDone! Success: ${successCount}, Failed: ${failCount}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
