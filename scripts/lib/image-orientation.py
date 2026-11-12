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


def candidate_evidence(candidate):
    # candidate: (rotation, confidence, chars, trusted_chars)
    rotation, confidence, chars, trusted_chars = candidate
    factor = min(1.0, chars / 12.0) * min(1.0, trusted_chars / 12.0)
    return (confidence * factor, trusted_chars, chars)


def select_rotation(candidates):
    # Each candidate has its own effective-character count; punctuation does not
    # make a short or uncertain image look like a substantial OCR sample.
    ordered = sorted(candidates, key=candidate_evidence, reverse=True)
    rotation, confidence, chars, trusted_chars = ordered[0]
    runner_conf = candidate_evidence(ordered[1])[0] if len(ordered) > 1 else 0.0
    lead = confidence - runner_conf
    has_text = chars >= 12 and trusted_chars >= 12 and confidence >= 45
    # Standard resolution: clear confidence lead
    if has_text and lead >= 10:
        return {'status': 'resolved', 'rotation': rotation, 'version': VERSION}
    # Diagram-question optimization: geometric diagram lines can produce noisy OCR guesses
    # in orthogonal orientations that compress the average-confidence margin. When the
    # candidate has moderate confidence lead (>= 5) AND substantially more reliable
    # text evidence than all runners-up, it is safely resolved.
    runner_chars = max(candidate[2] for candidate in ordered[1:]) if len(ordered) > 1 else 0
    runner_trusted = max(candidate[3] for candidate in ordered[1:]) if len(ordered) > 1 else 0
    if (has_text and lead >= 5 and
            chars >= runner_chars + 8 and
            trusted_chars >= runner_trusted + 5):
        return {'status': 'resolved', 'rotation': rotation, 'version': VERSION}
    return {'status': 'unresolved', 'rotation': 0, 'version': VERSION}


def run_tesseract(filename, *arguments):
    result = subprocess.run(
        [os.environ.get('TESSERACT_BIN', 'tesseract'), str(filename), 'stdout', '--dpi', '150', *arguments],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        encoding='utf-8', errors='replace',
        env={**os.environ, 'OMP_THREAD_LIMIT': '1'}, timeout=28,
    )
    return result


def orient(filename):
    with Image.open(filename) as original:
        image = ImageOps.exif_transpose(original)
        w, h = image.size
        # 长图切片保护：长宽比超过 2.5 的长截图，缩放时会严重压缩文字导致 OCR 漏检或变慢。
        # 截取顶部具有代表性的题目切片研判方向。
        if h > w * 2.5:
            image = image.crop((0, 0, w, int(w * 2.2)))
        elif w > h * 2.5:
            image = image.crop((0, 0, int(h * 2.2), h))
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

        # OSD 排序剪枝：提取方向倾向与置信度，优先评估倾向角度并在高可信证据下提早剪枝
        osd_hint_match = re.search(r'^Rotate:\s*(0|90|180|270)\s*$', osd.stdout, re.MULTILINE) if osd.returncode == 0 else None
        osd_conf_match = re.search(r'^Orientation confidence:\s*([0-9.]+)', osd.stdout, re.MULTILINE) if osd.returncode == 0 else None
        osd_hint_rot = int(osd_hint_match.group(1)) if osd_hint_match else None
        osd_hint_conf = float(osd_conf_match.group(1)) if osd_conf_match else 0.0

        rotation_order = (
            [osd_hint_rot] + [r for r in QUARTER_TURNS if r != osd_hint_rot]
            if osd_hint_rot is not None
            else list(QUARTER_TURNS)
        )

        # Chinese questions mix short text lines, diagrams and annotations.
        # Sparse segmentation avoids forcing shapes into a paragraph; recognize
        # Chinese first so English guesses for shapes do not obscure the text.
        # If sparse segmentation fails to resolve due to diagram noise, fallback to uniform text block (PSM 6).
        for psm in ('11', '6'):
            for language in ('chi_sim', 'chi_sim+eng'):
                candidates = []
                for idx, rotation in enumerate(rotation_order):
                    candidate = Path(directory) / f'{rotation}.png'
                    if not candidate.exists():
                        image.rotate(-rotation, expand=True).save(candidate)
                    result = run_tesseract(candidate, '-l', language, '--psm', psm, 'tsv')
                    if result.returncode != 0:
                        raise RuntimeError('Native OCR unavailable')
                    confidence, count = weighted_confidence(result.stdout, 35)
                    _, trusted_count = weighted_confidence(result.stdout, 60)
                    candidates.append((rotation, confidence, count, trusted_count))

                    # 剪枝：当 OSD 倾向角度经 OCR 证实具备充足文字与高置信度时，无须执行其余方向
                    if (idx == 0 and osd_hint_rot is not None and rotation == osd_hint_rot and
                            osd_hint_conf >= 8.0 and confidence >= 75.0 and count >= 25 and trusted_count >= 20):
                        for remaining_rot in rotation_order[1:]:
                            candidates.append((remaining_rot, 0.0, 0, 0))
                        break

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
