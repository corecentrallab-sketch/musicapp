import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

const FPCMD = "/usr/bin/fpcalc";

/**
 * Run fpcalc against an audio file and return the raw 32-bit integer fingerprint.
 *
 * Uses fpcalc -raw -length 120 to generate a Chromaprint fingerprint as a
 * space-separated list of 32-bit integers. Returns the parsed int[].
 *
 * The audio file must already be 16kHz mono 16-bit PCM WAV — callers should
 * transcode via ffmpeg before calling this function.
 */
export async function generateFingerprint(
  audioPath: string,
): Promise<{ fingerprint: number[]; duration: number }> {
  const { stdout, stderr } = await execFileAsync(FPCMD, [
    "-raw",
    "-length",
    "120",
    audioPath,
  ]);

  if (stderr) {
    console.warn("[fpcalc] stderr:", stderr);
  }

  const output = stdout.trim();
  if (!output) {
    throw new Error("fpcalc produced no output — audio may be too short or silent");
  }

  // fpcalc -raw output format:
  //   DURATION=<seconds>
  //   FINGERPRINT=<space-separated 32-bit ints>
  const lines = output.split("\n");
  let duration = 0;
  let fingerprintRaw = "";

  for (const line of lines) {
    if (line.startsWith("DURATION=")) {
      duration = parseFloat(line.substring(9));
    } else if (line.startsWith("FINGERPRINT=")) {
      fingerprintRaw = line.substring(12);
    }
  }

  if (!fingerprintRaw) {
    throw new Error("fpcalc output missing FINGERPRINT line");
  }

  const fingerprint = fingerprintRaw
    .trim()
    .split(/\s+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n));

  if (fingerprint.length === 0) {
    throw new Error("fpcalc produced empty fingerprint");
  }

  return { fingerprint, duration };
}

/**
 * Transcode an input audio buffer to 16kHz mono 16-bit PCM WAV using ffmpeg,
 * then run fpcalc on the result. Cleans up the temp file.
 *
 * Acceptable input formats: anything ffmpeg can decode (Opus/Ogg, WAV, MP3, etc.)
 * Returns the int[] fingerprint.
 */
export async function fingerprintFromBuffer(
  audioBuffer: Buffer,
): Promise<{ fingerprint: number[]; duration: number }> {
  const tmpDir = await mkdtemp(join(tmpdir(), "notesnap-fp-"));
  const inputPath = join(tmpDir, "input.audio");
  const outputPath = join(tmpDir, "output.wav");

  try {
    // Write the uploaded buffer to a temp file
    await writeFile(inputPath, audioBuffer);

    // Transcode to 16kHz mono 16-bit PCM WAV
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-ar", "16000",
      "-ac", "1",
      "-sample_fmt", "s16",
      "-f", "wav",
      outputPath,
    ]);

    // Generate fingerprint from the transcoded WAV
    return await generateFingerprint(outputPath);
  } finally {
    // Clean up temp files
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
