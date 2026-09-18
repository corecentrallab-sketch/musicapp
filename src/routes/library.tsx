/**
 * /library — layout route for the library list and the piece pages.
 *
 * The route tree nests two children under this path: the list at /library
 * (src/routes/library/index.tsx) and the piece page at /library/$pieceId
 * (src/routes/library.$pieceId.tsx). A parent route with children MUST render an
 * <Outlet/>, otherwise TanStack Router mounts this component for the child URL
 * and the child never appears — which is exactly what happened before: every
 * /library/<uuid> piece page (affiliate CTA, Piece of the Day, melody player,
 * related pieces, app CTA) silently rendered the library list instead.
 *
 * The chrome stays with the pages, not here: the list page is a wide column
 * (max-w-4xl) and the piece page a reading column (max-w-3xl), and each renders
 * its own SiteNav / main / SiteFooter. This route is ONLY the outlet.
 */
import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/library")({
  component: LibraryLayout,
});

function LibraryLayout() {
  return <Outlet />;
}
