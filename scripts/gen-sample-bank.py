#!/usr/bin/env python3
"""gen-sample-bank.py — THE ACOUSTIC NOTE-AUDITIONING SOUND BANK (v37 item 3).

WHAT IT DOES. Downloads one documented, licence-cleared ACOUSTIC sample set per
instrument from the public sources listed in SOURCES below, then renders the
bank the app actually ships: `assets/tones/<instrument>/m<midi>.wav` for every
semitone the editor can set (midi 36..96 — the same range the old synthesized
bank covered, see src/services/toneBank.ts).

WHY A GENERATOR. The bank is 5 instruments x 61 semitones = 305 one-shot files.
Shipping those by hand is unreviewable, and the provenance of every file has to
be provable (copyright gate: CC0 / CC-BY only, no GPL, no NC). This script is
that proof: it re-derives every shipped file from a named URL, and it writes
`assets/tones/SAMPLES-LICENSES.md` (source + licence + attribution + the exact
derivation) next to the samples.

HOW A NOTE IS MADE (semitone-matched, no runtime pitch shifting):
  * each instrument ships a handful of SOURCE notes spread over its range;
  * for every target semitone we take the NEAREST source and play it back at
    `ratio = 2 ** (target - source)/12` — the standard sampler one-shot shift
    (`asetrate` = "pretend this file was recorded at SR*ratio", then resample).
    The rendered file is therefore ALREADY at the target pitch: the app needs no
    playback-rate support, and the pitch cannot drift at runtime.
  * every file is mono, 16 kHz, ~0.6 s with a short fade-out, peak-normalized to
    about -3 dBFS (`max_volume` measured per SOURCE, so one instrument's notes
    keep their relative loudness).

REQUIRES: ffmpeg + ffprobe on PATH (or FFMPEG=/path/to/ffmpeg) and network.
RUN: python3 scripts/gen-sample-bank.py            (from the repo root)
     --check  verifies an existing bank without downloading anything.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TONES_DIR = os.path.join(REPO, 'assets', 'tones')
BANK_TS = os.path.join(REPO, 'src', 'services', 'toneBank.ts')
WORK = os.environ.get('SAMPLEBANK_WORK', '/tmp/engv37/samplebank')

MIDI_MIN, MIDI_MAX = 36, 96          # the editor's pitch range (C2..C7)
RATE = 16000                          # output sample rate (mono)
LENGTH = 0.62                         # seconds of each rendered one-shot
FADE = 0.17                           # seconds of fade-out at the end
PEAK_DB = -3.0                        # target peak per instrument

# ---------------------------------------------------------------------------
# SOURCES — every one of these is CC0 1.0 or CC-BY 4.0. Nothing else is used.
# `notes` maps MIDI note number -> remote path (relative to `base`).
# ---------------------------------------------------------------------------
VSCO = ('VSCO 2 Community Edition (Versilian Studios LLC)', 'CC0 1.0',
        'https://github.com/sgossner/VSCO-2-CE',
        'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/')

SOURCES = {
    'piano': {
        'name': 'Upright Nr1 (VSCO 2 CE)',
        'base': VSCO[3],
        'licence': 'CC0 1.0 (public domain dedication)',
        'credit': 'VSCO 2 Community Edition — Upright Nr1, Sum, by Versilian Studios LLC',
        'repo': VSCO[2],
        'files': {
            36: 'Keys/Upright%20Nr1/UR1_C2_mf_RR1.wav',
            48: 'Keys/Upright%20Nr1/UR1_C3_mf_RR1.wav',
            60: 'Keys/Upright%20Nr1/UR1_C4_mf_RR1.wav',
            72: 'Keys/Upright%20Nr1/UR1_C5_mf_RR1.wav',
            84: 'Keys/Upright%20Nr1/UR1_C6_mf_RR1.wav',
        },
    },
    'guitar': {
        'name': 'Shinyguitar — acoustic (Karoryfer)',
        'base': 'https://raw.githubusercontent.com/sfzinstruments/karoryfer.shinyguitar/HEAD/',
        'licence': 'CC0 1.0 (public domain dedication)',
        'credit': 'Shinyguitar acoustic samples by Karoryfer Samples (D. Smolken)',
        'repo': 'https://github.com/sfzinstruments/karoryfer.shinyguitar',
        'files': {
            37: 'Samples/acoustic/db2_vl3_rr1_1.wav',
            40: 'Samples/acoustic/e2_vl3_rr1_1.wav',
            45: 'Samples/acoustic/a2_vl3_rr1_1.wav',
            48: 'Samples/acoustic/c3_vl3_rr1_1.wav',
            52: 'Samples/acoustic/eb3_vl3_rr1_1.wav',
            57: 'Samples/acoustic/a3_vl3_rr1_1.wav',
            60: 'Samples/acoustic/c4_vl3_rr1_1.wav',
            64: 'Samples/acoustic/eb4_vl3_rr1_1.wav',
            69: 'Samples/acoustic/a4_vl3_rr1_1.wav',
            72: 'Samples/acoustic/c5_vl3_rr1_1.wav',
            76: 'Samples/acoustic/eb5_vl3_rr1_1.wav',
            81: 'Samples/acoustic/a5_vl3_rr1_1.wav',
        },
    },
    'trumpet': {
        'name': 'Trumpet sustain (VSCO 2 CE)',
        'base': VSCO[3],
        'licence': 'CC0 1.0 (public domain dedication)',
        'credit': 'VSCO 2 Community Edition — Trumpet, sustained (Sum), by Versilian Studios LLC',
        'repo': VSCO[2],
        'files': {
            41: 'Brass/Trumpet/sus/Sum_SHTrumpet_sus_F2_v3_rr1.wav',
            48: 'Brass/Trumpet/sus/Sum_SHTrumpet_sus_C3_v3_rr1.wav',
            55: 'Brass/Trumpet/sus/Sum_SHTrumpet_sus_G3_v3_rr1.wav',
            62: 'Brass/Trumpet/sus/Sum_SHTrumpet_sus_D4_v3_rr1.wav',
            69: 'Brass/Trumpet/sus/Sum_SHTrumpet_sus_A4_v3_rr1.wav',
            76: 'Brass/Trumpet/sus/Sum_SHTrumpet_sus_C5_v3_rr1.wav',
        },
    },
    'harp': {
        'name': 'Concert harp (VSCO 2 CE)',
        'base': VSCO[3],
        'licence': 'CC0 1.0 (public domain dedication)',
        'credit': 'VSCO 2 Community Edition — Harp (KSHarp), by Versilian Studios LLC',
        'repo': VSCO[2],
        'files': {
            38: 'Strings/Harp/KSHarp_D2_mf.wav',
            45: 'Strings/Harp/KSHarp_A2_mf.wav',
            52: 'Strings/Harp/KSHarp_E3_mf.wav',
            59: 'Strings/Harp/KSHarp_B3_mf.wav',
            65: 'Strings/Harp/KSHarp_F4_mf.wav',
            72: 'Strings/Harp/KSHarp_C5_mf.wav',
            79: 'Strings/Harp/KSHarp_G5_mf.wav',
            86: 'Strings/Harp/KSHarp_D6_mf.wav',
            95: 'Strings/Harp/KSHarp_B6_mf.wav',
        },
    },
    # ALTO SAX — MTG Solo Saxophones. The samples are FLAC; ffmpeg decodes them.
    # The pitch of every sample comes from the dataset's own region map
    # (Data/alt_f_rr1.txt: `key=<midi> sample=alt_f_<nn>.flac`), which this
    # script parses — no guessing which file is which note.
    'sax': {
        'name': 'Alto saxophone (MTG Solo Saxophones)',
        'base': 'https://raw.githubusercontent.com/sfzinstruments/MTG.SoloSax/HEAD/',
        'licence': 'CC BY 4.0',
        'credit': ('MTG Solo Saxophones — alto, dynamic f — Music Technology Group, '
                   'Universitat Pompeu Fabra (Barcelona)'),
        'repo': 'https://github.com/sfzinstruments/MTG.SoloSax',
        'map': 'MTG%20Solo%20Saxophones/Data/alt_f_rr1.txt',
        'map_dir': 'MTG%20Solo%20Saxophones/Samples/',
        # targets are picked from the map: the entry nearest each of these keys
        'targets': [52, 58, 64, 70, 76],
    },
}

INSTRUMENT_ORDER = ['piano', 'guitar', 'sax', 'trumpet', 'harp']

BANK_HEADER = """/**
 * toneBank.ts — THE PREVIEW'S SOUND BANK (v33 slice G, REBUILT ACOUSTIC in v37).
 *
 * GENERATED by scripts/gen-sample-bank.py — do not edit by hand; re-run that
 * script instead. Every file it points at is a CC0 / CC-BY ACOUSTIC sample from
 * a named public source, resampled one-shot per semitone; the source URL, the
 * licence and the attribution for each are in assets/tones/SAMPLES-LICENSES.md
 * (written by the same script).
 *
 * One file per semitone, per instrument, midi {lo}..{hi}: the editor's whole
 * pitch clamp, so every note a user can set has a tone to hear, and the pitch is
 * baked into the file — nothing is pitch-shifted at playback time.
 */
