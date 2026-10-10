import unittest

from hexagram_engine import calculate, cast_from_coins, cast_from_numbers


class HexagramEngineTests(unittest.TestCase):
    def test_numbers_cast_is_repeatable(self):
        self.assertEqual(cast_from_numbers([18, 27]), cast_from_numbers([18, 27]))

    def test_numbers_cast_derives_known_hexagram(self):
        result = calculate("numbers", [1, 1])
        self.assertEqual(result["primary"]["name"], "乾")
        self.assertEqual(result["moving_lines"], [2])
        self.assertEqual(result["transformed"]["name"], "天火同人")

    def test_coins_use_bottom_to_top_order(self):
        lines = cast_from_coins([[3, 3, 3], [2, 2, 2], [3, 2, 2], [3, 2, 3], [2, 3, 3], [2, 2, 3]])
        self.assertEqual(lines, [9, 6, 7, 8, 8, 7])

    def test_invalid_numbers_are_rejected(self):
        with self.assertRaises(ValueError):
            cast_from_numbers([1])
        with self.assertRaises(ValueError):
            cast_from_numbers([1, 0])


if __name__ == "__main__":
    unittest.main()
