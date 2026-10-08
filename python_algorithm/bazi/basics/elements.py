"""The generating (相生) and controlling (相克) cycles of the five elements."""

from typing import Dict

from bazi.basics.loader import read
from bazi.models.enums import ElementKey

_DATA = read("elements")

GENERATES: Dict[ElementKey, ElementKey] = {ElementKey(k): ElementKey(v) for k, v in _DATA["generates"].items()}
CONTROLS: Dict[ElementKey, ElementKey] = {ElementKey(k): ElementKey(v) for k, v in _DATA["controls"].items()}
