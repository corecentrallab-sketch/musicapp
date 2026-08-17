import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "~/styles/app.css?url";
import { SITE_URL } from "~/services/seo";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Default title/description — every leaf route overrides these with a
      // keyword-rich, page-specific title (deeper matches win in TanStack's
      // head merge, so these act as fallbacks only).
      { title: "NoteSnap — Sheet Music for Musicians" },
      {
        name: "description",
        content:
          "NoteSnap identifies music playing around you and finds the sheet music — free public-domain piano scores and guitar tabs, or official scores for modern songs. Practice tools, notation editing, and export built in.",
      },
      // Open Graph + Twitter defaults (leaf routes may override og:title,
      // og:description, og:url, and og:image per page).
      { property: "og:site_name", content: "NoteSnap" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "NoteSnap — Sheet Music for Musicians" },
      {
        property: "og:description",
        content:
          "Identify any song and get the sheet music instantly. Free public-domain scores, official sheet music for modern hits, practice tools and more.",
      },
      { property: "og:image", content: `${SITE_URL}/og-image.png` },
      { property: "og:url", content: SITE_URL + "/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "NoteSnap — Sheet Music for Musicians" },
      {
        name: "twitter:description",
        content:
          "Identify any song and get the sheet music instantly — free classical scores, official sheet music, practice tools.",
      },
      { name: "twitter:image", content: `${SITE_URL}/og-image.png` },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  notFoundComponent: () => <div>Page not found</div>,
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
