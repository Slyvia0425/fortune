"""Lunar -> solar date conversion (T9).

The lunisolar calendar is table-driven (leap months follow astronomical rules
that are not worth re-deriving), so this is the one place production code uses
lunar-python. Every conversion is verified by converting back, which also
rejects lunar dates that do not exist (day 30 of a 29-day month, a leap month
the year does not have).
"""

from datetime import date

from lunar_python import Lunar, Solar


class InvalidLunarDate(ValueError):
    pass


def _nonexistent(year: int, month: int, day: int, leap_month: bool) -> InvalidLunarDate:
    if leap_month:
        return InvalidLunarDate(f"农历 {year} 年闰{month}月{day}日不存在（该年可能没有闰{month}月）")
    return InvalidLunarDate(f"农历 {year} 年{month}月{day}日不存在")


SUPPORTED_YEARS = (1900, 2100)  # the range the engine is validated over


def lunar_to_solar(year: int, month: int, day: int, leap_month: bool = False) -> date:
    if not SUPPORTED_YEARS[0] <= year <= SUPPORTED_YEARS[1]:
        raise InvalidLunarDate(f"暂只支持农历 {SUPPORTED_YEARS[0]}–{SUPPORTED_YEARS[1]} 年")
    try:
        lunar = Lunar.fromYmd(year, -month if leap_month else month, day)
        solar = lunar.getSolar()
    except Exception as exc:  # the library raises bare Exceptions for bad input
        raise _nonexistent(year, month, day, leap_month) from exc

    back = Solar.fromYmd(solar.getYear(), solar.getMonth(), solar.getDay()).getLunar()
    if (back.getYear(), abs(back.getMonth()), back.getMonth() < 0, back.getDay()) != \
            (year, month, leap_month, day):
        raise _nonexistent(year, month, day, leap_month)
    return date(solar.getYear(), solar.getMonth(), solar.getDay())
