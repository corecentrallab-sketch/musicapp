/**
 * "Hear it? Practise it in NoteSnap" — the app CTA loop (SITE WAVE 1b, P4).
 *
 * Owner direction 09-18: the site's job is to make money, and its practice
 * engagement feeds both the affiliate path and the app. This block is the
 * consistent, site-wide way off the page and into the app — the same component on
 * piece pages ("card") and in the library header ("inline"), so the promise and
 * the link can never drift apart.
 *
 * Honesty: the app is Android-only and pre-launch, so the link is the Google Play
 * closed-test opt-in page and the copy says so. No App Store badge we cannot
 * honour, no "limited spots", no countdown — just what the app adds and where to
 * get it.
 */
import type { ReactNode } from "react";
import { APP_PROMISE_BULLETS, PLAY_TEST_URL } from "~/services/app-links";

interface AppCtaProps {
  /** "card" on piece pages, "inline" for the library header. */
  variant?: "card" | "inline";
}

export default function AppCta({ variant = "card" }: AppCtaProps): ReactNode {
  const inline = variant === "inline";

  return (
    <section
      aria-labelledby="app-cta-heading"
      className={
        inline
          ? "rounded-2xl border border-stone-200 bg-white p-5"
          : "rounded-2xl border border-stone-200 bg-stone-900 p-5 text-stone-100 sm:p-6"
      }
    >
      <h2
        id="app-cta-heading"
        className={
          inline
            ? "text-lg font-semibold text-stone-900"
            : "text-lg font-semibold text-white sm:text-xl"
        }
      >
        Hear it? Practise it in NoteSnap
      </h2>
      <p
        className={
          inline
            ? "mt-2 text-sm leading-relaxed text-stone-700"
            : "mt-2 text-sm leading-relaxed text-stone-300"
        }
      >
        The site gives you the score and the reference melody. The app puts the
        coach next to it, and listens.
      </p>

      <ul className="mt-4 space-y-2">
        {APP_PROMISE_BULLETS.map((line) => (
          <li
            key={line}
            className={
              inline
                ? "flex gap-2 text-sm text-stone-700"
                : "flex gap-2 text-sm text-stone-300"
            }
          >
            <span aria-hidden="true" className="text-amber-500">
              ♪
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <a
        href={PLAY_TEST_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={
          inline
            ? "mt-4 inline-flex min-h-11 items-center rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
            : "mt-5 inline-flex min-h-12 items-center rounded-full bg-amber-500 px-6 py-3 text-sm font-semibold text-stone-900 transition-colors hover:bg-amber-400"
        }
      >
        Join the Android beta →
      </a>

      <p
        className={
          inline
            ? "mt-3 text-xs text-stone-500"
            : "mt-3 text-xs text-stone-400"
        }
      >
        Android closed test — free to join while the app is in beta, and it opens
        in a new tab. An iPhone version isn&rsquo;t available yet.
      </p>
    </section>
  );
}
