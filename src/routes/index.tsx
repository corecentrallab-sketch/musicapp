import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { useState, useCallback } from "react";
import RecognitionDemo from "~/components/RecognitionDemo";

const getBusinessName = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const cfg = JSON.parse(await readFile("site.json", "utf8")) as {
      businessName?: string;
    };
    return cfg.businessName?.trim() ?? "";
  } catch {
    return "";
  }
});

export const Route = createFileRoute("/")({
  loader: () => getBusinessName(),
  head: () => ({
    meta: [
      {
        title:
          "NoteSnap — Identify Music & Find Sheet Music Instantly (Shazam for Sheet Music)",
      },
      {
        name: "description",
        content:
          "Identify music by ear with NoteSnap — the Shazam for sheet music. Find sheet music by listening to any song: free classical sheet music, piano sheet music and guitar tabs for public-domain pieces, official scores for modern hits.",
      },
      { property: "og:title", content: "NoteSnap — Identify Music & Find Sheet Music Instantly" },
      {
        property: "og:description",
        content:
          "Hear a song and want to play it? NoteSnap identifies the music and finds the sheet music — free piano scores and guitar tabs for classical pieces, official sheet music for modern songs.",
      },
      { property: "og:url", content: "https://site-notesnap.vercel.app/" },
      {
        "script:ld+json": {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://site-notesnap.vercel.app/#organization",
              name: "NoteSnap",
              url: "https://site-notesnap.vercel.app/",
              logo: "https://site-notesnap.vercel.app/og-image.png",
            },
            {
              "@type": "WebSite",
              "@id": "https://site-notesnap.vercel.app/#website",
              url: "https://site-notesnap.vercel.app/",
              name: "NoteSnap — Sheet Music for Musicians",
              publisher: { "@id": "https://site-notesnap.vercel.app/#organization" },
              potentialAction: {
                "@type": "SearchAction",
                target: {
                  "@type": "EntryPoint",
                  urlTemplate: "https://site-notesnap.vercel.app/library?q={search_term_string}",
                },
                "query-input": "required name=search_term_string",
              },
            },
          ],
        },
      },
    ],
    links: [{ rel: "canonical", href: "https://site-notesnap.vercel.app/" }],
  }),
  component: Home,
});

// Live Stripe Payment Links — no API keys needed
const PAYMENT_LINKS = {
  proMonthly: "https://buy.stripe.com/fZufZg3S1e3m8lo7cyefC00",
  proYearly: "https://buy.stripe.com/5kQ28q9cl7EYeJM1SeefC01",
  family: "https://buy.stripe.com/00wfZgcox8J20SW1SeefC02",
} as const;

