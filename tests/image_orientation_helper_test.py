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

    def test_weighted_confidence_filters_noise_under_threshold(self):
        tsv = 'level\tconf\ttext\n5\t80\t题目文字\n5\t15\t图图图\n'
        self.assertEqual(helper.weighted_confidence(tsv, 35), (80.0, 4))

    def test_confidence_lead_and_character_thresholds_all_must_pass(self):
        self.assertEqual(helper.select_rotation([]), {'status': 'unresolved', 'rotation': 0, 'version': 1})
        self.assertEqual(helper.select_rotation([(90, 45, 12, 12), (0, 35, 20, 12), (180, 10, 8, 0), (270, 0, 0, 0)]), {'status': 'resolved', 'rotation': 90, 'version': 1})
        for score, lead, count in [(44.99, 15, 20), (80, 9.99, 20), (80, 15, 11)]:
            self.assertEqual(helper.select_rotation([(180, score, count, count), (0, score-lead, 20, 12), (90, 0, 0, 0), (270, 0, 0, 0)]), {'status': 'unresolved', 'rotation': 0, 'version': 1})

    def test_moderate_confidence_diagram_guesses_do_not_supply_the_required_text_evidence(self):
        for trusted_chars in [0, 11]:
            self.assertEqual(helper.select_rotation([(180, 55, 30, trusted_chars), (0, 35, 20, 2), (90, 0, 0, 0), (270, 0, 0, 0)]), {'status': 'unresolved', 'rotation': 0, 'version': 1})
        self.assertEqual(helper.select_rotation([(180, 55, 30, 12), (0, 35, 20, 2), (90, 0, 0, 0), (270, 0, 0, 0)]), {'status': 'resolved', 'rotation': 180, 'version': 1})

    def test_diagram_question_with_substantial_reliable_text_lead_resolves_with_moderate_confidence_margin(self):
        # 34 chars, 21 trusted vs runner-up 21 chars, 14 trusted with lead 5.9 (real diagram question case)
        self.assertEqual(
            helper.select_rotation([(0, 72.2, 34, 21), (90, 66.3, 21, 14), (270, 61.5, 22, 13), (180, 59.6, 19, 6)]),
            {'status': 'resolved', 'rotation': 0, 'version': 1}
        )
        # Moderate lead (5.9) without sufficient text difference remains unresolved
        self.assertEqual(
            helper.select_rotation([(0, 72.2, 22, 14), (90, 66.3, 21, 14), (270, 61.5, 22, 13), (180, 59.6, 19, 6)]),
            {'status': 'unresolved', 'rotation': 0, 'version': 1}
        )
        # Moderate lead where 2nd place has few chars but 3rd place has high chars must NOT falsely resolve
        self.assertEqual(
            helper.select_rotation([(0, 72.2, 34, 21), (90, 66.3, 10, 5), (270, 65.0, 30, 20), (180, 59.6, 10, 5)]),
            {'status': 'unresolved', 'rotation': 0, 'version': 1}
        )

    def test_reliable_character_count_excludes_punctuation_and_words_below_sixty_confidence(self):
        tsv = 'level\tconf\ttext\n5\t80\t学习能力\n5\t60\tab\n5\t59.99\tVIVIVIVIY\n5\t99\t，。!\n'
        self.assertAlmostEqual(helper.weighted_confidence(tsv, 60)[0], 220 / 3)
        self.assertEqual(helper.weighted_confidence(tsv, 60)[1], 6)

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

    def test_falls_back_to_combined_language_when_chinese_has_too_little_reliable_text(self):
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / 'english.png'
            Image.new('RGB', (400, 300), 'white').save(image_path)

            def native(candidate, *arguments):
                language = arguments[1]
                if language == 'osd':
                    return SimpleNamespace(returncode=1, stdout='')
                confidence = 55 if language == 'chi_sim' else 90 if candidate.stem == '270' else 20
                return SimpleNamespace(returncode=0, stdout=f'level\tconf\ttext\n5\t{confidence}\tPracticeDailyReview\n')

            with patch.object(helper, 'run_tesseract', native):
                self.assertEqual(helper.orient(image_path), {'status': 'resolved', 'rotation': 270, 'version': 1})

    def test_composite_evidence_ranking_ignores_few_character_high_confidence_noise(self):
        # 3 chars at 95% confidence must not outrank or block 40 real chars at 75% confidence
        candidates = [(180, 95.0, 3, 2), (0, 75.0, 40, 30), (90, 10.0, 2, 0), (270, 0.0, 0, 0)]
        self.assertEqual(helper.select_rotation(candidates), {'status': 'resolved', 'rotation': 0, 'version': 1})

    def test_long_image_slice_protection_crops_tall_images_before_downscaling(self):
        with tempfile.TemporaryDirectory() as directory:
            tall_image_path = Path(directory) / 'tall_scroll.png'
            # 1000 x 3000 (aspect 3.0 > 2.5)
            Image.new('RGB', (1000, 3000), 'white').save(tall_image_path)
            normalized_sizes = []
            def native(candidate, *arguments):
                with Image.open(candidate) as img:
                    normalized_sizes.append(img.size)
                return SimpleNamespace(returncode=0, stdout='Rotate: 0\nOrientation confidence: 16.00\n')
            with patch.object(helper, 'run_tesseract', native):
                res = helper.orient(tall_image_path)
                self.assertEqual(res, {'status': 'resolved', 'rotation': 0, 'version': 1})
            # 1000 x 2200 sliced thumbnail into 1600x1600 produces (727, 1600) instead of (533, 1600)
            self.assertEqual(normalized_sizes[0], (727, 1600))

    def test_osd_hint_ranking_and_pruning_avoids_unnecessary_rotations(self):
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / 'question.png'
            Image.new('RGB', (800, 600), 'white').save(image_path)
            called_stems = []
            def native(candidate, *arguments):
                if arguments[1] == 'osd':
                    return SimpleNamespace(returncode=0, stdout='Rotate: 90\nOrientation confidence: 10.00\n')
                called_stems.append(candidate.stem)
                # Rotation 90 has strong text evidence
                return SimpleNamespace(
                    returncode=0,
                    stdout='level\tconf\ttext\n5\t85\t这是一道完整的行测常识判断题目\n5\t90\t正确选项分析突破口清晰\n5\t88\t考点梳理到位\n'
                )
            with patch.object(helper, 'run_tesseract', native):
                res = helper.orient(image_path)
                self.assertEqual(res, {'status': 'resolved', 'rotation': 90, 'version': 1})
            # Rotation 90 tested first and pruned remaining rotations (0, 180, 270 not called in native OCR)
            self.assertEqual(called_stems, ['90'])


if __name__ == '__main__':
    unittest.main()
