/**
 * gen-abcjs-asset.js — turn the official abcjs basic bundle into a TS string
 * constant the app can inline into its WebView document.
 *
 * WHY INLINE A STRING, NOT AN ASSET FILE: AbcScoreView builds the viewer's HTML
 * synchronously (generateAbcHtml is pure and unit-tested). Reading
 * assets/abcjs-basic-min.js at runtime is ASYNC (expo-asset + FileSystem), which
 * would mean a first render with no renderer — exactly the blank-staff symptom
 * this change exists to remove. A JSON-escaped string constant keeps the render
 * path synchronous and network-free.
 */
const fs = require('fs');
const crypto = require('crypto');
const SRC = process.argv[2];
const OUT = process.argv[3];
const source = fs.readFileSync(SRC, 'utf8');
if (source.includes('</script')) throw new Error('abcjs bundle contains </script — cannot inline into HTML');
const sha = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
const json = JSON.stringify(source)
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');
const header = `/**
 * abcjsBasic.ts — THE abcjs renderer, BUNDLED INTO THE APP (v43 slice 2, A4).
 *
 * GENERATED FILE — do not edit by hand. Regenerate with
 * \`node scripts/gen-abcjs-asset.js <abcjs-basic-min.js> src/assets/abcjsBasic.ts\`
 * from the official dist file of the pinned version below.
 *
 * WHY IT EXISTS. AbcScoreView's WebView loaded abcjs from cdn.jsdelivr.net
 * (\`<script src="https://cdn.jsdelivr.net/npm/abcjs@6.2.3/dist/abcjs-basic-min.js">\`).
 * With no network — or a blocked CDN — the document had no renderer at all, so
 * the score drew NOTHING and the app looked broken ("offline renders an empty
 * staff"). The app promises offline, so the renderer now ships inside the app
 * and the HTML carries no remote URL of any kind.
 *
 * PROVENANCE (checked into this header, not into a comment elsewhere):
 *   package   abcjs (basic build)   version 6.2.3
 *   source    https://cdn.jsdelivr.net/npm/abcjs@6.2.3/dist/abcjs-basic-min.js
 *   sha256    ${sha}
 *   licence   MIT — Copyright © 2009-2023 Paul Rosen and Gregory Dyke
 *             (https://abcjs.net). The MIT licence permits redistribution in
 *             source or binary form; the copyright notice below is kept intact
 *             as the bundle's own leading comment.
 *
 * The bundle is a UMD file that assigns \`window.ABCJS\`; it is evaluated inside
 * the WebView document, never in React Native.
 */
export const ABCJS_VERSION = '6.2.3';
export const ABCJS_SHA256 = '${sha}';
export const ABCJS_BASIC_MIN_JS = ${json};
`;
fs.mkdirSync(require('path').dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header);
console.log('wrote ' + OUT + ' bytes=' + header.length + ' sha256=' + sha);
