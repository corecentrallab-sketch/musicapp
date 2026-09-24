/**
 * notationEditorContract.test.ts — the notation editor (transpose v1) must be
 * REACHABLE, COMPILABLE and PUBLIC-DOMAIN-ONLY.
 *
 * Why this exists (2026-09-24, PR #124): `src/screens/NotationEditorScreen.tsx`
 * shipped as dead, uncompilable code — it imported `addAbcToLibrary` from
 * `src/services/libraryStore.ts`, which did not export it, and nothing in the app
 * ever navigated to it. No gate caught it: test:tier1 compiles only the pure
 * modules in tsconfig.tier1.json (never screens), and no scanner looked at
 * whether a feature is wired to a user. The result was a screen that would crash
 * at import if it were ever reached, and a save button that could not save.
 *
 * Three families of assertion, all source-text scans (no react-native, no
 * network), so they run in the tier1 gate:
 *   1. DANGLING IMPORTS — every named import in the editor's file set resolves to
 *      a real export of the local module it names. This is the exact bug above:
 *      the import list and the export list were never compared by anything.
 *   2. REACHABILITY — the screen is registered as a route, the Editor tab card
 *      navigates to it, and an `abc` library row opens it. A feature no tap can
 *      reach is not shipped, and this suite says so.
 *   3. COPYRIGHT POSTURE — transpose/save is offered only for public-domain
 *      pieces: every bundled score is PD and the save path is gated on it. This
 *      editor must never produce a transposed copy of a copyrighted work.
 *
 * Plain Node. Run with: npm run test:tier1
 */
import { INLINE_APP_RENDERED_WEBVIEWS } from '../src/services/inAppBrowserContract';
declare const require: (id: string) => any;
declare const process: { cwd(): string; exit(code: number): never };
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

let failures = 0;
let passes = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✗ FAILED: ${msg}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passes++;
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(
      `  ✗ FAILED: ${msg} (got ${String(actual)}, want ${String(expected)})`,
    );
  }
}

