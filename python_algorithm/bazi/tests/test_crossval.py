"""T12 as a regression test: the full path stays at 100% exact match."""

from bazi.validation.crossval import run, sample_cases


def test_full_path_exact_match_against_lunar_python():
    result = run(sample_cases(1500, seed=424242))
    assert result.accuracy == 1.0, result.summary()
    assert result.scored > 1400            # the near-term exclusion must stay marginal
