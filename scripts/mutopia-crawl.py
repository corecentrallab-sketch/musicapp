#!/usr/bin/env python3
"""Crawl Mutopia for MIDI files and download them."""
import urllib.request
import urllib.error
import re
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://www.mutopiaproject.org/ftp"
OUT = "/home/team/shared/mutopia-data/fresh5"
os.makedirs(OUT, exist_ok=True)

COMPOSERS = [
    "BachJS", "BeethovenLv", "MozartWA", "ChopinFF", "SchubertF",
    "BrahmsJ", "DebussyC", "LisztF", "HandelGF", "SchumannR",
    "HaydnFJ", "MendelssohnF", "TchaikovskyPI", "GriegE", "VivaldiA",
]

def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except Exception:
        return None

def parse_hrefs(html):
    dirs, files = [], []
    for m in re.finditer(r'href="([^"]+)"', html or ''):
        href = m.group(1)
        if href in ('../', '/ftp/', '/') or href.startswith('?'):
            continue
        if href.endswith('/'):
            dirs.append(href.rstrip('/'))
        else:
            files.append(href)
    return dirs, files

midi_urls = []

print("=== Phase 1: Discover MIDI URLs ===")
for comp in COMPOSERS:
    print(f"  {comp}...", end='', flush=True)
    html = fetch(f"{BASE}/{comp}/")
    if not html:
        print(" FAIL")
        continue
    dirs, _ = parse_hrefs(html)
    found = 0
    
    # Fetch piece directories (up to 40)
    piece_urls = [f"{BASE}/{comp}/{d}/" for d in dirs[:40]]
    
    def check_piece(piece_url):
        results = []
        ph = fetch(piece_url)
        if not ph:
            return results
        subdirs, files = parse_hrefs(ph)
        
        # MIDI at this level
        for f in files:
            if f.lower().endswith(('.mid', '.midi')):
                dest = piece_url.replace(BASE + '/', '').replace('/', os.sep)
                results.append((piece_url + f, os.path.join(OUT, dest, f)))
        
        # Check subdirectories
        for sd in subdirs[:5]:
            sd_url = f"{piece_url}{sd}/"
            sh = fetch(sd_url)
            if not sh:
                continue
            _, sfiles = parse_hrefs(sh)
            for f in sfiles:
                if f.lower().endswith(('.mid', '.midi')):
                    dest = sd_url.replace(BASE + '/', '').replace('/', os.sep)
                    results.append((sd_url + f, os.path.join(OUT, dest, f)))
        return results
    
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(check_piece, pu): pu for pu in piece_urls}
        for future in as_completed(futures):
            for url, dest in future.result():
                midi_urls.append((url, dest))
                found += 1
    
    print(f" {found} MIDIs (total: {len(midi_urls)})")

print(f"\nTotal MIDI files discovered: {len(midi_urls)}")

# Write URL list
with open("/tmp/midi-urls-py.txt", "w") as f:
    for url, dest in midi_urls:
        f.write(f"{url}|{dest}\n")

print("\n=== Phase 2: Download ===")
new, had, fail = 0, 0, 0

def download(args):
    url, dest = args
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        return 'had'
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        urllib.request.urlretrieve(url, dest)
        if os.path.isfile(dest) and os.path.getsize(dest) > 0:
            return 'new'
    except Exception:
        pass
    return 'fail'

with ThreadPoolExecutor(max_workers=15) as ex:
    futures = {ex.submit(download, args): args for args in midi_urls}
    for i, future in enumerate(as_completed(futures)):
        result = future.result()
        if result == 'new': new += 1
        elif result == 'had': had += 1
        else: fail += 1
        if (i + 1) % 50 == 0 or i == len(midi_urls) - 1:
            print(f"  [{i+1}/{len(midi_urls)}] new:{new} had:{had} fail:{fail}", flush=True)

print(f"\nDone! new:{new} had:{had} fail:{fail}")
print(f"Files on disk: {sum(1 for _ in os.walk(OUT) for f in _[2] if f.endswith(('.mid','.midi')))}")
