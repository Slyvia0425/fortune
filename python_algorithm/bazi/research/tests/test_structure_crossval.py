"""Accuracy (proposal section 3): hidden stems and ten gods, in bulk against
lunar-python. Complements test_structure.py, which checks the classical text."""

import pytest
import random
from datetime import datetime, timedelta

from lunar_python import Solar

from bazi.calc.pillars import compute_pillars
from bazi.calc.structure import build_pillars
from bazi.models.enums import DISPLAY_STEM, DISPLAY_TEN_GOD


def _reference(t):
    ec = Solar.fromYmdHms(t.year, t.month, t.day, t.hour, t.minute, 0).getLunar().getEightChar()
    ec.setSect(1)
    return {
        "year": (ec.getYearHideGan(), ec.getYearShiShenGan(), ec.getYearShiShenZhi()),
        "month": (ec.getMonthHideGan(), ec.getMonthShiShenGan(), ec.getMonthShiShenZhi()),
        "day": (ec.getDayHideGan(), None, ec.getDayShiShenZhi()),
        "hour": (ec.getTimeHideGan(), ec.getTimeShiShenGan(), ec.getTimeShiShenZhi()),
    }


@pytest.mark.slow
def test_hidden_stems_order_and_ten_gods_match_lunar_python():
    rng = random.Random(31)
    mismatches = []
    for _ in range(2000):
        t = datetime(1900, 1, 1) + timedelta(minutes=rng.randrange(200 * 365 * 1440))
        ref = _reference(t)
        for p in build_pillars(compute_pillars(t)):
            hide, stem_god, branch_gods = ref[p.label.value]
            ours_hide = [DISPLAY_STEM[h.stem] for h in p.hidden_stems]
            ours_gods = [DISPLAY_TEN_GOD[h.ten_god] for h in p.hidden_stems]
            ours_stem_god = DISPLAY_TEN_GOD[p.ten_god] if p.ten_god else None
            if (ours_hide, ours_gods, ours_stem_god) != (list(hide), list(branch_gods), stem_god):
                mismatches.append((t, p.label.value))
    assert not mismatches, mismatches[:5]
