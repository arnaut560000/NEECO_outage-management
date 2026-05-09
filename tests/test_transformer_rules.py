import unittest

from transformer_rules import (
    is_transformer_point_candidate,
    is_transformer_point_style,
    normalize_transformer_label,
    text_contains_transformer_pattern,
)


class TransformerRuleTests(unittest.TestCase):
    def test_normalize_transformer_label_strips_known_prefixes(self):
        self.assertEqual(normalize_transformer_label("UBDATA_11-DT0005U"), "11-DT0005U")
        self.assertEqual(normalize_transformer_label("DX_11-DT0005U"), "DX_11-DT0005U")

    def test_transformer_style_accepts_dt_variants(self):
        self.assertTrue(is_transformer_point_style("#DT", ""))
        self.assertTrue(is_transformer_point_style("", "#DT_N"))
        self.assertFalse(is_transformer_point_style("#SECPOLE", ""))

    def test_transformer_name_pattern_requires_feeder_number_prefix(self):
        self.assertTrue(text_contains_transformer_pattern("11-DT0005U"))
        self.assertTrue(text_contains_transformer_pattern("12-DT0025UUBDATA"))
        self.assertTrue(text_contains_transformer_pattern("Feeder Number 12-DT0025UUBDATA"))
        self.assertFalse(text_contains_transformer_pattern("DX_12-DT0025U"))
        self.assertFalse(text_contains_transformer_pattern("DT-11-TAL0001-DTSBUS"))
        self.assertFalse(text_contains_transformer_pattern("TAL5465-DTSBUS"))

    def test_transformer_candidate_requires_dt_point_style_and_valid_name(self):
        self.assertTrue(
            is_transformer_point_candidate(
                feature_name="11-DT0005U",
                style_url="#DT_N",
            )
        )
        self.assertTrue(
            is_transformer_point_candidate(
                feature_description="Transformer ID: 12-DT0025UUBDATA",
                style_url="#DT",
            )
        )
        self.assertFalse(
            is_transformer_point_candidate(
                feature_name="DX_12-DT0025U",
                style_url="#DT",
            )
        )
        self.assertFalse(
            is_transformer_point_candidate(
                feature_name="DT-11-TAL0001-DTSBUS",
                style_url="#DT",
            )
        )
        self.assertFalse(
            is_transformer_point_candidate(
                feature_name="11-DT0005U",
                style_url="#SECPOLE",
            )
        )


if __name__ == "__main__":
    unittest.main()
