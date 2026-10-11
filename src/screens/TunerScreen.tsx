/**
 * TunerScreen — the NoteSnap TUNER (owner APPROVED 10-10, backlog 2bbbbc8f).
 *
 * WHAT IT IS: a free, offline guitar/piano/keyboard tuner. Tap Listen, play one
 * note, and the screen names the note and shows how many cents sharp or flat it
 * is, with a needle on a ±50-cent scale. "Keep listening" repeats the take so a
 * player can turn a peg and watch the needle move.
 *
 * HOW THE SOUND GETS READ (and why this is the honest path): the app's recorder
 * produces a compressed AAC take and expo-av exposes no PCM buffer, so the notes
 * cannot be read straight off the microphone (see docs/coach-capture.md). The
 * take is therefore decoded by the WebView the app already ships — the page in
 * src/services/tunerDecoder.ts, an inline constant with no URL, no fetch and no
 * script src — and comes back as base64 PCM16, which the app's EXISTING decoder
 * (`decodePcm16Base64`, services/wavCapture.ts) turns into samples and the
 * app's EXISTING pitch engine (`tunerReadingFromTake` → `detectPitchFrames`,
 * services/pitchDetection.ts) turns into the reading. Nothing is uploaded, no
 * dependency was added, and the tuner works with the device offline.
 *
 * FREE BY OWNER VERDICT (10-10): no paywall, no usage metering, no Pro check —
 * the tuner is not a paid feature and recognition is untouched by it.
 *
 * Every threshold, the note naming and the needle maths live in
 * services/tuner.ts, and the wire protocol in services/tunerDecoder.ts; this file
 * owns only the microphone loop and the layout.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { WebView } from 'react-native-webview';
import { useThemedStyles } from '../services/themeStore';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { TunerMeter } from '../components/TunerMeter';
import { decodePcm16Base64 } from '../services/wavCapture';
import {
  TUNER_AUTO_CTA,
  TUNER_AUTO_GAP_MS,
  TUNER_AUTO_STOP_CTA,
  TUNER_DECODE_FAIL_LINE,
  TUNER_DECODE_TIMEOUT_LINE,
  TUNER_DECODE_TIMEOUT_MS,
  TUNER_DECODER_NOT_READY_LINE,
  TUNER_DEVICE_LINE,
  TUNER_FREE_LINE,
  TUNER_HEADLINE,
  TUNER_IDLE_LINE,
  TUNER_INSTRUMENT_LINE,
  TUNER_LISTENING_LINE,
  TUNER_LISTEN_AGAIN_CTA,
  TUNER_LISTEN_CTA,
  TUNER_SILENT_LINE,
  TUNER_TAKE_MS,
  TUNER_UNCLEAR_LINE,
  describeTunerReading,
  tunerReadingFromTake,
  type TunerReading,
} from '../services/tuner';
import {
  TUNER_DECODER_HTML,
  buildTunerDecodeMessage,
  parseTunerDecoderReply,
} from '../services/tunerDecoder';

type TunerStatus = 'idle' | 'listening' | 'reading' | 'error';

export const TunerScreen: React.FC = () => {
  const { styles, theme } = useThemedStyles(baseStyles);
  const recorder = useAudioRecorder();
  const decoderRef = useRef<WebView>(null);
  const decoderReadyRef = useRef(false);
  /** A decode request that arrived before the page said it was ready. */
  const queuedRef = useRef<string | null>(null);
  /** The take we are waiting on. A reply for any other id is ignored. */
  const pendingIdRef = useRef<string | null>(null);
  const takeCounterRef = useRef(0);
  const takeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const autoRef = useRef(false);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<TunerStatus>('idle');
  const [reading, setReading] = useState<TunerReading | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [decoderReady, setDecoderReady] = useState(false);

  const clearTimer = useCallback((ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (ref.current) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  }, []);

  // Every timer this screen owns is cleared on unmount (the recorder hook tears
  // its own microphone down); a tuner left open must not keep a timer alive.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      autoRef.current = false;
      if (takeTimerRef.current) clearTimeout(takeTimerRef.current);
      if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
      if (decodeTimerRef.current) clearTimeout(decodeTimerRef.current);
      takeTimerRef.current = null;
      gapTimerRef.current = null;
      decodeTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);

  /** Hand a decode request to the page, queueing until it has said "ready". */
  const postToDecoder = useCallback((payload: string) => {
    if (!decoderReadyRef.current) {
      queuedRef.current = payload;
      return;
    }
    decoderRef.current?.postMessage(payload);
  }, []);

  /** Say a failure out loud and stop the repeat loop (never a silent no-op). */
  const failWith = useCallback(
    (text: string) => {
      if (!mountedRef.current) return;
      setStatus('error');
      setMessage(text);
      setAuto(false);
      autoRef.current = false;
    },
    [],
  );

  const scheduleNextTake = useCallback(
    (startTake: () => void) => {
      if (!autoRef.current || !mountedRef.current) return;
      clearTimer(gapTimerRef);
      gapTimerRef.current = setTimeout(() => {
        gapTimerRef.current = null;
        if (mountedRef.current && autoRef.current) startTake();
      }, TUNER_AUTO_GAP_MS);
    },
    [clearTimer],
  );

  /** Read one take: stop the mic, decode it on device, then read the pitch. */
  const stopTake = useCallback(
    async (startTake: () => void) => {
      try {
        const stopped = await recorder.stopRecording();
        if (!stopped) {
          const failure = recorder.takeStopFailure();
          busyRef.current = false;
          failWith(failure?.message ?? TUNER_DECODE_FAIL_LINE);
          return;
        }
        if (!mountedRef.current) {
          busyRef.current = false;
          return;
        }
        setStatus('reading');
        const base64 = await FileSystem.readAsStringAsync(stopped.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        // The take has served its purpose: read it, then drop the file so a
        // "keep listening" session cannot fill the cache with takes.
        FileSystem.deleteAsync(stopped.uri, { idempotent: true }).catch(() => {});
        if (!mountedRef.current) {
          busyRef.current = false;
          return;
        }
        takeCounterRef.current += 1;
        const id = `tuner-${takeCounterRef.current}`;
        pendingIdRef.current = id;
        postToDecoder(buildTunerDecodeMessage(id, base64));
        // The page must answer, or the screen would sit on "reading" forever.
        clearTimer(decodeTimerRef);
        decodeTimerRef.current = setTimeout(() => {
          decodeTimerRef.current = null;
          if (pendingIdRef.current === id) {
            pendingIdRef.current = null;
            busyRef.current = false;
            failWith(TUNER_DECODE_TIMEOUT_LINE);
          }
        }, TUNER_DECODE_TIMEOUT_MS);
      } catch {
        busyRef.current = false;
        failWith(TUNER_DECODE_FAIL_LINE);
      }
      // The repeat loop is re-armed when a take has actually been read.
      scheduleNextTake(startTake);
    },
    [clearTimer, failWith, postToDecoder, recorder, scheduleNextTake],
  );

  /** Open the microphone for one take. */
  const startTake = useCallback(() => {
    if (busyRef.current || !mountedRef.current) return;
    if (!decoderReady) {
      // No decoder page yet (or this build has no WebView for it): say so
      // instead of opening the mic for a take nothing can read.
      failWith(TUNER_DECODER_NOT_READY_LINE);
      return;
    }
    busyRef.current = true;
    setStatus('listening');
    setMessage(null);
    void (async () => {
      const started = await recorder.startRecording();
      if (!started) {
        const failure = recorder.takeStartFailure();
        busyRef.current = false;
        failWith(failure?.message ?? TUNER_DECODE_FAIL_LINE);
        return;
      }
      clearTimer(takeTimerRef);
      takeTimerRef.current = setTimeout(() => {
        takeTimerRef.current = null;
        void stopTake(startTake);
      }, TUNER_TAKE_MS);
    })();
  }, [clearTimer, decoderReady, failWith, recorder, stopTake]);
  // NOTE: startTake is referenced inside stopTake for the repeat loop, and
  // stopTake is referenced inside startTake's take timer. Both are stable
  // useCallbacks over refs/timers only, so the cycle settles in one pass.

  /** A validated reply from the decoder page. */
  const handleDecoderReply = useCallback(
    (raw: string) => {
      const reply = parseTunerDecoderReply(raw);
      if (reply.kind === 'ready') {
        decoderReadyRef.current = true;
        setDecoderReady(true);
        const queued = queuedRef.current;
        queuedRef.current = null;
        if (queued) decoderRef.current?.postMessage(queued);
        return;
      }
      if (reply.kind === 'decoded') {
        // Ignore a reply for an older take (a late answer must not overwrite the
        // reading the user is looking at).
        if (pendingIdRef.current !== reply.id) return;
        pendingIdRef.current = null;
        clearTimer(decodeTimerRef);
        busyRef.current = false;
        if (!mountedRef.current) return;
        try {
          const samples = decodePcm16Base64(reply.pcm16Base64, reply.channels);
          const next = tunerReadingFromTake(samples, reply.sampleRate);
          setReading(next);
          setStatus('idle');
          setMessage(
            next.kind === 'no-signal'
              ? next.reason === 'silent'
                ? TUNER_SILENT_LINE
                : TUNER_UNCLEAR_LINE
              : null,
          );
        } catch {
          failWith(TUNER_DECODE_FAIL_LINE);
        }
        scheduleNextTake(startTake);
        return;
      }
      if (reply.kind === 'error') {
        if (reply.id && pendingIdRef.current && reply.id !== pendingIdRef.current) return;
        pendingIdRef.current = null;
        clearTimer(decodeTimerRef);
        busyRef.current = false;
        failWith(TUNER_DECODE_FAIL_LINE);
      }
    },
    [clearTimer, failWith, scheduleNextTake, startTake],
  );

  const toggleAuto = useCallback(() => {
    const next = !autoRef.current;
    autoRef.current = next;
    setAuto(next);
    // Turning it on starts a take now; turning it off only cancels the gap timer
    // (the take in flight finishes and shows its reading).
    if (next) startTake();
    else clearTimer(gapTimerRef);
  }, [clearTimer, startTake]);

  const busy = status === 'listening' || status === 'reading';
  const listenLabel = busy
    ? TUNER_LISTENING_LINE
    : reading
      ? TUNER_LISTEN_AGAIN_CTA
      : TUNER_LISTEN_CTA;

  return (
    <View style={styles.container}>
      <Text style={styles.headline}>{TUNER_HEADLINE}</Text>

      <TunerMeter reading={reading} busy={busy} />

      <Text style={styles.readoutLine} accessibilityLabel={describeTunerReading(reading)}>
        {message ??
          (busy
            ? status === 'listening'
              ? TUNER_LISTENING_LINE
              : 'Reading that take…'
            : recorder.error ?? TUNER_IDLE_LINE)}
      </Text>

      <Pressable
        style={({ pressed }) => [
          styles.listenButton,
          busy && styles.listenButtonBusy,
          pressed && styles.pressed,
        ]}
        onPress={startTake}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={listenLabel}
        accessibilityState={{ disabled: busy }}
      >
        <Ionicons name="mic" size={20} color="#ffffff" />
        <Text style={styles.listenButtonText}>{listenLabel}</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [
          styles.autoButton,
          auto && styles.autoButtonOn,
          pressed && styles.pressed,
        ]}
        onPress={toggleAuto}
        accessibilityRole="button"
        accessibilityState={{ selected: auto }}
        accessibilityLabel={auto ? TUNER_AUTO_STOP_CTA : TUNER_AUTO_CTA}
      >
        <Ionicons
          name={auto ? 'pause' : 'repeat'}
          size={16}
          color={auto ? theme.text : theme.accent}
        />
        <Text style={[styles.autoButtonText, auto && styles.autoButtonTextOn]}>
          {auto ? TUNER_AUTO_STOP_CTA : TUNER_AUTO_CTA}
        </Text>
      </Pressable>

      <View style={styles.notes}>
        <Text style={styles.noteLine}>{TUNER_FREE_LINE}</Text>
        <Text style={styles.noteLine}>{TUNER_DEVICE_LINE}</Text>
        <Text style={styles.noteLine}>{TUNER_INSTRUMENT_LINE}</Text>
        {!decoderReady && (
          <Text style={styles.noteLine}>Preparing the on-device note reader…</Text>
        )}
      </View>

      {/*
        THE ON-DEVICE NOTE READER (services/tunerDecoder.ts). It is a real,
        mounted WebView because Android's WebView is the only audio decoder the
        app already ships; it is parked off-screen, never focusable, and its page
        is an inline constant with no network of any kind.
      */}
      <View style={styles.decoderHost} pointerEvents="none">
        <WebView
          ref={decoderRef}
          source={{ html: TUNER_DECODER_HTML }}
          originWhitelist={['*']}
          javaScriptEnabled
          // The decoder page is app-rendered inline HTML (services/tunerDecoder.ts)
          // and answers over the bridge, so the WebView needs both of the app-shell
          // flags the in-app-browser contract requires of every mounted WebView.
          domStorageEnabled
          onMessage={(event) => handleDecoderReply(event.nativeEvent.data)}
          setSupportMultipleWindows={false}
          style={styles.decoder}
        />
      </View>
    </View>
  );
};

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  headline: {
    color: '#a0a0b8',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  readoutLine: {
    color: '#a0a0b8',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    minHeight: 38,
    marginTop: 4,
    marginBottom: 12,
  },
  listenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#e94560',
    paddingVertical: 14,
    borderRadius: 14,
  },
  listenButtonBusy: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.7,
  },
  listenButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  autoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  autoButtonOn: {
    backgroundColor: '#1f2b52',
    borderColor: '#e94560',
  },
  autoButtonText: {
    color: '#eaeaff',
    fontSize: 13,
    fontWeight: '700',
  },
  autoButtonTextOn: {
    color: '#ffffff',
  },
  notes: {
    marginTop: 16,
    gap: 6,
  },
  noteLine: {
    color: '#a0a0b8',
    fontSize: 12,
    lineHeight: 17,
  },
  /**
   * The decoder WebView, parked off-screen. It must stay MOUNTED and laid out
   * (a zero-size view can be skipped by the platform), so it is 2×2, fully
   * transparent, out of the layout flow and untouchable.
   */
  decoderHost: {
    position: 'absolute',
    left: -1000,
    top: -1000,
    width: 2,
    height: 2,
    opacity: 0,
  },
  decoder: {
    width: 2,
    height: 2,
    backgroundColor: 'transparent',
  },
});
