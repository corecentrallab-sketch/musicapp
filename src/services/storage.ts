/**
 * R2-compatible storage module for NoteSnap sheet music and cover art.
 *
 * Uses the S3-compatible API through @aws-sdk/client-s3. When R2 environment
 * variables are not set, falls back gracefully to local filesystem paths —
 * useful during development and testing.
 *
 * Configuration (env vars):
 *   R2_ENDPOINT        — e.g. https://<account_id>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID   — Cloudflare R2 access key
 *   R2_SECRET_ACCESS_KEY — Cloudflare R2 secret key
 *   R2_BUCKET_NAME     — Bucket name for sheet music storage
 *
 * URL pattern: scores/{composer_slug}/{catalog}/{format}/filename
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// S3 client (lazy initialisation — only created when env vars are present)
// ---------------------------------------------------------------------------
let _s3: S3Client | null = null;
let _s3Unavailable = false;

function getS3Client(): S3Client | null {
  if (_s3Unavailable) return null;
  if (_s3) return _s3;

  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.warn(
      "[storage] R2 env vars not set (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) — " +
        "falling back to local filesystem paths.",
    );
    _s3Unavailable = true;
    return null;
  }

  _s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  return _s3;
}

function getBucketName(): string {
  return process.env.R2_BUCKET_NAME || "notesnap-scores";
}

// ---------------------------------------------------------------------------
// Local fallback directory
// ---------------------------------------------------------------------------
const LOCAL_STORAGE_ROOT = "/tmp/notesnap-storage";

function ensureLocalDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UploadResult {
  /** Remote URL if uploaded to R2, or local file path if using fallback */
  url: string;
  /** Storage backend used: 'r2' or 'local' */
  backend: "r2" | "local";
  /** S3 etag (R2) or local file hash (fallback) */
  etag?: string;
}

/**
 * Upload a score file (PDF, MusicXML, MIDI, etc.) to R2 or local staging.
 *
 * @param key       Storage key, e.g. "scores/bach/bwv-846/pdf/prelude.pdf"
 * @param buffer    File contents as a Buffer
 * @param contentType MIME type, e.g. "application/pdf"
 * @returns UploadResult with the URL/path and backend used
 */
export async function uploadScore(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<UploadResult> {
  const s3 = getS3Client();

  if (s3) {
    // --- R2 upload ---
    const bucket = getBucketName();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    });

    const response = await s3.send(command);

    // Construct the public URL (or use a custom domain if configured)
    const endpoint = process.env.R2_ENDPOINT!;
    // R2 public bucket URL pattern: https://<bucket>.<account_id>.r2.cloudflarestorage.com/<key>
    // or a custom domain if R2_PUBLIC_URL is set
    const publicUrl =
      process.env.R2_PUBLIC_URL ||
      `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`;

    return {
      url: publicUrl,
      backend: "r2",
      etag: response.ETag?.replace(/"/g, ""),
    };
  }

  // --- Local fallback ---
  const localDir = `${LOCAL_STORAGE_ROOT}/${key.substring(0, key.lastIndexOf("/"))}`;
  ensureLocalDir(localDir);

  const localPath = `${LOCAL_STORAGE_ROOT}/${key}`;
  writeFileSync(localPath, buffer);

  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);

  console.log(`[storage] local fallback: wrote ${buffer.length} bytes to ${localPath}`);

  return {
    url: `file://${localPath}`,
    backend: "local",
    etag: hash,
  };
}

/**
 * Get a (potentially signed) URL for a stored score.
 *
 * For R2: returns a pre-signed URL valid for the specified duration.
 * For local: returns a `file://` path.
 *
 * @param key          Storage key
 * @param expiresInSec URL lifetime in seconds (R2 only, default 1 hour)
 * @returns URL string
 */
export async function getScoreUrl(
  key: string,
  expiresInSec: number = 3600,
): Promise<string> {
  const s3 = getS3Client();

  if (s3) {
    const bucket = getBucketName();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const signedUrl = await getSignedUrl(s3, command, {
      expiresIn: expiresInSec,
    });

    return signedUrl;
  }

  // Local fallback
  return `file://${LOCAL_STORAGE_ROOT}/${key}`;
}

/**
 * Check whether R2 storage is configured and available.
 */
export function isR2Available(): boolean {
  return getS3Client() !== null;
}

/**
 * Return a human-readable description of the current storage backend.
 */
export function storageInfo(): { backend: "r2" | "local"; bucket?: string } {
  const s3 = getS3Client();
  if (s3) {
    return { backend: "r2", bucket: getBucketName() };
  }
  return { backend: "local" };
}