import type { PreviewInstrumentId } from './takePreview';

declare const require: (name: string) => number;

/** The lowest/highest semitone the bank really holds. */
export const TONE_MIN_MIDI = {lo};
export const TONE_MAX_MIDI = {hi};

"""


def ffmpeg() -> str:
    return os.environ.get('FFMPEG', 'ffmpeg')


def ffprobe() -> str:
    return os.environ.get('FFPROBE', 'ffprobe')


def run(cmd: list[str], quiet: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=False, capture_output=True, text=True)


def download(url: str, dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return
    req = urllib.request.Request(url, headers={'User-Agent': 'notesnap-sample-bank/1.0'})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, 'wb') as out:
        shutil.copyfileobj(resp, out)
    if os.path.getsize(dest) < 1000:
        raise RuntimeError(f'short download: {url}')


def probe_rate(path: str) -> int:
    out = run([ffprobe(), '-v', 'error', '-select_streams', 'a:0', '-show_entries',
               'stream=sample_rate', '-of', 'json', path]).stdout
    return int(json.loads(out)['streams'][0]['sample_rate'])


def peak_db(path: str) -> float:
    out = run([ffmpeg(), '-hide_banner', '-i', path, '-af', 'volumedetect',
               '-f', 'null', '-']).stderr
    m = re.search(r'max_volume:\s*(-?[\d.]+) dB', out)
    return float(m.group(1)) if m else -3.0


def render(src: str, sr: int, ratio: float, gain_db: float, dest: str) -> None:
    """One sampler-style one-shot: shift by `ratio`, mono, RATE, trimmed+faded."""
    chain = ','.join([
        f'asetrate={int(round(sr * ratio))}',
        f'aresample={RATE}',
        f'atrim=0:{LENGTH}',
        f'afade=t=out:st={round(max(0.0, LENGTH - FADE), 3)}:d={FADE}',
        f'volume={round(gain_db, 2)}dB',
    ])
    res = run([ffmpeg(), '-y', '-v', 'error', '-i', src, '-af', chain,
               '-ar', str(RATE), '-ac', '1', '-c:a', 'pcm_s16le', dest])
    if res.returncode != 0 or not os.path.exists(dest) or os.path.getsize(dest) < 1000:
        raise RuntimeError(f'render failed for {dest}: {res.stderr[:400]}')


def sax_sources(spec: dict, work: str) -> dict[int, str]:
    """Parse the dataset's own region map so every sax sample has a known pitch."""
    mapping = os.path.join(work, 'src', 'sax_map.txt')
    download(spec['base'] + spec['map'], mapping)
    table: dict[int, str] = {}
    for line in open(mapping, encoding='utf-8', errors='replace'):
        m = re.search(r'key=(\d+).*?sample=(\S+?)\.\$EXT', line)
        if m:
            table[int(m.group(1))] = spec['map_dir'] + m.group(2) + '.flac'
    if len(table) < 12:
        raise RuntimeError('sax region map did not parse')
    picked: dict[int, str] = {}
    for target in spec['targets']:
        key = min(table, key=lambda k: abs(k - target))
        picked[key] = table[key]
    return picked


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == '--check':
        return check()
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(TONES_DIR, exist_ok=True)
    # The old synthesized dirs are fully replaced by the acoustic bank
    # (`strings` is no longer an instrument the preview offers).
    for stale in ('strings',):
        shutil.rmtree(os.path.join(TONES_DIR, stale), ignore_errors=True)

    attribution: list[str] = []
    for instrument in INSTRUMENT_ORDER:
        spec = SOURCES[instrument]
        files = spec.get('files') or sax_sources(spec, WORK)
        out_dir = os.path.join(TONES_DIR, instrument)
        os.makedirs(out_dir, exist_ok=True)
        print(f'== {instrument} ({spec["name"]}) — {len(files)} source notes')

        local: dict[int, str] = {}
        gains: dict[int, float] = {}
        rates: dict[int, int] = {}
        urls: dict[int, str] = {}
        for midi, rel in sorted(files.items()):
            ext = os.path.splitext(rel)[1]
            dest = os.path.join(WORK, 'src', f'{instrument}_{midi}{ext}')
            url = spec['base'] + rel
            download(url, dest)
            local[midi] = dest
            urls[midi] = url
            rates[midi] = probe_rate(dest)
            gains[midi] = PEAK_DB - peak_db(dest)

        written = 0
        total = 0
        for target in range(MIDI_MIN, MIDI_MAX + 1):
            near = min(local, key=lambda k: abs(k - target))
            ratio = 2.0 ** ((target - near) / 12.0)
            dest = os.path.join(out_dir, f'm{target}.wav')
            render(local[near], rates[near], ratio, gains[near], dest)
            total += os.path.getsize(dest)
            written += 1
        print(f'   wrote {written} files, {total / 1024:.0f} KiB, '
              f'sources: {", ".join(f"m{k}({v})" for k, v in sorted(urls.items()))}')

        attribution.append(
            f'### {instrument} — {spec["name"]}\n\n'
            f'- **Licence:** {spec["licence"]}\n'
            f'- **Credit / attribution:** {spec["credit"]}\n'
            f'- **Source repository:** {spec["repo"]}\n'
            f'- **Shipped as:** `assets/tones/{instrument}/m36.wav` … '
            f'`assets/tones/{instrument}/m96.wav` (61 files)\n'
            f'- **Source files downloaded (one per line, note = source pitch):**\n'
            + ''.join(f'  - midi {k} → `{urls[k]}`\n' for k in sorted(urls))
        )
        write_bank_ts()
    write_licences(attribution)
    print('DONE')
    return 0


