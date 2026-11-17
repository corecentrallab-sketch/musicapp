/**
 * TakeDecoderProbeCard — THE OPT-IN DECODER PROBE ON THE PRACTICE-VIDEO REVIEW PAGE
 * (vc60 spec §4, VC59-DECODER-PROBE.md).
 *
 * WHAT IT DOES, AND WHAT IT MUST NOT DO. Pressing the control decodes THIS TAKE's own
 * audio file on the device, once, with the decoder the app already ships
 * (services/tunerDecoder.ts — a hidden WebView and Chromium's `decodeAudioData`), and
 * prints one measured line:
 *
 *   probe: file=2.9MB decoded=180.0s float32=63.5MB pcm16=21.2MB decode=8400ms peak_heap=? survived=yes
 *
 * It is a MEASUREMENT, not a feature:
 *   • nothing runs until the user presses the control — the WebView is not even
 *     mounted before that, so the shipped notes read cannot reach it;
 *   • it writes nothing: no History row, no change to the take, no upload (the page
 *     is an inline constant with no network of any kind);
 *   • it does not retry, does not fall back, and does not hide behind a spinner: a
 *     decode that throws, a page that never answers, or an app that dies under the
 *     decode are all reported as results.
 *
 * WHY IT IS HONEST RATHER THAN PRETTY. The next build's plan — read the video file's
 * own audio track on the device, so the 60-second server cap disappears — is worth
 * 8–12 engineer-days ONLY if a 3-minute decode survives on the handset. That is a
 * question no desk can answer, so this build asks it on the owner's phone.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { WebView } from 'react-native-webview';
import { useThemedStyles } from '../services/themeStore';
import {
  READ_DRAW_NOT_MEASURED_NOTE,
  READ_TIMINGS_LABEL,
  readTimingsAudioLine,
  readTimingsLine,
  type TakeReadTiming,
} from '../services/takeReadTimings';
import {
  PROBE_CTA,
  PROBE_FAILED_LINE,
  PROBE_HINT,
  PROBE_LABEL,
  PROBE_RISK_LINE,
  PROBE_RUNNING_LINE,
  hermesHeapBytes,
  probeLine,
} from '../services/takeDecoderProbe';
import {
  TUNER_DECODER_HTML,
  buildTunerDecodeMessage,
  parseTunerDecoderReply,
} from '../services/tunerDecoder';

/**
 * How long the probe waits for the decoder page before it calls the attempt dead.
 * Generous: a 3-minute decode on a slow handset is seconds, not minutes, but the
 * point of the bound is that the surface ALWAYS says something.
 */
export const PROBE_TIMEOUT_MS = 120000;

export interface TakeDecoderProbeCardProps {
  /** The take's audio file — the video file when it has one, else the .m4a. */
  uri: string | null | undefined;
  /**
   * ── vc61 (spec §2) ── WHERE THE TIME WENT, FOR THE READS THAT HAVE FINISHED.
   *
   * The probe above answers "can this phone decode a whole take on its own"; this answers the
   * other question the owner's *"almost unusable"* raised: which stage of the SHIPPED read is
   * eating the seconds. Newest first, so a slow read sits beside the fast one it beat. It is
   * display only — nothing here runs, reads a file or changes a take.
   */
  readTimings?: ReadonlyArray<TakeReadTiming> | null;
}

/** Bytes in a base64 payload, without decoding it. */
function base64Bytes(payload: string): number {
  const text = typeof payload === 'string' ? payload : '';
  if (text.length === 0) return 0;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return Math.floor((text.length * 3) / 4) - padding;
}

/** The MIME the page sniffs against (Chromium decides from the bytes). */
function probeMime(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  return 'audio/mp4';
}

