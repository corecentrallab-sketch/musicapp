/**
 * audioSession.ts — THE AUDIO SESSION AND THE TONE LOADER (v34).
 *
 * Built for the owner's v33 device pass (10-06): "no audio of the take… Unable to
 * hear any audio… device on max volume… the Piano, Strings, Guitar buttons do not
 * produce any audio". Two independent causes were found in the code, and this
 * file is where both are fixed.
 *
 * ── 1. THE PLAYBACK SURFACES NEVER ESTABLISHED A SESSION ────────────────────
 * Only three places in v33 touched the session at all — the recorder (start and
 * stop), the metronome and the score player — and each set a PARTIAL mode
 * (`{ allowsRecordingIOS, playsInSilentModeIOS }`), whose omitted keys expo-av
 * fills in from the mode that was already current. The two surfaces the owner
 * reported as silent, the History take player and the Hum-Along preview /
 * instrument chips, called `Audio.setAudioModeAsync` NOWHERE: they assumed a
 * session nothing guaranteed, and on Android the player's own volume is gated on
 * holding audio focus — expo-av's AVManager computes `getVolumeForDuckAndFocus()`
 * as **0** whenever focus is not held, so a play can succeed and be inaudible
 * with no error at all.
 *
 * So: ONE definition of the playback session (`playsInSilentModeIOS` — the
 * owner's "device on max volume" case with the ringer off — plus ducking, no
 * earpiece routing, not staying active in the background), applied before EVERY
 * play, re-applied after every recording, and every failure reported to the
 * diagnostics store so the user sees "Audio unavailable: …" instead of a silent
 * button.
 *
 * ── 2. THE TONES COULD NOT BE LOADED AT ALL ON ANDROID RELEASE ──────────────
 * See src/services/toneSourceLadder.ts: the packaged resource name and the
 * identifier the app computes for it disagree (`assets_tones_…` vs `tones_…`), and
 * expo-av's default `downloadFirst` awaits expo-asset's copy, which throws on
 * that miss. This file walks the rung ladder instead, remembers the rung that
 * worked, and reports the honest reason when none of them do.
 *
 * NOT tier1-compiled (it imports expo-av / expo-constants) — the testable halves
 * are toneSourceLadder.ts and audioDiagnostics.ts, both pure and both asserted by
 * the gate.
 */
import { Audio } from 'expo-av';
import Constants from 'expo-constants';
import { reportAudioFailure, usableDetail } from './audioDiagnostics';
import { toneSourceFor } from './toneBank';
import {
  describeToneSourceRung,
  orderToneSourceLadder,
  toneSourceLadder,
  type ToneSourceKind,
} from './toneSourceLadder';
import type { PreviewInstrumentId } from './takePreview';

/**
 * The package name the Android resource rungs need. Read from the app's own
 * config, with the shipped package as a hard fallback so a build whose config
 * cannot be read still gets a usable rung (it is the package in app.json and on
 * Play).
 */
export const ANDROID_PACKAGE_FALLBACK = 'com.notesnap.sheetmusic';

/** How long a mode change may take before we call it failed (2000 ms). */
export const AUDIO_MODE_TIMEOUT_MS = 2000;

/**
 * THE PLAYBACK SESSION. `playsInSilentModeIOS` is what makes the app audible with
 * the ringer off; `allowsRecordingIOS: false` releases the record session the
 * capture flow opens; `playThroughEarpieceAndroid: false` keeps output on the
 * speaker; `staysActiveInBackground: false` hands focus back when the app pauses.
 * The interruption modes are deliberately left at expo-av's own defaults (expo-av
 * validates whatever we pass and keeps the current values for omitted keys).
 */
export const PLAYBACK_AUDIO_MODE: Partial<Audio.AudioMode> = {
  playsInSilentModeIOS: true,
  allowsRecordingIOS: false,
  playThroughEarpieceAndroid: false,
  shouldDuckAndroid: true,
  staysActiveInBackground: false,
};

/** THE RECORDING SESSION: the playback session plus the mic. */
export const RECORDING_AUDIO_MODE: Partial<Audio.AudioMode> = {
  ...PLAYBACK_AUDIO_MODE,
  allowsRecordingIOS: true,
};

/** Which session the app believes it is in. */
export type AudioModeName = 'playback' | 'recording' | 'unknown';

let appliedMode: AudioModeName = 'unknown';
let inFlight: Promise<boolean> | null = null;

