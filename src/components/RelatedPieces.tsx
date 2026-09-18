/**
 * Related-piece blocks on a piece page (SITE WAVE 1b, P3).
 *
 * Two honest lists, both built server-side from the live public catalog API and
 * filtered by the pure helpers in `services/related-pieces.ts`:
 *   - "More by <composer>" — from `GET /api/pieces?composer=<composer>&limit=`
 *   - "Pieces at the same level" — from the same API's largest catalog sample,
 *     filtered by the piece's own `difficulty_label`
 *
 * No "similar pieces" claim: the API cannot rank similarity (there is no genre or
 * embedding on the public endpoints), so we do not pretend it can. Both blocks
 * render NOTHING when they would be empty — a composer with one piece, or a level
 * with no other piece in the sample, gets silence rather than padding.
 */
import type { ReactNode } from "react";
import type { RelatedPieceLike } from "~/services/related-pieces";

interface RelatedPiecesProps {
  /** The composer the "More by" block belongs to ('' = no such block). */
  composer: string;
  moreByComposer: RelatedPieceLike[];
  difficultyLabel: string | null;
  sameLevel: RelatedPieceLike[];
}

const PIECE_URL = (id: string) => `/library/${encodeURIComponent(id)}`;

function PieceLink({ piece }: { piece: RelatedPieceLike }): ReactNode {
  return (
    <li>
      <a
        href={PIECE_URL(piece.id)}
        className="flex flex-col gap-1 rounded-2xl border border-stone-200 bg-white p-4 transition-colors hover:border-amber-400"
      >
        <span className="font-medium text-stone-900">{piece.title}</span>
        <span className="text-sm text-stone-600">
          {piece.composer}
          {piece.difficulty_label ? ` · ${piece.difficulty_label}` : ""}
        </span>
      </a>
    </li>
  );
}

export default function RelatedPieces({
  composer,
  moreByComposer,
  difficultyLabel,
  sameLevel,
}: RelatedPiecesProps): ReactNode {
  if (moreByComposer.length === 0 && sameLevel.length === 0) return null;

  return (
    <section aria-labelledby="related-pieces-heading" className="mt-12">
      <h2
        id="related-pieces-heading"
        className="text-xl font-bold tracking-tight text-stone-900"
      >
        Keep playing
      </h2>

      {moreByComposer.length > 0 && composer !== "" ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            More by {composer}
          </h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {moreByComposer.map((piece) => (
              <PieceLink key={piece.id} piece={piece} />
            ))}
          </ul>
        </div>
      ) : null}

      {sameLevel.length > 0 && difficultyLabel ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Pieces at the same level · {difficultyLabel}
          </h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {sameLevel.map((piece) => (
              <PieceLink key={piece.id} piece={piece} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
