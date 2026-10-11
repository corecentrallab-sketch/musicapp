/**
 * tunerDecoder.ts — turning a recorded tuner take into samples ON THE DEVICE,
 * with no backend and no new native dependency.
 *
 * WHY THIS EXISTS (read before changing the tuner's capture path): the app's
 * recorder (expo-av) writes compressed AAC on Android and exposes no PCM buffer,
 * so the tuner cannot ask the microphone for raw samples — the same finding
 * documented in docs/coach-capture.md, whose Option B this is. Android's WebView
 * (Chromium) CAN decode an AAC/MP4 clip to samples, so the take is handed to a
 * one-screen HTML page inside the WebView that the app already depends on
 * (react-native-webview), decoded there, and sent back as base64 PCM16 — which
 * the app's EXISTING decoder (services/wavCapture.ts `decodePcm16Base64`) turns
 * into the Float32Array that the EXISTING pitch engine (services/pitchDetection.ts
 * `detectPitchFrames`) reads. Nothing is uploaded, nothing is added to
 * package.json, and the tuner works with the device offline.
 *
 * The page is a CONSTANT in this file, never a URL: `TUNER_DECODER_MARKERS` and
 * `TUNER_DECODER_FORBIDDEN` are asserted against it by scripts/tuner.test.ts, so
 * "offline" is a checkable property of the source rather than a promise in a
 * commit message.
 *
 * Wire protocol (JSON strings both ways):
 *   RN → page   { type: 'decode', id, audioBase64, mimeType }
 *   page → RN   { type: 'ready' }
 *               { type: 'decoded', id, sampleRate, channels, pcm16Base64 }
 *               { type: 'error', id, message }
 *
 * PURE LOGIC: no react, no react-native — safe for tsconfig.tier1.json.
 */

export const TUNER_DECODER_READY = 'ready';
export const TUNER_DECODER_DECODED = 'decoded';
export const TUNER_DECODER_ERROR = 'error';

/**
 * The tokens the page MUST contain — the decoder itself, the bridge back, and
 * the PCM16 shape the app's own decoder expects.
 */
export const TUNER_DECODER_MARKERS: readonly string[] = [
  'decodeAudioData',
  'AudioContext',
  'ReactNativeWebView.postMessage',
  'pcm16Base64',
  'setInt16',
];

/**
 * Tokens that must NOT appear in the page. Any of these would mean the "works
 * offline" line on the screen is untrue, so the gate fails on them.
 */
export const TUNER_DECODER_FORBIDDEN: readonly string[] = [
  'http://',
  'https://',
  'fetch(',
  'XMLHttpRequest',
  'importScripts',
  'navigator.sendBeacon',
];

/**
 * The decoder page. Self-contained: no stylesheet, no script src, no network of
 * any kind — it only turns the bytes it is handed into PCM16 base64 and posts
 * them back to React Native.
 */
export const TUNER_DECODER_HTML: string = [
  '<!DOCTYPE html>',
  '<html><head><meta charset="utf-8"/>',
  '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
  '<title>NoteSnap note reader</title></head>',
  '<body><script>',
  '(function () {',
  '  var seen = {};',
  '  function post(payload) {',
  '    try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch (e) {}',
  '  }',
  '  function b64ToBytes(b64) {',
  '    var clean = String(b64 || "").replace(/[^A-Za-z0-9+/=]/g, "");',
  '    var binary = window.atob(clean);',
  '    var out = new Uint8Array(binary.length);',
  '    for (var i = 0; i < binary.length; i++) { out[i] = binary.charCodeAt(i); }',
  '    return out;',
  '  }',
  '  function downmix(buffer) {',
  '    var channels = buffer.numberOfChannels;',
  '    var length = buffer.length;',
  '    var out = new Float32Array(length);',
  '    for (var c = 0; c < channels; c++) {',
  '      var data = buffer.getChannelData(c);',
  '      for (var i = 0; i < length; i++) { out[i] += data[i] / channels; }',
  '    }',
  '    return out;',
  '  }',
  '  function pcm16Base64(samples) {',
  '    var length = samples.length;',
  '    var bytes = new Uint8Array(length * 2);',
  '    var view = new DataView(bytes.buffer);',
  '    for (var i = 0; i < length; i++) {',
  '      var s = samples[i];',
  '      if (!isFinite(s)) { s = 0; }',
  '      if (s > 1) { s = 1; } else if (s < -1) { s = -1; }',
  '      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);',
  '    }',
  '    var chunk = 0x8000;',
  '    var binary = "";',
  '    for (var o = 0; o < bytes.length; o += chunk) {',
  '      binary += String.fromCharCode.apply(null, bytes.subarray(o, o + chunk));',
  '    }',
  '    return window.btoa(binary);',
  '  }',
  '  var context = null;',
  '  function audioContext() {',
  '    if (context) { return context; }',
  '    var Ctor = window.AudioContext || window.webkitAudioContext;',
  '    if (!Ctor) { return null; }',
  '    context = new Ctor();',
  '    return context;',
  '  }',
  '  function decode(message) {',
  '    var id = message && message.id;',
  '    if (id && seen[id]) { return; }',
  '    if (id) { seen[id] = true; }',
  '    var ctx = audioContext();',
  '    if (!ctx) { post({ type: "error", id: id, message: "no audio decoder" }); return; }',
  '    var bytes = b64ToBytes(message.audioBase64);',
  '    var buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);',
  '    var settled = false;',
  '    function done(audioBuffer) {',
  '      if (settled) { return; }',
  '      settled = true;',
  '      try {',
  '        var mono = downmix(audioBuffer);',
  '        post({ type: "decoded", id: id, sampleRate: audioBuffer.sampleRate, channels: audioBuffer.numberOfChannels, pcm16Base64: pcm16Base64(mono) });',
  '      } catch (e) { post({ type: "error", id: id, message: "could not read that take" }); }',
  '    }',
  '    function fail() {',
  '      if (settled) { return; }',
  '      settled = true;',
  '      post({ type: "error", id: id, message: "could not decode that take" });',
  '    }',
  '    try {',
  '      var maybe = ctx.decodeAudioData(buffer, done, fail);',
  '      if (maybe && typeof maybe.then === "function") { maybe.then(done, fail); }',
  '    } catch (e) { fail(); }',
  '  }',
  '  function handle(event) {',
  '    var raw = event && event.data;',
  '    if (typeof raw !== "string") { return; }',
  '    var message = null;',
  '    try { message = JSON.parse(raw); } catch (e) { return; }',
  '    if (message && message.type === "decode") { decode(message); }',
  '  }',
  '  document.addEventListener("message", handle);',
  '  window.addEventListener("message", handle);',
  '  window.onerror = function (message) { post({ type: "error", id: null, message: String(message) }); };',
  '  post({ type: "ready" });',
  '})();',
  '</script></body></html>',
].join('\n');

