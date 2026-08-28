/**
 * exportPiece — FEATURE BUILD 5 (export-as-format).
 *
 * Lets the app export a public-domain piece (or a transposed ABC library copy)
 * to MIDI / MusicXML / PDF and hand the resulting file to the native share
 * sheet. The actual conversion happens on the server (POST /api/export — fast,
 * not memory-heavy on device); this client downloads the returned bytes, saves
 * them to app storage, and shares via expo-sharing.
 *
 * Copyright rule: export is ONLY offered for public-domain pieces. Every call
 * starts with a `isPublicDomain` guard, and the server independently enforces
 * the rule (see the backend export-handler).
 */
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { getApiBaseUrl } from './api';

export type ExportFormat = 'midi' | 'musicxml' | 'pdf';

export interface ExportOptions {
  /** ABC body when exporting a melody (used for midi/musicxml). */
  abc?: string;
  /** Catalog piece UUID when exporting a recognized/library piece (pdf + verification). */
  pieceId?: string;
  title: string;
  /** MUST be true — export is gated to public-domain pieces. */
  isPublicDomain: boolean;
}

const MIME_BY_FORMAT: Record<ExportFormat, string> = {
  midi: 'audio/midi',
  musicxml: 'application/vnd.recordare.musicxml+xml',
  pdf: 'application/pdf',
};

const EXT_BY_FORMAT: Record<ExportFormat, string> = {
  midi: 'mid',
  musicxml: 'musicxml',
  pdf: 'pdf',
};

/** Small dependency-free base64 encoder (Hermes-safe, no Buffer/btoa needed). */
function base64FromBytes(bytes: Uint8Array): string {
  const CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out +=
      CHARS[(n >> 18) & 63] +
      CHARS[(n >> 12) & 63] +
      CHARS[(n >> 6) & 63] +
      CHARS[n & 63];
  }
  const rem = len % 3;
  if (rem === 1) out = out.slice(0, -2) + '==';
  else if (rem === 2) out = out.slice(0, -1) + '=';
  return out;
}

/** Build a safe output filename for a given piece + format. */
export function exportFileName(title: string, format: ExportFormat): string {
  const base =
    (title || 'score').replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'score';
  return `${base}.${EXT_BY_FORMAT[format]}`;
}

/**
 * Export a public-domain piece and share the file via the native share sheet.
 * Returns 'shared' after the share sheet is dismissed (or 'downloaded' on web
 * where no native sheet exists).
 */
export async function exportAndShare(
  options: ExportOptions,
  format: ExportFormat,
): Promise<'shared' | 'downloaded'> {
  if (!options.isPublicDomain) {
    throw new Error('Export is available for public-domain pieces only.');
  }

  // Build the server request. With a catalog pieceId the server verifies PD in
  // the DB; for ABC-only (transposed library copies) we pass publicDomain=true
  // because these originated from the public-domain editor.
  const body: Record<string, unknown> = { format, title: options.title };
  if (options.pieceId) body.pieceId = options.pieceId;
  if (options.abc) body.abc = options.abc;
  if (!options.pieceId) body.publicDomain = true;

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the export service. Please try again.');
  }

  if (!response.ok) {
    let message = 'Export failed.';
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed?.error) message = String(parsed.error);
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new Error(message);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  // Save to app documents (survives cache clears; keeps files out of RAM).
  const dir = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ''}exports/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const uri = `${dir}${exportFileName(options.title, format)}`;
  await FileSystem.writeAsStringAsync(uri, base64FromBytes(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (Platform.OS === 'web') {
    return 'downloaded';
  }

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: MIME_BY_FORMAT[format],
    dialogTitle: `${options.title} — ${format.toUpperCase()}`,
  });
  return 'shared';
}
