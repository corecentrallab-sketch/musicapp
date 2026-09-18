/**
 * Regression tests for the /library route structure (piece-page routing fix).
 *
 * The bug these guard against: `src/routes/library.tsx` was the PARENT of
 * `/library/$pieceId` in the generated route tree (TanStack Router treats a route
 * file as the layout of anything nested under the same path), but its component
 * rendered the library list and no `<Outlet/>`. So every /library/<uuid> URL —
 * the affiliate CTA, Piece of the Day, melody player, related pieces and app CTA
 * loop with it — silently rendered the library list instead of the piece page,
 * and the site's money pages were unreachable.
 *
 * The check is structural and cheap: walk the route files, work out which paths
 * are parents of other paths (the same nesting the router generator derives), and
 * require every parent route to render an `<Outlet/>`. The list itself now lives
 * in its own index child (`src/routes/library/index.tsx`), so its content — and
 * its SEO head — must still be there.
 *
 * The rendered behaviour is verified end-to-end against a real server build in
 * the site runbook (curl /library/<uuid> for the piece h1 + affiliateId=67650);
 * these tests are the fast layer that catches the structure regressing.
 *
 * Run with: bun test tests/library-routing.test.ts
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROUTES_DIR = join(import.meta.dir, "..", "src", "routes");
const GENERATED_TREE = join(import.meta.dir, "..", "src", "routeTree.gen.ts");

/** Every route file under src/routes (excluding the root layout and any
 * colocated helper, which TanStack Router ignores by the `-` prefix rule). */
function routeFiles(dir: string = ROUTES_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...routeFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (entry.name === "__root.tsx") continue;
    if (entry.name.startsWith("-")) continue;
    out.push(full);
  }
  return out;
}

/** The URL path the router derives from a route file's location: dots are path
 * separators (flat routes), a directory `index` file is that directory's index
 * route, and the root `index` file is `/`. */
function routePath(file: string): string {
  const rel = relative(ROUTES_DIR, file).replace(/\.tsx?$/, "");
  const segments = rel.split("/").map((segment) => segment.split(".").join("/"));
  const path = `/${segments.join("/")}`;
  if (path === "/index") return "/";
  if (path.endsWith("/index")) return `${path.slice(0, -"/index".length)}/`;
  return path;
}

const FILES = routeFiles().map((file) => ({
  file,
  rel: relative(ROUTES_DIR, file),
  path: routePath(file),
  source: readFileSync(file, "utf8"),
}));

/** Routes that have something nested under them — each one renders children. */
const PARENTS = FILES.filter(
  (candidate) =>
    candidate.path !== "/" &&
    FILES.some(
      (other) =>
        other.file !== candidate.file &&
        other.path !== candidate.path &&
        other.path.startsWith(`${candidate.path}/`),
    ),
);

describe("library route structure", () => {
  test("the walk finds the routes this repo actually has", () => {
    const paths = FILES.map((f) => f.path).sort();
    expect(paths).toContain("/library");
    expect(paths).toContain("/library/");
    expect(paths).toContain("/library/$pieceId");
    expect(PARENTS.map((p) => p.path)).toContain("/library");
  });

  test("every parent route renders its children (<Outlet/>)", () => {
    const missing = PARENTS.filter((p) => !p.source.includes("<Outlet")).map(
      (p) => p.rel,
    );
    // A parent without an Outlet mounts itself for the child URL and the child
    // never appears — exactly the piece-page bug.
    expect(missing).toEqual([]);
  });

  test("the /library layout is only an outlet", () => {
    const layout = FILES.find((f) => f.path === "/library");
    expect(layout).toBeDefined();
    if (!layout) return;
    expect(layout.source).toContain('createFileRoute("/library")');
    expect(layout.source).toContain("<Outlet />");
    // Chrome and SEO belong to the pages: the layout must not render a nav,
    // footer or the list itself, or the piece page would be doubled up.
    expect(layout.source).not.toContain("<SiteNav");
    expect(layout.source).not.toContain("<SiteFooter");
    expect(layout.source).not.toContain("Browse the library");
  });

  test("the library list lives in the index child and keeps its content + SEO", () => {
    const index = FILES.find((f) => f.path === "/library/");
    expect(index).toBeDefined();
    if (!index) return;
    expect(index.source).toContain('createFileRoute("/library/")');
    // The route loader (SSR first page) and head (SEO/OG/ canonical) moved with
    // the page, not out of it.
    expect(index.source).toContain("loader: async () =>");
    expect(index.source).toContain("Sheet Music Library");
    expect(index.source).toContain('rel: "canonical"');
    expect(index.source).toContain("/library");
    // The WAVE 1a/1b engagement blocks still sit on /library exactly as before.
    expect(index.source).toContain("Browse the library");
    expect(index.source).toContain("<PieceOfTheDay");
    expect(index.source).toContain("<AppCta");
    expect(index.source).toContain("getDailyPiece");
  });

  test("the piece page is the untouched child of that layout", () => {
    const piece = FILES.find((f) => f.path === "/library/$pieceId");
    expect(piece).toBeDefined();
    if (!piece) return;
    expect(piece.source).toContain('createFileRoute("/library/$pieceId")');
    // Per-piece SEO is built in its own head(), from the loader's data.
    expect(piece.source).toContain("head: ({ loaderData })");
  });

  test("the generated route tree nests the list and the piece page under /library", () => {
    if (!existsSync(GENERATED_TREE)) {
      // Generated on dev/build and gitignored: absent in a fresh checkout.
      console.warn(
        "routeTree.gen.ts not generated yet — skipping the generated-tree check (build the site)",
      );
      return;
    }
    const tree = readFileSync(GENERATED_TREE, "utf8");
    expect(tree).toContain("interface LibraryRouteChildren");
    const block = tree
      .split("const LibraryRouteChildren: LibraryRouteChildren = {")[1]
      ?.split("}")[0];
    expect(block).toBeDefined();
    // Both children of /library — the list and the piece page — are declared,
    // and the parent is a layout route (…WithChildren), not a leaf.
    expect(block).toContain("LibraryIndexRoute");
    expect(block).toContain("LibraryPieceIdRoute");
    expect(tree).toContain("typeof LibraryRouteWithChildren");
    // The piece page's parent must be the library layout, never the root.
    const pieceEntry = tree.split("'/library/$pieceId': {")[1]?.split("}")[0];
    expect(pieceEntry).toBeDefined();
    expect(pieceEntry).toContain("parentRoute: typeof LibraryRoute");
  });
});
