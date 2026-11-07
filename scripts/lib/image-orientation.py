#!/usr/bin/env python3
"""Read an owned image, EXIF-normalize it, and emit a conservative correction.

The Node supervisor owns the deadline and kills this entire process group,
including native Tesseract children. Source images are always opened read-only.
"""
import csv
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import warnings

from PIL import Image, ImageOps

VERSION = 1
QUARTER_TURNS = (0, 90, 180, 270)
Image.MAX_IMAGE_PIXELS = 25_000_000
warnings.simplefilter('error', Image.DecompressionBombWarning)


def osd_rotation(output):
    rotate = re.search(r'^Rotate:\s*(0|90|180|270)\s*$', output, re.MULTILINE)
    confidence = re.search(r'^Orientation confidence:\s*([0-9.]+)', output, re.MULTILINE)
    if rotate and confidence and float(confidence.group(1)) >= 15:
        return int(rotate.group(1))
    return None


def weighted_confidence(tsv, minimum_confidence=0):
    count = 0
    weighted = 0.0
    for row in csv.DictReader(io.StringIO(tsv), delimiter='\t', quoting=csv.QUOTE_NONE):
        if row.get('level') != '5':
            continue
        chars = sum(char.isalnum() for char in (row.get('text') or ''))
        try:
            confidence = float(row.get('conf', '-1'))
        except (ValueError, TypeError):
            continue
        if chars and minimum_confidence <= confidence <= 100:
            count += chars
            weighted += confidence * chars
    return (weighted / count if count else 0.0), count


def select_rotation(candidates):
    # Each candidate has its own effective-character count; punctuation does not
    # make a short or uncertain image look like a substantial OCR sample.
    ordered = sorted(candidates, key=lambda candidate: candidate[1], reverse=True)
    rotation, confidence, chars, trusted_chars = ordered[0]
    # Sparse diagrams can create many moderately confident OCR guesses. Require
    # enough clearly recognized text as well as the overall score and lead.
    if chars >= 12 and trusted_chars >= 12 and confidence >= 45 and confidence - ordered[1][1] >= 10:
        return {'status': 'resolved', 'rotation': rotation, 'version': VERSION}
    return {'status': 'unresolved', 'rotation': 0, 'version': VERSION}


def run_tesseract(filename, *arguments):
    result = subprocess.run(
        [os.environ.get('TESSERACT_BIN', 'tesseract'), str(filename), 'stdout', *arguments],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        env={**os.environ, 'OMP_THREAD_LIMIT': '1'}, timeout=28,
    )
    return result


def orient(filename):
    with Image.open(filename) as original:
        image = ImageOps.exif_transpose(original)
        image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
            rgba = image.convert('RGBA')
            image = Image.new('RGB', rgba.size, 'white')
            image.paste(rgba, mask=rgba.getchannel('A'))
        else:
            image = image.convert('RGB')
    with tempfile.TemporaryDirectory(prefix='potato-orientation-') as directory:
        normalized = Path(directory) / 'normalized.png'
        image.save(normalized)
        osd = run_tesseract(normalized, '-l', 'osd', '--psm', '0')
        correction = osd_rotation(osd.stdout) if osd.returncode == 0 else None
        if correction is not None:
            return {'status': 'resolved', 'rotation': correction, 'version': VERSION}
        # Chinese questions mix short text lines, diagrams and annotations.
        # Sparse segmentation avoids forcing shapes into a paragraph; recognize
        # Chinese first so English guesses for shapes do not obscure the text.
        for language in ('chi_sim', 'chi_sim+eng'):
            candidates = []
            for rotation in QUARTER_TURNS:
                candidate = Path(directory) / f'{rotation}.png'
                if not candidate.exists():
                    image.rotate(-rotation, expand=True).save(candidate)
                result = run_tesseract(candidate, '-l', language, '--psm', '11', 'tsv')
                if result.returncode != 0:
                    raise RuntimeError('Native OCR unavailable')
                confidence, count = weighted_confidence(result.stdout, 35)
                _, trusted_count = weighted_confidence(result.stdout, 60)
                candidates.append((rotation, confidence, count, trusted_count))
            result = select_rotation(candidates)
            if result['status'] == 'resolved':
                return result
        return result


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Expected one owned image')
        print(json.dumps(orient(sys.argv[1]), separators=(',', ':')))
    except Exception:
        # Never echo paths, native stderr, image content or private metadata.
        print('Image orientation unavailable', file=sys.stderr)
        sys.exit(1)