function Home() {
  const businessName = Route.useLoaderData();
  const [loadingLink, setLoadingLink] = useState<string | null>(null);

  const handleSubscribe = useCallback((url: string) => {
    setLoadingLink(url);
    window.open(url, "_blank");
    setTimeout(() => setLoadingLink(null), 2000);
  }, []);

  return (
    <div className="min-h-dvh bg-stone-50 text-stone-800 antialiased">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-stone-200 bg-stone-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <span className="text-xl font-bold tracking-tight text-amber-700">
            {businessName || "NoteSnap"}
          </span>
          <div className="flex items-center gap-4 text-sm font-medium text-stone-600 sm:gap-6">
            <a href="#how-it-works" className="hover:text-amber-700 transition-colors">How it works</a>
            <a href="#features" className="hover:text-amber-700 transition-colors">Features</a>
            <a href="#pricing" className="hover:text-amber-700 transition-colors">Pricing</a>
            <a href="#beta" className="hover:text-amber-700 transition-colors">Beta</a>
            <a href="/library" className="hover:text-amber-700 transition-colors">Library</a>
            <a
              href="#pricing"
              className="rounded-full bg-amber-600 px-4 py-1.5 text-white hover:bg-amber-700 transition-colors"
            >
              Try free
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-20 sm:px-6 sm:pt-28 sm:pb-24">
        <div className="max-w-3xl">
          <span className="mb-4 inline-block rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
            {businessName || "NoteSnap"} for musicians
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-stone-900 sm:text-6xl sm:leading-tight">
            Identify any song.
            <br />
            <span className="text-amber-600">Get sheet music instantly.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-stone-600 leading-relaxed">
            Hear a piece and want to play it? NoteSnap identifies music playing around you — classical masterpieces, modern hits, anything. For public-domain works you get free sheet music and tabs. For copyrighted songs, tap to buy the official score from licensed retailers.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#pricing"
              className="rounded-full bg-amber-600 px-6 py-3 text-base font-semibold text-white hover:bg-amber-700 transition-colors shadow-sm"
            >
              Get started free
            </a>
            <a
              href="#how-it-works"
              className="rounded-full border border-stone-300 px-6 py-3 text-base font-semibold text-stone-700 hover:border-amber-400 hover:text-amber-700 transition-colors"
            >
              See how it works
            </a>
          </div>

          {/* Live recognition demo — the hero's "try it now" widget */}
          <RecognitionDemo />
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
            How it works
          </h2>
          <p className="mt-4 text-center text-lg text-stone-500">
            Three steps from hearing to playing
          </p>
          <div className="mt-14 grid gap-10 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Recognize",
                desc: "NoteSnap listens and identifies the piece playing around you — classical, jazz, pop, anything. Like Shazam for sheet music.",
              },
              {
                step: "2",
                title: "Get sheet music",
                desc: "For public-domain works: free piano scores, guitar tabs, and album art. For copyrighted songs: one tap to buy the official sheet music from licensed retailers like Musicnotes and Sheet Music Plus.",
              },
              {
                step: "3",
                title: "Edit, practice & play",
                desc: "Fix errors in the built-in notation editor, loop tricky sections, slow down passages, and export in any format. Then play.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-stone-200 bg-stone-50 p-8 text-center"
              >
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-lg font-bold text-amber-700">
                  {item.step}
                </span>
                <h3 className="mt-5 text-xl font-semibold text-stone-900">
                  {item.title}
                </h3>
                <p className="mt-3 text-stone-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
            Everything a musician needs
          </h2>
          <p className="mt-4 text-center text-lg text-stone-500">
            Built for practice, performance, and discovery
          </p>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: "✏️",
                title: "Notation editor",
                desc: "Correct errors, fix note-splitting, and transpose keys with a powerful built-in editor. Clear disclaimer keeps expectations honest — automated transcription isn't perfect.",
              },
              {
                icon: "⏱️",
                title: "Practice tools",
                desc: "Time-stretch to slow down tricky passages and loop any section until it's perfect. Your practice, your pace.",
              },
              {
                icon: "📤",
                title: "Export anywhere",
                desc: "Export to MIDI, MusicXML, PDF, and GuitarPro. Send scores to any contact or cloud service friction-free.",
              },
              {
                icon: "📡",
                title: "Offline access",
                desc: "Recognition needs a connection, but your saved library, editor, and practice tools work fully offline — no internet required.",
              },
              {
                icon: "🎯",
                title: "Smart personalisation",
                desc: "NoteSnap learns from your plays, skips, pauses, and shares. Recommendations come with plain-language explanations so you know why each suggestion appeared.",
              },
              {
                icon: "🔍",
                title: "Niche discovery",
                desc: "Algorithms refresh regularly and surface lesser-known works alongside the classics — not just the obvious picks.",
              },
              {
                icon: "📥",
                title: "Import & scan",
                desc: "Import PDFs, scan physical scores directly, and sync your library across Dropbox, Google Drive, and other cloud services.",
              },
              {
                icon: "🎨",
                title: "Custom skins",
                desc: "The app adapts to your taste — skins change based on your listening and playing habits, so the app feels uniquely yours.",
              },
              {
                icon: "🚫",
                title: "No interruptions",
                desc: "Never see a pop-up or ad while you're playing or have sheet music open. Both free and Pro tiers get uninterrupted sessions.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-stone-200 bg-white p-6"
              >
                <span className="text-2xl">{f.icon}</span>
                <h3 className="mt-3 text-lg font-semibold text-stone-900">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm text-stone-600 leading-relaxed">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
            Simple, honest pricing
          </h2>
          <p className="mt-4 text-center text-lg text-stone-500">
          Free is genuinely free. Cancel anytime in one tap.
          </p>

          <div className="mt-14 grid gap-8 lg:grid-cols-3">
            {/* Free */}
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-8 flex flex-col">
              <h3 className="text-xl font-bold text-stone-900">Free</h3>
              <p className="mt-1 text-sm text-stone-500">For casual players</p>
              <p className="mt-6">
                <span className="text-4xl font-bold text-stone-900">$0</span>
                <span className="text-stone-500">/month</span>
              </p>
              <ul className="mt-8 flex-1 space-y-3 text-sm text-stone-700">
                {[
                  "5 music recognitions per month",
                  "Full notation editor",
                  "Practice tools (time-stretch, loop)",
                  "Export: MIDI, MusicXML, PDF, GuitarPro",
                  "Basic personalisation",
                  "Offline library access",
                  "No interruptions during play",
                  "Ad-supported (ads only outside play)",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-0.5 text-amber-600">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="/"
                className="mt-8 block rounded-full border border-stone-300 py-3 text-center text-sm font-semibold text-stone-700 hover:border-amber-400 hover:text-amber-700 transition-colors"
              >
                Start free
              </a>
            </div>

            {/* Pro */}
            <div className="rounded-2xl border-2 border-amber-500 bg-amber-50/30 p-8 flex flex-col relative">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-600 px-4 py-0.5 text-xs font-semibold text-white">
                Most popular
              </span>
              <h3 className="text-xl font-bold text-stone-900">Pro</h3>
              <p className="mt-1 text-sm text-stone-500">For serious musicians</p>
              <p className="mt-6">
                <span className="text-4xl font-bold text-stone-900">$4.99</span>
                <span className="text-stone-500">/month</span>
              </p>
              <p className="mt-1 text-sm text-amber-700 font-medium">
                or $39.99/year (save 33%)
              </p>
              <ul className="mt-8 flex-1 space-y-3 text-sm text-stone-700">
                {[
                  "Unlimited music recognitions",
                  "Grade/difficulty level on every piece",
                  "Advanced personalised recommendations",
                  "Transparency labels on all suggestions",
                  "Custom app skins",
                  "Share & send to any contact",
                  "Cloud sync (Dropbox, Google Drive, more)",
                  "PDF import & score scanning",
                  "No ads anywhere",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-0.5 text-amber-600">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-8 space-y-3">
                <button
                  onClick={() => handleSubscribe(PAYMENT_LINKS.proMonthly)}
                  disabled={loadingLink !== null}
                  className="w-full rounded-full bg-amber-600 py-3 text-center text-sm font-semibold text-white hover:bg-amber-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loadingLink === PAYMENT_LINKS.proMonthly
                    ? "Opening checkout…"
                    : "Subscribe — $4.99/mo"}
                </button>
                <button
                  onClick={() => handleSubscribe(PAYMENT_LINKS.proYearly)}
                  disabled={loadingLink !== null}
                  className="w-full rounded-full border border-amber-400 py-3 text-center text-sm font-semibold text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loadingLink === PAYMENT_LINKS.proYearly
                    ? "Opening checkout…"
                    : "Save 33% — $39.99/year"}
                </button>
              </div>
            </div>

            {/* Family */}
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-8 flex flex-col">
              <h3 className="text-xl font-bold text-stone-900">Family</h3>
              <p className="mt-1 text-sm text-stone-500">For households & teachers</p>
              <p className="mt-6">
                <span className="text-4xl font-bold text-stone-900">$9.99</span>
                <span className="text-stone-500">/month</span>
              </p>
              <ul className="mt-8 flex-1 space-y-3 text-sm text-stone-700">
                {[
                  "Up to 5 accounts",
                  "Shared History libraries",
                  "All Pro features included",
                  "Perfect for families & music teachers",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-0.5 text-amber-600">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleSubscribe(PAYMENT_LINKS.family)}
                disabled={loadingLink !== null}
                className="mt-8 w-full rounded-full border border-stone-300 py-3 text-center text-sm font-semibold text-stone-700 hover:border-amber-400 hover:text-amber-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loadingLink === PAYMENT_LINKS.family
                  ? "Opening checkout…"
                  : "Subscribe"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Billing transparency */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
            Billing that respects you
          </h2>
          <p className="mt-4 text-lg text-stone-500">
            No tricks. No dark patterns. Just honest software.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-3 text-left">
            {[
              {
                icon: "🔘",
                title: "One-tap cancel",
                desc: "Cancel any time with a single tap. No hoops, no retention scripts, no guilt. The button is always easy to find.",
              },
              {
                icon: "🆓",
                title: "Free tier, genuinely free",
                desc: "5 recognitions per month with full editor and practice tools. Upgrade when you're ready — nothing is forced.",
              },
              {
                icon: "💡",
                title: "Clear renewal benefits",
                desc: "Before your subscription renews, we remind you what you'd lose by cancelling — informational, never manipulative.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-stone-200 bg-white p-6"
              >
                <span className="text-2xl">{item.icon}</span>
                <h3 className="mt-3 text-lg font-semibold text-stone-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-stone-600 leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Join the beta */}
      <section id="beta" className="bg-amber-50 py-20 sm:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
              Join the NoteSnap beta
            </h2>
            <p className="mt-4 text-lg text-stone-600">
              Be among the first to try NoteSnap on Android — music recognition,
              sheet music, and practice tools, free while we test.
            </p>
            {/* Play closed-testing opt-in link. Standard format from the package name;
                confirm the URL on the NoteSnapBeta track page once the release is live. */}
            <a
              href="https://play.google.com/apps/testing/com.notesnap.sheetmusic"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-block rounded-full bg-amber-600 px-8 py-3 text-base font-semibold text-white hover:bg-amber-700 transition-colors"
            >
              Join the beta on Google Play
            </a>
            <p className="mt-3 text-sm text-stone-500">
              Free closed test · any Google account · leave any time
            </p>
          </div>
          <div className="mt-12 grid gap-6 text-left sm:grid-cols-3">
            {[
              {
                title: "What you get",
                desc: "Early access to the Android app: listen to music and get the sheet music, plus the metronome and practice tools — while they're still being polished.",
              },
              {
                title: "How to join",
                desc: "Tap the button, sign in with any Google account, and accept the invite. Updates arrive through the Play Store like any app.",
              },
              {
                title: "Why join",
                desc: "Your feedback shapes the app. Tell us what works, what doesn't, and what you'd love to see — every report makes NoteSnap better.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-amber-200 bg-white p-6"
              >
                <h3 className="text-lg font-semibold text-stone-900">{item.title}</h3>
                <p className="mt-2 text-sm text-stone-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <span className="text-lg font-bold tracking-tight text-amber-700">
              {businessName || "NoteSnap"}
            </span>
            <div className="flex items-center gap-6 text-sm text-stone-500">
              <a href="#how-it-works" className="hover:text-amber-700 transition-colors">
                How it works
              </a>
              <a href="#features" className="hover:text-amber-700 transition-colors">
                Features
              </a>
              <a href="#pricing" className="hover:text-amber-700 transition-colors">
                Pricing
              </a>
              <a href="/library" className="hover:text-amber-700 transition-colors">
                Library
              </a>
              <a href="/privacy" className="hover:text-amber-700 transition-colors">
                Privacy
              </a>
              <a href="/terms" className="hover:text-amber-700 transition-colors">
                Terms
              </a>
            </div>
            <p className="text-xs text-stone-400">
              &copy; {new Date().getFullYear()} {businessName || "NoteSnap"}. Sheet music for musicians.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
