#!/usr/bin/env bun
// Quick upload: walk mutopia-data, upload PDFs/MIDIs/LY to R2

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const OUT = "/home/team/shared/mutopia-data";
const contentTypes: Record<string, string> = {
  pdf: "application/pdf", mid: "audio/midi", midi: "audio/midi",
  ly: "text/plain", rdf: "application/rdf+xml",
};

async function main() {
  let uploadScore: any;
  try {
    const mod = await import("../src/services/storage.ts");
    uploadScore = mod.uploadScore;
    console.log("Storage module loaded:", mod.storageInfo());
  } catch (e) {
    console.error("Cannot load storage:", e);
    process.exit(1);
  }

  const toUpload: { path: string; key: string; ct: string }[] = [];
  function walk(d: string) {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = resolve(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const ext = e.name.split(".").pop()?.toLowerCase() || "";
      if (!["pdf", "mid", "midi", "ly", "rdf"].includes(ext)) continue;
      const rel = full.replace(OUT, "").replace(/^\/+/, "");
      toUpload.push({ path: full, key: `scores/${rel}`, ct: contentTypes[ext] || "application/octet-stream" });
    }
  }
  walk(OUT);

  console.log(`Uploading ${toUpload.length} files to R2...`);
  let ok = 0, fail = 0;
  for (let i = 0; i < toUpload.length; i += 6) {
    const batch = toUpload.slice(i, i + 6);
    const results = await Promise.all(batch.map(async (f) => {
      try {
        const buf = readFileSync(f.path);
        await uploadScore(f.key, buf, f.ct);
        return true;
      } catch (e) { return false; }
    }));
    ok += results.filter(Boolean).length;
    fail += results.filter(r => !r).length;
    if (i % 30 === 0 || i + 6 >= toUpload.length)
      console.log(`  ${ok}/${toUpload.length} uploaded, ${fail} failed`);
  }
  console.log(`Done: ${ok} uploaded, ${fail} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
