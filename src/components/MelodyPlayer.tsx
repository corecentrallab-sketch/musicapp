/**
 * "Play the melody" — the practice-engagement widget on piece pages
 * (SITE WAVE 1b, P2; plan §3/§8, owner direction 09-18 that the site's practice
 * widgets are what create purchase intent).
 *
 * The site holds reference melodies for exactly eight public-domain pieces
 * (public-domain ABC seeds, shared with the hum-to-search recogniser and the
 * app's practice coach). When the piece page matched one, this widget synthesises
 * that melody in the browser with the Web Audio API: no audio files, no CDN, no
 * R2 objects, nothing to download — the ABC arrives embedded in the page, so it
 * also works offline. The schedule itself comes from the pure, tested
 * `services/melody-playback.ts`; this file only wires it to oscillators.
 *
 * Honesty rules (they matter more than polish here):
 *   - No match → NO PLAYER. We show the app's own line, "Reference melody coming
 *     soon", and never a fake or placeholder melody.
 *   - The tempo is stated: the seeds carry no tempo marking, so we say the BPM is
 *     our own practice tempo rather than implying the composer's metronome mark.
 *   - The excerpt is labelled as a short practice phrase, not the full piece.
 *   - No urgency, no scarcity, no autoplay — the visitor starts it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  STOP_TAIL_SEC,
  buildMelodyPlaybackPlan,
  melodyTempoLabel,
} from "~/services/melody-playback";

interface MelodyPlayerProps {
  /** The matched reference melody, or null when this piece has no seed. */
  abc: string | null;
  /** The piece as the catalog titles it, for the accessible label. */
  pieceTitle: string;
  /** The seed's own title, shown so the visitor knows which tune they hear. */
  seedTitle?: string;
}

/** Tone level — deliberately quiet; this is a reference line, not a performance. */
const GAIN = 0.16;
const ATTACK_SEC = 0.012;
const RELEASE_SEC = 0.06;

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export default function MelodyPlayer({ abc, pieceTitle, seedTitle }: MelodyPlayerProps): ReactNode {
  const [playing, setPlaying] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const oscillatorsRef = useRef<OscillatorNode[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The plan is pure and derived from the embedded ABC — computed per render is
  // cheap (8–25 notes), and useMemo would need the ABC in the deps anyway.
  const plan = abc ? buildMelodyPlaybackPlan(abc) : null;
  const playable = !!plan && plan.notes.length > 0;

  const clearScheduled = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    for (const osc of oscillatorsRef.current) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Already stopped — nothing to do.
      }
    }
    oscillatorsRef.current = [];
  }, []);

  const stop = useCallback(() => {
    clearScheduled();
    setPlaying(false);
  }, [clearScheduled]);

  // Never leave a tone running when the visitor navigates away.
  useEffect(() => () => clearScheduled(), [clearScheduled]);

  const play = useCallback(async () => {
    if (!plan || plan.notes.length === 0) return;
    const Ctor = audioContextCtor();
    if (!Ctor) {
      setUnavailable(true);
      return;
    }
    try {
      const ctx = contextRef.current ?? new Ctor();
      contextRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const start = ctx.currentTime + 0.08;
      const started: OscillatorNode[] = [];
      for (const note of plan.notes) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = note.frequencyHz;
        const gain = ctx.createGain();
        const on = start + note.startSec;
        const off = on + note.soundingSec;
        gain.gain.setValueAtTime(0.0001, on);
        gain.gain.linearRampToValueAtTime(GAIN, on + ATTACK_SEC);
        gain.gain.setValueAtTime(GAIN, Math.max(on + ATTACK_SEC, off - RELEASE_SEC));
        gain.gain.linearRampToValueAtTime(0.0001, off);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(on);
        osc.stop(off + 0.02);
        started.push(osc);
      }
      oscillatorsRef.current = started;
      setPlaying(true);
      timerRef.current = setTimeout(
        () => {
          clearScheduled();
          setPlaying(false);
        },
        (plan.totalSec + STOP_TAIL_SEC) * 1000,
      );
    } catch {
      setUnavailable(true);
      setPlaying(false);
    }
  }, [clearScheduled, plan]);

  return (
    <section
      aria-labelledby="play-the-melody-heading"
      className="mt-12 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6"
    >
      <h2
        id="play-the-melody-heading"
        className="text-xl font-bold tracking-tight text-stone-900"
      >
        Play the melody
      </h2>

      {playable && plan ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-stone-700">
            Hear how {seedTitle ? <em>{seedTitle}</em> : "this melody"} goes before
            you play it. NoteSnap synthesises the reference melody in your browser
            — nothing to download.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (playing) stop();
                else void play();
              }}
              aria-pressed={playing}
              aria-label={
                playing
                  ? `Stop the reference melody for ${pieceTitle}`
                  : `Play the reference melody for ${pieceTitle}`
              }
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
            >
              <span aria-hidden="true">{playing ? "■" : "▶"}</span>
              {playing ? "Stop" : "Play the melody"}
            </button>
            <span className="text-xs text-stone-500" aria-live="polite">
              {playing
                ? "Playing…"
                : `${plan.notes.length} notes · ${melodyTempoLabel(plan)}`}
            </span>
          </div>
          <p className="mt-3 text-xs text-stone-500">
            A short practice excerpt ({plan.notes.length} notes), not the whole
            piece.{" "}
            {plan.tempoSource === "abc"
              ? "Tempo is from the reference's own marking."
              : "The reference carries no tempo marking, so the tempo you see is our practice choice."}
          </p>
          {unavailable ? (
            <p className="mt-3 text-xs text-stone-600" role="status">
              This browser couldn&rsquo;t start audio. The melody plays in the
              NoteSnap app.
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-stone-500">
          Reference melody coming soon. Our reference-melody set covers eight
          public-domain pieces today and grows piece by piece.
        </p>
      )}
    </section>
  );
}