def bank_body() -> str:
    # NB: BANK_HEADER is a TS doc comment full of `{...}` — substitute by hand
    # (str.format would treat those braces as fields).
    body = [BANK_HEADER.replace('{lo}', str(MIDI_MIN)).replace('{hi}', str(MIDI_MAX))]
    for instrument in INSTRUMENT_ORDER:
        const = instrument.upper()
        body.append(f'const {const}: Record<number, number> = {{\n')
        for midi in range(MIDI_MIN, MIDI_MAX + 1):
            body.append(f"  {midi}: require('../../assets/tones/{instrument}/m{midi}.wav'),\n")
        body.append('};\n\n')
    body.append('const BANK: Record<PreviewInstrumentId, Record<number, number>> = {\n')
    for instrument in INSTRUMENT_ORDER:
        body.append(f'  {instrument}: {instrument.upper()},\n')
    body.append('};\n\n')
    body.append(
        "/** The instrument ids the bank really covers (the preview lists these). */\n"
        "export const TONE_BANK_INSTRUMENTS: readonly PreviewInstrumentId[] = [\n"
        + ''.join(f"  '{i}',\n" for i in INSTRUMENT_ORDER)
        + '];\n\n'
        '/**\n'
        ' * The module id of one tone, or null when the bank has nothing for it.\n'
        ' * The range covers the editor\'s own pitch clamp, so null is a real bug, not a\n'
        ' * silent note: the caller says so instead of playing the wrong pitch.\n'
        ' */\n'
        'export function toneSourceFor(\n'
        '  instrument: PreviewInstrumentId | string | null | undefined,\n'
        '  midi: number,\n'
        '): number | null {\n'
        '  const table = BANK[instrument as PreviewInstrumentId] ?? BANK.piano;\n'
        '  const value = Math.round(Number(midi));\n'
        '  if (!Number.isFinite(value)) return null;\n'
        '  return table[value] ?? null;\n'
        '}\n'
    )
    return ''.join(body)


