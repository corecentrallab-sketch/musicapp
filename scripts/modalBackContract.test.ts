/**
 * Tests for src/services/modalBackContract.ts — the guard against the
 * owner-reported white screen (v22): a full-screen <Modal> with no
 * `onRequestClose` cannot be closed by the Android BACK button through JS, so the
 * screen that renders only that modal is left blank ("Discover" heading, white
 * body) and the next BACK press exits the app.
 *
 * Two halves:
 *   1. DETECTOR tests — fixtures prove the scan flags a missing prop, tolerates a
 *      `>` inside an expression and inside a string, ignores comments and does
 *      not mistake a URL for a line comment.
 *   2. LIVE SCAN — every .ts/.tsx under src/ plus App.tsx is read off disk and
 *      audited, so a real regression fails this suite. The scan asserts a floor
 *      on files and modal count, so an empty or broken walk can never pass
 *      vacuously.
 *
 * Plain Node, no react-native, no network. Run with: npm run test:tier1
 */
import {
  countModals,
  findModalsMissingBackHandler,
  formatViolations,
  lineAt,
  maskComments,
  modalTags,
  readModalTag,
  type SourceFile,
} from '../src/services/modalBackContract';

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

// ─── Detector ───────────────────────────────────────────────────

function detectorTests(): void {
  console.log('\nmodal tag reader');

  const source = [
    '<Modal',
    '  visible={true}',
    '  onRequestClose={onClose}',
    '>',
    '  <View />',
    '</Modal>',
  ].join('\n');
  const tags = modalTags(source);
  assertEq(tags.length, 1, 'a single <Modal> is found');
  assert(
    tags[0].tag.includes('onRequestClose'),
    'the whole multi-line opening tag is read, including its last prop',
  );
  assertEq(tags[0].tag.endsWith('>'), true, 'the tag ends at its own closing >');

  const expression = '<Modal visible={a > b} onRequestClose={onClose} />';
  const exprTag = readModalTag(expression, 0);
  assert(
    exprTag !== null && exprTag.includes('onRequestClose'),
    'a > inside an expression does not end the tag early',
  );

  const stringy = '<Modal accessibilityLabel={"a > b"} onRequestClose={c} />';
  const stringTag = readModalTag(stringy, 0);
  assert(
    stringTag !== null && stringTag.includes('onRequestClose'),
    'a > inside a string does not end the tag early',
  );

  // A modal that is not self-closing still ends at its own `>`.
  const open = '<Modal visible\n  animationType="slide"\n>';
  const openTag = readModalTag(open, 0);
  assertEq(
    openTag,
    '<Modal visible\n  animationType="slide"\n>',
    'a multi-line opening tag is returned verbatim',
  );

  assertEq(
    readModalTag('<Modal visible={true}', 0),
    null,
    'an unterminated tag reads as null rather than scanning the whole file',
  );

  console.log('\ncomment masking');

  const masked = maskComments('const a = 1; // <Modal no prop here\nconst b = 2;');
  assertEq(
    modalTags(masked).length,
    0,
    'a <Modal> inside a line comment is not scanned',
  );
  assertEq(masked.length, ('const a = 1; // <Modal no prop here\nconst b = 2;').length, 'masking preserves length');
  assertEq(masked.split('\n').length, 2, 'masking preserves newlines (line numbers stay valid)');

  const block = maskComments('/*\n<Modal />\n*/\n<Modal onRequestClose={x} />');
  assertEq(modalTags(block).length, 1, 'a <Modal> inside a block comment is not scanned');

  const url = maskComments("const url = 'https://example.test/a.pdf'; onRequestClose = 1;");
  assert(
    url.includes('onRequestClose'),
    'a // inside a string is not treated as a comment (a URL cannot hide a violation)',
  );

  assertEq(
    lineAt('a\nb\nc', 4),
    3,
    'lineAt reports 1-based lines',
  );

  console.log('\nviolation detection');

  const good: SourceFile = {
    path: 'src/Good.tsx',
    source: '<Modal visible onRequestClose={close} />',
  };
  const bad: SourceFile = {
    path: 'src/Bad.tsx',
    source: 'const x = 1;\n<Modal visible={true} animationType="slide">\n',
  };
  const violations = findModalsMissingBackHandler([good, bad]);
  assertEq(violations.length, 1, 'only the modal without onRequestClose is flagged');
  assertEq(violations[0].path, 'src/Bad.tsx', 'the violation names its file');
  assertEq(violations[0].line, 2, 'the violation names the line of the <Modal tag');
  assert(
    formatViolations(violations)[0].includes('BACK cannot close this modal'),
    'the report says what is wrong in words',
  );
  assertEq(
    findModalsMissingBackHandler([good]).length,
    0,
    'a modal with onRequestClose is not flagged',
  );
  assertEq(countModals([good, bad]), 2, 'countModals counts every modal');
}

// ─── Live scan of the app ───────────────────────────────────────

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
  throw new Error(
    'could not find the repo root from ' +
      process.cwd() +
      ' — run this suite with `npm run test:tier1` from the repo root',
  );
}

/** Every .ts/.tsx under src/ plus App.tsx — the app's own source. */
function appSources(): SourceFile[] {
  const fs = require('fs');
  const path = require('path');
  const root = repoRoot();
  const files: SourceFile[] = [];

  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir) as string[];
    for (const name of entries) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith('.tsx') || name.endsWith('.ts')) {
        files.push({
          path: path.relative(root, full),
          source: fs.readFileSync(full, 'utf8') as string,
        });
      }
    }
  };
  walk(path.join(root, 'src'));
  files.push({
    path: 'App.tsx',
    source: fs.readFileSync(path.join(root, 'App.tsx'), 'utf8') as string,
  });
  return files;
}

function liveScanTests(): void {
  console.log('\nlive scan of the app source');

  const files = appSources();
  // Floors, so a broken walk cannot make this suite pass by finding nothing.
  assert(files.length >= 25, `scanned ${files.length} app source files (≥ 25)`);

  const modals = countModals(files);
  assert(modals >= 10, `found ${modals} <Modal> tags in the app source (≥ 10)`);

  // The two modals whose missing prop caused the white screen must be in the
  // scan and must carry the prop.
  for (const path of ['src/components/ScoreViewer.tsx', 'src/components/ShareCard.tsx']) {
    const file = files.find((f) => f.path === path);
    assert(!!file, `${path} is part of the scan`);
    assert(
      !!file && /<Modal[\s\S]{0,400}?onRequestClose/.test(file.source),
      `${path} sets onRequestClose on its modal`,
    );
  }

  const violations = findModalsMissingBackHandler(files);
  if (violations.length > 0) {
    for (const line of formatViolations(violations)) {
      console.error(`  ✗ FAILED: ${line}`);
    }
  }
  assertEq(
    violations.length,
    0,
    'every <Modal> in the app can be closed by the Android BACK button',
  );
}

// ─── run ────────────────────────────────────────────────────────

function main(): void {
  console.log('\n=== modal back-button contract (no modal may trap BACK) ===');
  detectorTests();
  liveScanTests();
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