function androidPackageName(): string {
  const fromConfig = Constants.expoConfig?.android?.package;
  return typeof fromConfig === 'string' && fromConfig.length > 0
    ? fromConfig
    : ANDROID_PACKAGE_FALLBACK;
}

/** Await `p` for at most `ms`; a hung native call must never hang a button. */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Apply one mode, reporting the failure honestly. `force` re-applies a mode the
 * app already believes it is in — which is exactly what the recording → playback
 * transition needs, because the recorder changes the session underneath us.
 */
async function applyAudioMode(
  mode: Partial<Audio.AudioMode>,
  name: AudioModeName,
  force: boolean,
): Promise<boolean> {
  if (!force && appliedMode === name) return true;
  if (inFlight) await inFlight;
  let ok = false;
  inFlight = (async () => {
    const result = await withTimeout(
      Audio.setAudioModeAsync(mode).then(() => true).catch(() => false),
      AUDIO_MODE_TIMEOUT_MS,
      false,
    );
    ok = result;
    return result;
  })();
  await inFlight;
  inFlight = null;
  appliedMode = ok ? name : 'unknown';
  if (!ok) {
    reportAudioFailure({
      source: 'audio-session',
      reason: 'session-setup',
      detail: 'Audio.setAudioModeAsync did not complete',
    });
  }
  return ok;
}

/** Put the app in its PLAYBACK session (idempotent; safe to call on every play). */
export function ensurePlaybackAudioMode(): Promise<boolean> {
  return applyAudioMode(PLAYBACK_AUDIO_MODE, 'playback', false);
}

/**
 * Put the app in its RECORDING session before a capture. Called by the recorder so
 * the recording starts on a session that actually allows the mic.
 */
export function enterRecordingAudioMode(): Promise<boolean> {
  return applyAudioMode(RECORDING_AUDIO_MODE, 'recording', true);
}

/**
 * Put the app BACK into its playback session. Called after every recording stops:
 * leaving a recording session in place is what makes everything the user presses
 * afterwards silent.
 */
export function restorePlaybackAudioMode(): Promise<boolean> {
  return applyAudioMode(PLAYBACK_AUDIO_MODE, 'playback', true);
}

/** The session the app last applied (diagnostics only). */
export function currentAudioModeName(): AudioModeName {
  return appliedMode;
}

/** The rung that already worked for a pitch — so the ladder is paid once. */
const workingRung = new Map<string, ToneSourceKind>();

/** Forget the cached rungs (used when a tone that used to work starts failing). */
export function resetToneSourceCache(): void {
  workingRung.clear();
}

/** A tone that loaded, plus the rung it came from. */
export interface LoadedTone {
  sound: Audio.Sound;
  kind: ToneSourceKind;
}

/**
 * Load one one-shot tone from the tone bank, walking the rung ladder. Resolves to
 * null when NO rung could load it — and in that case the reason is reported, so
 * the surface can say "Audio unavailable: the preview tones could not be loaded
 * from this build" instead of doing nothing.
 *
 * `replay` is deliberately NOT done here: the caller decides when a sound is heard.
 */
export async function loadToneSound(
  instrument: PreviewInstrumentId | string,
  midi: number,
): Promise<LoadedTone | null> {
  const moduleId = toneSourceFor(instrument, midi);
  const key = `${String(instrument)}:${Math.round(Number(midi) || 0)}`;
  const preferred = workingRung.get(key) ?? null;
  const rungs = orderToneSourceLadder(
    toneSourceLadder({
      instrument: String(instrument),
      midi,
      moduleId,
      packageName: androidPackageName(),
    }),
    preferred,
  );

  // The session first: a play on a session that was never set up is the silent
  // path this whole file exists to close.
  await ensurePlaybackAudioMode();

  let lastDetail = '';
  for (const rung of rungs) {
    try {
      const created = await Audio.Sound.createAsync(
        rung.source,
        { shouldPlay: false, volume: 1 },
        undefined,
        // The module rung is the only one expo-asset can copy (that copy is what
        // the resources rungs exist to replace); URI rungs need no download step.
        rung.kind === 'module',
      );
      workingRung.set(key, rung.kind);
      return { sound: created.sound, kind: rung.kind };
    } catch (err) {
      lastDetail = `${describeToneSourceRung(rung)}: ${usableDetail(err)}`;
    }
  }

  reportAudioFailure({
    source: 'tone-preview',
    reason: 'tone-load',
    detail: lastDetail || `no source rung for ${key}`,
  });
  return null;
}