def write_bank_ts() -> None:
    with open(BANK_TS, 'w', encoding='utf-8') as fh:
        fh.write(bank_body())


def write_licences(attribution: list[str]) -> None:
    text = (
        '# Sound-bank sample licences (v37 item 3)\n\n'
        'Every sample NoteSnap ships in `assets/tones/` is generated by\n'
        '`scripts/gen-sample-bank.py` from the sources below. **Licences are CC0 1.0 or\n'
        'CC BY 4.0 only** — no GPL, no non-commercial, no unclear terms. Each shipped\n'
        'file is a mono 16 kHz one-shot rendered from the named source at the pitch of\n'
        'its own filename (`m<midi>.wav`), so the provenance of every byte is traceable\n'
        'to a URL on this page.\n\n'
        + '\n'.join(attribution) +
        '\n---\n\n'
        'CC0 1.0: <https://creativecommons.org/publicdomain/zero/1.0/>\n\n'
        'CC BY 4.0: <https://creativecommons.org/licenses/by/4.0/>\n\n'
        'Attribution (required by CC BY 4.0) is carried in this file and in the app\'s\n'
        'About/credits surface; CC0 sources are credited here as good practice.\n'
    )
    with open(os.path.join(TONES_DIR, 'SAMPLES-LICENSES.md'), 'w', encoding='utf-8') as fh:
        fh.write(text)


def check() -> int:
    """Verify a built bank without touching the network."""
    bad = 0
    for instrument in INSTRUMENT_ORDER:
        missing = [
            m for m in range(MIDI_MIN, MIDI_MAX + 1)
            if not os.path.exists(os.path.join(TONES_DIR, instrument, f'm{m}.wav'))
        ]
        size = sum(os.path.getsize(os.path.join(TONES_DIR, instrument, f'm{m}.wav'))
                   for m in range(MIDI_MIN, MIDI_MAX + 1)
                   if os.path.exists(os.path.join(TONES_DIR, instrument, f'm{m}.wav')))
        print(f'{instrument}: {61 - len(missing)}/61 files, {size / 1024:.0f} KiB')
        bad += len(missing)
    print('MISSING' if bad else 'OK')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
