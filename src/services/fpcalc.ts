import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import decode from "audio-decode";

const execFileAsync = promisify(execFile);

// Both assets are copied beside the bundled server entry by build-vercel.sh.
// Keeping this relative is required: /usr/bin and PATH do not contain them on Vercel.
const FUNCTION_DIR = dirname(fileURLToPath(import.meta.url));
const FPCMD = join(FUNCTION_DIR, "fpcalc");

/** Run fpcalc and return its raw 32-bit integer fingerprint. */
export async function generateFingerprint(
  audioPath: string,
): Promise<{ fingerprint: number[]; duration: number }> {
  const { stdout, stderr } = await execFileAsync(FPCMD, [
    "-raw",
    "-length",
    "120",
    audioPath,
  ]);

  if (stderr) console.warn("[fpcalc] stderr:", stderr);
  const output = stdout.trim();
  if (!output) throw new Error("fpcalc produced no output — audio may be too short or silent");

  let duration = 0;
  let fingerprintRaw = "";
  for (const line of output.split("\n")) {
    if (line.startsWith("DURATION=")) duration = parseFloat(line.substring(9));
    else if (line.startsWith("FINGERPRINT=")) fingerprintRaw = line.substring(12);
  }
  if (!fingerprintRaw) throw new Error("fpcalc output missing FINGERPRINT line");

  const fingerprint = fingerprintRaw.trim().split(/\s+/)
    .map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  if (fingerprint.length === 0) throw new Error("fpcalc produced empty fingerprint");
  return { fingerprint, duration };
}

/** Encode interleaved signed 16-bit PCM as a canonical little-endian WAV. */
function pcmToWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const wav = Buffer.allocUnsafe(44 + dataSize);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    wav.writeInt16LE(value < 0 ? value * 32768 : value * 32767, 44 + i * 2);
  }
  return wav;
}

/** Decode any supported upload, resample/mix to 16kHz mono in JS, then fpcalc it. */
export async function fingerprintFromBuffer(
  audioBuffer: Buffer,
): Promise<{ fingerprint: number[]; duration: number }> {
  const decoded = await decode(audioBuffer);
  const channels = decoded.channelData;
  const sourceRate = decoded.sampleRate;
  const sourceLength = channels[0]?.length ?? 0;
  if (!sourceLength) throw new Error("audio contains no samples");

  const outputLength = Math.max(1, Math.round(sourceLength * 16000 / sourceRate));
  const mono = new Float32Array(outputLength);
  // Linear interpolation while averaging channels avoids a native transcoder.
  for (let i = 0; i < outputLength; i++) {
    const position = i * sourceRate / 16000;
    const left = Math.floor(position);
    const fraction = position - left;
    let value = 0;
    for (const channel of channels) {
      const a = channel[Math.min(left, channel.length - 1)] ?? 0;
      const b = channel[Math.min(left + 1, channel.length - 1)] ?? a;
      value += a + (b - a) * fraction;
    }
    mono[i] = value / channels.length;
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "notesnap-fp-"));
  const outputPath = join(tmpDir, "output.wav");
  try {
    await writeFile(outputPath, pcmToWav(mono, 16000));
    return await generateFingerprint(outputPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
