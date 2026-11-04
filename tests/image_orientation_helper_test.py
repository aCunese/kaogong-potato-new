"""Behavioral boundaries for the native helper, alongside real OCR tests."""
import importlib.util
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from PIL import Image

spec = importlib.util.spec_from_file_location('image_orientation', Path(__file__).resolve().parents[1] / 'scripts/lib/image-orientation.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class OrientationBoundaryTests(unittest.TestCase):
    def test_osd_accepts_only_valid_quarter_turns_at_fifteen_confidence(self):
        self.assertEqual(helper.osd_rotation('Rotate: 270\nOrientation confidence: 15.00\n'), 270)
        self.assertEqual(helper.osd_rotation('Rotate: 0\nOrientation confidence: 16.00\n'), 0)
        self.assertIsNone(helper.osd_rotation('Rotate: 90\nOrientation confidence: 14.99\n'))
        self.assertIsNone(helper.osd_rotation('Rotate: 45\nOrientation confidence: 50.00\n'))

    def test_tsv_weights_effective_characters_and_excludes_punctuation_and_invalid_confidence(self):
        tsv = 'level\tconf\ttext\n5\t80\t学习能力\n5\t20\tab\n5\t99\t，。!\n4\t90\tignored\n5\t-1\tbad\n5\tnan\tnan\n'
        self.assertEqual(helper.weighted_confidence(tsv), (60.0, 6))

    def test_confidence_lead_and_character_thresholds_all_must_pass(self):
        self.assertEqual(helper.select_rotation([(90, 45, 12), (0, 35, 20), (180, 10, 8), (270, 0, 0)]), {'status': 'resolved', 'rotation': 90, 'version': 1})
        for score, lead, count in [(44.99, 15, 20), (80, 9.99, 20), (80, 15, 11)]:
            self.assertEqual(helper.select_rotation([(180, score, count), (0, score-lead, 20), (90, 0, 0), (270, 0, 0)]), {'status': 'unresolved', 'rotation': 0, 'version': 1})

    def test_normalizes_exif_and_thumbnails_before_ocr_without_overwriting_source(self):
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / 'rotated.jpg'
            image = Image.new('RGB', (2000, 1000), 'white')
            exif = Image.Exif(); exif[274] = 6
            image.save(image_path, exif=exif)
            original = image_path.read_bytes()
            def native(candidate, *arguments):
                with Image.open(candidate) as normalized:
                    self.assertEqual(normalized.size, (800, 1600))
                    self.assertNotIn(274, normalized.getexif())
                return SimpleNamespace(returncode=0, stdout='Rotate: 0\nOrientation confidence: 16.00\n')
            with patch.object(helper, 'run_tesseract', native):
                self.assertEqual(helper.orient(image_path), {'status': 'resolved', 'rotation': 0, 'version': 1})
            self.assertEqual(image_path.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
