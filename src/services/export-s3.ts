/**
 * Lazy S3/R2 client for the export handler — same shape as the sheet-handler's
 * own client (which cannot be imported without side effects), so PDF export can
 * stream the curated object back to the requesting app.
 */
import { S3Client } from "@aws-sdk/client-s3";

let _s3: S3Client | null = null;

export function getS3ForExport(): S3Client | null {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  if (!_s3) {
    _s3 = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }
  return _s3;
}