export const TakeDecoderProbeCard: React.FC<TakeDecoderProbeCardProps> = ({
  uri,
  readTimings,
}) => {
  const { styles } = useThemedStyles(baseStyles);
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const webRef = useRef<WebView<{}> | null>(null);
  const readyRef = useRef(false);
  const queuedRef = useRef<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const fileBytesRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const counterRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  const postToPage = useCallback((payload: string) => {
    if (!readyRef.current) {
      queuedRef.current = payload;
      return;
    }
    webRef.current?.postMessage(payload);
  }, []);

  const handleReply = useCallback((raw: string) => {
    const reply = parseTunerDecoderReply(raw);
    if (reply.kind === 'ready') {
      readyRef.current = true;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued) webRef.current?.postMessage(queued);
      return;
    }
    if (reply.kind === 'decoded') {
      if (pendingRef.current !== reply.id) return;
      pendingRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      const decodeMs = Date.now() - startedAtRef.current;
      const pcm16Bytes = base64Bytes(reply.pcm16Base64);
      const samples = Math.floor(pcm16Bytes / 2);
      const decodedSec =
        reply.sampleRate > 0 && samples > 0 ? samples / reply.sampleRate : null;
      if (!mountedRef.current) return;
      setLine(
        probeLine({
          fileBytes: fileBytesRef.current,
          decodedSec,
          sampleRate: reply.sampleRate,
          channels: reply.channels,
          pcm16Bytes,
          decodeMs,
          peakHeapBytes: hermesHeapBytes(),
          // We are printing this, so the decode returned and the screen is live.
          survived: true,
        }),
      );
      setDetail(null);
      setRunning(false);
      return;
    }
    if (reply.kind === 'error') {
      if (pendingRef.current !== reply.id) return;
      pendingRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (!mountedRef.current) return;
      setLine(PROBE_FAILED_LINE);
      setDetail(reply.message);
      setRunning(false);
    }
  }, []);

  const run = useCallback(async () => {
    if (!uri || running) return;
    setArmed(true);
    setRunning(true);
    setLine(null);
    setDetail(null);
    try {
      let bytes: number | null = null;
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info?.exists && typeof info.size === 'number') bytes = info.size;
      } catch {
        bytes = null;
      }
      fileBytesRef.current = bytes;
      // The whole file, base64 — the same mechanism the tuner uses. A big take is
      // exactly what this probe is testing, so nothing is trimmed here.
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (!mountedRef.current) return;
      counterRef.current += 1;
      const id = `probe-${counterRef.current}`;
      pendingRef.current = id;
      startedAtRef.current = Date.now();
      postToPage(buildTunerDecodeMessage(id, base64, probeMime(uri)));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (pendingRef.current !== id) return;
        pendingRef.current = null;
        if (!mountedRef.current) return;
        setLine(PROBE_FAILED_LINE);
        setDetail('the reader did not answer before the probe stopped waiting');
        setRunning(false);
      }, PROBE_TIMEOUT_MS);
    } catch (err) {
      if (!mountedRef.current) return;
      setLine(PROBE_FAILED_LINE);
      setDetail(err instanceof Error && err.message ? err.message : 'the file could not be read');
      setRunning(false);
    }
  }, [postToPage, running, uri]);

  return (
    <View style={styles.card}>
      {/* ── vc61 (spec §2) ── THE READ'S OWN STAGE TIMINGS, NEWEST FIRST. Real elapsed
          milliseconds measured on this phone; `?` for a stage that was not measured, and the
          staff draw is never invented (see services/takeReadTimings.ts). */}
      <Text style={styles.label}>{READ_TIMINGS_LABEL}</Text>
      {(readTimings ?? []).length === 0 ? (
        <Text style={styles.hint}>{readTimingsLine(null)}</Text>
      ) : (
        (readTimings ?? []).map((timing, index) => (
          <View key={`${timing.at}-${index}`}>
            <Text style={styles.line} selectable>
              {readTimingsLine(timing)}
            </Text>
            {readTimingsAudioLine(timing) ? (
              <Text style={styles.detail}>{readTimingsAudioLine(timing)}</Text>
            ) : null}
          </View>
        ))
      )}
      <Text style={styles.risk}>{READ_DRAW_NOT_MEASURED_NOTE}</Text>
      <Text style={styles.label}>{PROBE_LABEL}</Text>
      <Text style={styles.hint}>{PROBE_HINT}</Text>
      <Pressable
        style={[styles.button, running && styles.buttonBusy]}
        onPress={() => void run()}
        accessibilityRole="button"
        accessibilityLabel={PROBE_CTA}
        disabled={running || !uri}
      >
        <Text style={styles.buttonText}>{PROBE_CTA}</Text>
      </Pressable>
      <Text style={styles.risk}>{PROBE_RISK_LINE}</Text>
      {running ? <Text style={styles.running}>{PROBE_RUNNING_LINE}</Text> : null}
      {line ? (
        <Text style={styles.line} selectable>
          {line}
        </Text>
      ) : null}
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {armed ? (
        /* The decoder page, mounted only after the press and parked off-screen. */
        <View style={styles.host} pointerEvents="none">
          <WebView
            ref={webRef}
            source={{ html: TUNER_DECODER_HTML }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            onMessage={(event) => handleReply(event.nativeEvent.data)}
            style={styles.web}
          />
        </View>
      ) : null}
    </View>
  );
};

const baseStyles = StyleSheet.create({
  card: {
    backgroundColor: '#12122b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#0f3460',
    padding: 14,
    marginTop: 14,
  },
  label: { color: '#a0a0b8', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  hint: { color: '#7d7d99', fontSize: 11, lineHeight: 16, marginTop: 6 },
  risk: { color: '#7d7d99', fontSize: 11, lineHeight: 16, marginTop: 6 },
  button: {
    marginTop: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4ecdc4',
    backgroundColor: '#16213e',
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: '#4ecdc4', fontSize: 13, fontWeight: '800' },
  running: { color: '#a0a0b8', fontSize: 12, marginTop: 10 },
  line: {
    color: '#eaeaff',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
    fontFamily: 'monospace',
  },
  detail: { color: '#e94560', fontSize: 11, lineHeight: 16, marginTop: 6 },
  host: {
    position: 'absolute',
    left: -1000,
    top: -1000,
    width: 2,
    height: 2,
    opacity: 0,
  },
  web: { width: 2, height: 2, backgroundColor: 'transparent' },
});
