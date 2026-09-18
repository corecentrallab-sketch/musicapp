/**
 * "Piece of the Day" — the daily-practice widget (SITE WAVE 1a, P1).
 *
 * The pick is the same deterministic one the homepage and the app's Daily
 * Challenge already use (`/api/daily-challenge`, djb2(date) over the catalog
 * pool), so every surface agrees on today's piece and no new data source is
 * introduced. Route loaders fetch it server-side and pass it in here.
 *
 * Honesty rules: we never invent a piece, never claim a score we do not have,
 * and never use urgency or scarcity copy. When the pool is empty or the catalog
 * is unreachable the widget says so and points at tomorrow.
 */
import type { ReactNode } from "react";

/** Shape of `/api/daily-challenge` (the fields this widget renders). */
export interface DailyPiece {
  date: string;
  piece_id: string;
  title: string;
  composer: string;
  catalog: string | null;
  difficulty_label: string | null;
  sheet_music_available?: boolean;
}

interface PieceOfTheDayProps {
  daily: DailyPiece | null;
  /**
   * The piece the visitor is already looking at, when the widget is on a piece
   * page — the CTA then says so instead of pretending it is a new discovery.
   */
  currentPieceId?: string;
  /** "card" for the library header, "compact" for a piece-page sidebar. */
  variant?: "card" | "compact";
}

const PIECE_URL = (id: string) => `/library/${encodeURIComponent(id)}`;

export default function PieceOfTheDay({
  daily,
  currentPieceId,
  variant = "card",
}: PieceOfTheDayProps): ReactNode {
  const compact = variant === "compact";
  const isCurrent = !!daily && daily.piece_id === currentPieceId;

  return (
    <section
      aria-labelledby="piece-of-the-day-heading"
      className={
        compact
          ? "rounded-2xl border border-amber-200 bg-amber-50/70 p-5"
          : "rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 sm:p-6"
      }
    >
      <h2
        id="piece-of-the-day-heading"
        className="text-xs font-semibold uppercase tracking-wide text-amber-700"
      >
        Piece of the Day
      </h2>

      {daily ? (
        <>
          <h3
            className={
              compact
                ? "mt-3 text-lg font-semibold text-stone-900"
                : "mt-3 text-xl font-bold tracking-tight text-stone-900 sm:text-2xl"
            }
          >
            <a
              href={PIECE_URL(daily.piece_id)}
              className="transition-colors hover:text-amber-700"
            >
              {daily.title}
            </a>
          </h3>
          {daily.composer ? (
            <p className="mt-1 text-sm text-stone-600">{daily.composer}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {daily.difficulty_label ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-700">
                {daily.difficulty_label}
              </span>
            ) : null}
            {daily.catalog ? (
              <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-medium text-stone-600">
                {daily.catalog}
              </span>
            ) : null}
            <span className="text-stone-500">
              {daily.sheet_music_available
                ? "Free score on NoteSnap"
                : "Score coming soon"}
            </span>
          </div>

          <a
            href={PIECE_URL(daily.piece_id)}
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
          >
            {isCurrent
              ? "You're practising today's piece"
              : "Open today's piece →"}
          </a>

          <p className="mt-3 text-xs text-stone-500">
            A different piece every day — the same pick in the app, so your
            daily practice carries over.
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-stone-600">
          A new piece arrives every day — check back tomorrow.
        </p>
      )}
    </section>
  );
}