// ─── File access ────────────────────────────────────────────────
function repoRoot(): string {
  const fs = require('fs');
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (
      fs.existsSync(path.join(dir, 'app.json')) &&
      fs.existsSync(path.join(dir, 'src'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function readSource(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  const full = path.join(repoRoot(), rel);
  return fs.existsSync(full) ? (fs.readFileSync(full, 'utf8') as string) : '';
}

/**
 * The files the editor is made of, plus every file that has to change for a user
 * to reach it. An import in one of these that another of these does not export is
 * the defect this suite exists for.
 */
const EDITOR_FILES: string[] = [
  'App.tsx',
  'src/screens/NotationEditorScreen.tsx',
  'src/screens/EditorScreen.tsx',
  'src/screens/LibraryScreen.tsx',
  'src/components/AbcScoreView.tsx',
  'src/services/libraryStore.ts',
  'src/services/abcTranspose.ts',
  'src/data/abcScores.ts',
  'src/types/index.ts',
];

/**
 * Blank out comments so a scan reads code, not prose. Strings are deliberately
 * LEFT ALONE: an import specifier (`from '../services/libraryStore'`) is a string
 * literal, and masking strings would hide exactly what this suite compares.
 */
function maskComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Every named import of a RELATIVE module in one file: `[{ from, names }]`. */
export function relativeImports(
  source: string,
): { from: string; names: string[] }[] {
  const masked = maskComments(source);
  const found: { from: string; names: string[] }[] = [];
  const pattern =
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(\.[^']*)'/g;
  let match = pattern.exec(masked);
  while (match) {
    const names = match[1]
      .split(',')
      .map((raw) => raw.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim())
      .filter((name) => name.length > 0);
    found.push({ from: match[2], names });
    match = pattern.exec(masked);
  }
  return found;
}

/** Every name a module exports (declarations and `export { … }` lists). */
export function exportedNames(source: string): string[] {
  const masked = maskComments(source);
  const names: string[] = [];
  const declaration =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
  let match = declaration.exec(masked);
  while (match) {
    names.push(match[1]);
    match = declaration.exec(masked);
  }
  const list = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  match = list.exec(masked);
  while (match) {
    for (const raw of match[1].split(',')) {
      const name = raw.split(/\s+as\s+/)[0].trim();
      if (name.length > 0) names.push(name);
    }
    match = list.exec(masked);
  }
  return names;
}

/** Resolve a relative import specifier from a file to a repo-relative path. */
function resolveModule(fromFile: string, specifier: string): string | null {
  const fs = require('fs');
  const path = require('path');
  const base = path.resolve(repoRoot(), path.dirname(fromFile), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (fs.existsSync(candidate)) {
      return path.relative(repoRoot(), candidate);
    }
  }
  return null;
}

/** The `KIND_ICONS` map keys in LibraryScreen (kind -> icon). */
function iconMapKeys(source: string): string[] {
  const block = /KIND_ICONS[^=]*=\s*\{([\s\S]*?)\}/.exec(source);
  if (!block) return [];
  const keys: string[] = [];
  const pattern = /^\s*([A-Za-z][A-Za-z0-9]*)\s*:/gm;
  let match = pattern.exec(block[1]);
  while (match) {
    keys.push(match[1]);
    match = pattern.exec(block[1]);
  }
  return keys;
}

/** The union members of `export type LibraryKind = 'a' | 'b';`. */
function libraryKindMembers(typesSource: string): string[] {
  const block = /export\s+type\s+LibraryKind\s*=([\s\S]*?);/.exec(typesSource);
  if (!block) return [];
  const members: string[] = [];
  const pattern = /'([a-z]+)'/g;
  let match = pattern.exec(block[1]);
  while (match) {
    members.push(match[1]);
    match = pattern.exec(block[1]);
  }
  return members;
}

// ─── 1. Dangling imports ────────────────────────────────────────
function danglingImportTests(): void {
  console.log('\nthe editor files exist and their imports resolve');
  for (const file of EDITOR_FILES) {
    assert(readSource(file).length > 0, `${file} is a live file`);
  }

  let checked = 0;
  for (const file of EDITOR_FILES) {
    for (const imp of relativeImports(readSource(file))) {
      const module = resolveModule(file, imp.from);
      assert(
        module !== null,
        `${file} imports from '${imp.from}', which resolves to a module`,
      );
      if (module === null) continue;
      const exported = exportedNames(readSource(module));
      for (const name of imp.names) {
        checked++;
        assert(
          exported.includes(name),
          `${file} imports { ${name} } and ${module} exports it`,
        );
      }
    }
  }
  assert(
    checked >= 15,
    `compared ${checked} named imports against their modules' exports (≥ 15)`,
  );

  // The detector itself, on the exact PR #124 defect, so a future edit to this
  // scanner cannot quietly stop detecting it.
  const broken = "import { addAbcToLibrary } from '../services/libraryStore';";
  const lib = readSource('src/services/libraryStore.ts');
  assert(
    relativeImports(broken).length === 1 &&
      relativeImports(broken)[0].names[0] === 'addAbcToLibrary',
    'the scanner reads a named import out of a source line',
  );
  assert(
    exportedNames('export async function other(): Promise<void> {}').includes(
      'addAbcToLibrary',
    ) === false,
    'a module that does not export a name is reported as not exporting it',
  );
  assert(
    exportedNames(lib).includes('addAbcToLibrary') &&
      exportedNames(lib).includes('readAbcText'),
    'libraryStore exports addAbcToLibrary and readAbcText',
  );
}

// ─── 2. Reachability ────────────────────────────────────────────
function reachabilityTests(): void {
  console.log('\nthe editor is reachable from a real tap');
  const app = readSource('App.tsx');
  const editor = readSource('src/screens/NotationEditorScreen.tsx');
  const hub = readSource('src/screens/EditorScreen.tsx');
  const library = readSource('src/screens/LibraryScreen.tsx');
  const types = readSource('src/types/index.ts');

  assert(
    /import\s*\{[^}]*NotationEditorScreen[^}]*\}\s*from\s*'\.\/src\/screens\/NotationEditorScreen'/.test(
      maskComments(app),
    ),
    'App.tsx imports NotationEditorScreen',
  );
  assert(
    /<Stack\.Screen[\s\S]{0,200}?name="NotationEditor"[\s\S]{0,200}?component=\{NotationEditorScreen\}/.test(
      app,
    ),
    'App.tsx registers the NotationEditor route',
  );
  assert(
    /NotationEditor:\s*\{[^}]*sourcePieceId\?[^}]*itemId\?[^}]*\}\s*\|\s*undefined/.test(
      types,
    ),
    'RootStackParamList types NotationEditor with optional sourcePieceId/itemId',
  );

  assert(
    /navigation\.navigate\('NotationEditor'\)/.test(hub),
    "the Editor tab card navigates to 'NotationEditor'",
  );
  assert(
    /<Pressable[\s\S]{0,400}?navigate\('NotationEditor'\)/.test(hub),
    'the Notation editor card is a Pressable (a control, not an inert view)',
  );
  assert(
    !/styles\.comingSoon|>\s*SOON\s*</.test(hub),
    'the inert "SOON" notation-editor card is gone',
  );

  assert(
    /navigate\('NotationEditor',\s*\{\s*itemId:\s*item\.id\s*\}\)/.test(library),
    'an abc library row opens the editor with its itemId',
  );
  assert(
    /isOpenableKind[\s\S]{0,200}?kind === 'abc'/.test(library),
    "the library treats 'abc' as an openable kind (chevron, not a Soon badge)",
  );

  const kinds = libraryKindMembers(types);
  assert(
    kinds.includes('abc'),
    "LibraryKind includes 'abc'",
  );
  const icons = iconMapKeys(library);
  assert(
    icons.length >= kinds.length,
    `LibraryScreen's KIND_ICONS maps ${icons.length} kinds (≥ ${kinds.length} in LibraryKind)`,
  );
  for (const kind of kinds) {
    assert(
      icons.includes(kind),
      `KIND_ICONS has an icon for every LibraryKind ('${kind}')`,
    );
  }

  assert(
    /export async function addAbcToLibrary\(/.test(readSource('src/services/libraryStore.ts')),
    'libraryStore.addAbcToLibrary is implemented (not just imported)',
  );
  assert(
    /await addAbcToLibrary\(\{/.test(editor),
    'the editor actually saves through addAbcToLibrary',
  );
  assert(
    /abc:\s*'abc'/.test(readSource('src/services/libraryStore.ts')),
    "the .abc extension maps to the 'abc' library kind",
  );
  assert(
    /case 'abc':/.test(readSource('src/services/libraryStore.ts')),
    "kindLabel names the 'abc' kind for the UI",
  );
}

// ─── 3. The inline abcjs preview exemption ──────────────────────
function exemptionTests(): void {
  console.log('\nthe inline abcjs preview exemption matches reality');
  const preview = readSource('src/components/AbcScoreView.tsx');
  assert(
    INLINE_APP_RENDERED_WEBVIEWS.includes('src/components/AbcScoreView.tsx'),
    'AbcScoreView is the declared inline app-rendered WebView',
  );
  assert(
    /<WebView[\s\S]*?source=\{\{\s*html\s*\}\}/.test(preview),
    'AbcScoreView renders app-generated markup (source={{ html }}), not a page the user navigates to',
  );
  assert(
    !/source=\{\{\s*uri/.test(preview),
    'AbcScoreView never loads a remote URL, which is what makes the exemption valid',
  );
  assert(
    /INLINE_APP_RENDERED_WEBVIEWS/.test(
      readSource('src/services/inAppBrowserContract.ts'),
    ),
    'the exemption list lives in inAppBrowserContract (one source of truth)',
  );
}

// ─── 4. Copyright posture ───────────────────────────────────────
function copyrightTests(): void {
  console.log('\ntranspose is public-domain only');
  const scores = readSource('src/data/abcScores.ts');
  const editor = readSource('src/screens/NotationEditorScreen.tsx');
  const entries = scores.match(/isPublicDomain:\s*(true|false)/g) ?? [];
  assert(entries.length >= 5, `${entries.length} bundled ABC scores (≥ 5)`);
  assert(
    entries.every((entry) => entry.includes('true')),
    'every bundled score is public domain',
  );
  assert(
    /isPublicDomain:\s*boolean/.test(scores),
    'the AbcScore type carries isPublicDomain (gating is typed, not assumed)',
  );
  assert(
    /canSave[\s\S]{0,120}?isPublicDomain === true/.test(editor),
    'the save button is gated on isPublicDomain === true',
  );
  assert(
    /if \(offsetZero \|\| selected\.isPublicDomain !== true\) return;/.test(editor),
    'handleSave refuses to save a non-public-domain score even if called directly',
  );
}

// ─── run ────────────────────────────────────────────────────────
function main(): void {
  console.log('\n=== notation editor: reachable, compiling, PD-only ===');
  danglingImportTests();
  reachabilityTests();
  exemptionTests();
  copyrightTests();
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}
try {
  main();
} catch (err) {
  failures++;
  console.error('  ✗ FAILED: suite threw', err);
  console.log(`\n${passes} passed, ${failures} failed\n`);
  process.exit(1);
}