/** What the screen sends the page. */
export interface TunerDecodeRequest {
  type: 'decode';
  id: string;
  /** The recorded take, base64 (expo-file-system, EncodingType.Base64). */
  audioBase64: string;
  /** Informational — Chromium sniffs the container itself. */
  mimeType: string;
}

/** A validated reply from the page. */
export type TunerDecoderReply =
  | { kind: 'ready' }
  | {
      kind: 'decoded';
      id: string;
      sampleRate: number;
      channels: number;
      pcm16Base64: string;
    }
  | { kind: 'error'; id: string | null; message: string }
  | { kind: 'unknown' };

/** The JSON string to hand to the WebView's postMessage. */
export function buildTunerDecodeMessage(
  id: string,
  audioBase64: string,
  mimeType = 'audio/mp4',
): string {
  const request: TunerDecodeRequest = {
    type: 'decode',
    id,
    audioBase64: typeof audioBase64 === 'string' ? audioBase64 : '',
    mimeType: typeof mimeType === 'string' && mimeType.length > 0 ? mimeType : 'audio/mp4',
  };
  return JSON.stringify(request);
}

/**
 * Parse a reply from the page. Anything malformed is 'unknown' rather than a
 * guess — a half-read reply must not become a note on the screen.
 */
export function parseTunerDecoderReply(raw: unknown): TunerDecoderReply {
  if (typeof raw !== 'string' || raw.length === 0) return { kind: 'unknown' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'unknown' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'unknown' };
  const value = parsed as Record<string, unknown>;
  const type = value.type;
  if (type === TUNER_DECODER_READY) return { kind: 'ready' };
  if (type === TUNER_DECODER_ERROR) {
    return {
      kind: 'error',
      id: typeof value.id === 'string' ? value.id : null,
      message: typeof value.message === 'string' ? value.message : 'decode failed',
    };
  }
  if (type === TUNER_DECODER_DECODED) {
    const id = value.id;
    const sampleRate = value.sampleRate;
    const channels = value.channels;
    const pcm16Base64 = value.pcm16Base64;
    if (typeof id !== 'string' || id.length === 0) return { kind: 'unknown' };
    if (typeof sampleRate !== 'number' || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      return { kind: 'unknown' };
    }
    if (typeof pcm16Base64 !== 'string' || pcm16Base64.length === 0) return { kind: 'unknown' };
    return {
      kind: 'decoded',
      id,
      sampleRate,
      channels: channels === 2 ? 2 : 1,
      pcm16Base64,
    };
  }
  return { kind: 'unknown' };
}

/** True when the page contains everything the decoder needs and nothing else. */
export function tunerDecoderPageIsSelfContained(html: string): boolean {
  if (typeof html !== 'string' || html.length < 500) return false;
  for (const marker of TUNER_DECODER_MARKERS) {
    if (html.indexOf(marker) < 0) return false;
  }
  for (const banned of TUNER_DECODER_FORBIDDEN) {
    if (html.indexOf(banned) >= 0) return false;
  }
  return true;
}
