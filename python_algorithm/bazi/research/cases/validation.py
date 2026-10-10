"""The only door to the validation group's labels. It opens once for each frozen engine and each version of the labels.

    from bazi.research.cases import validation
    labels = validation.open_once("E1-E7 evaluation of the frozen engine")

Before anything is returned it checks the two validation files against the hashes in validation_lock.json, refuses if
this very engine (the same rule files) has been evaluated on these labels before, and writes the open into the log together with a fingerprint of the rule base
(version, weight set, hash of the rule files) so the result is tied to the frozen engine. The log entry is written
first: a run that crashes half-way still counts as the opening. Everything else (code, thresholds, the evaluation
functions) is developed and tested on the tuning labels, which have the same shape.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date

from bazi.research.cases import pattern_review, review, split
from bazi.research.cases.models import AnnotationFile, PatternFile
from bazi.rules import library
from bazi.rules.inference import Inference

KIND = "evaluation"


class ValidationLocked(RuntimeError):
    pass


@dataclass(frozen=True)
class Labels:
    strength: AnnotationFile
    pattern: PatternFile


def rule_base_fingerprint() -> dict:
    """What the evaluation is about: rule base version, weight set, a hash over every rule file and the locked labels."""
    h = hashlib.sha256()
    for path in sorted(library.DATA.glob("*.json")):
        h.update(path.name.encode())
        h.update(path.read_bytes())
    lock = json.loads(split.LOCK.read_text(encoding="utf-8"))
    return {"rule_base": library.load().version,
            "weight_set": Inference().parameters("weights").then["weight_set"],
            "rule_files_sha256": h.hexdigest(), "labels_sha256": hashlib.sha256(json.dumps(lock["files"], sort_keys=True).encode()).hexdigest()}


def already_opened(lock: dict, fingerprint: dict) -> bool:
    """Has this exact engine been evaluated on these exact labels? A changed engine or changed labels is a new evaluation, logged as such."""
    return any(e.get("kind") == KIND and e.get("rule_files_sha256") == fingerprint["rule_files_sha256"]
               and e.get("labels_sha256") == fingerprint["labels_sha256"] for e in lock["opened"])


def open_once(purpose: str) -> Labels:
    lock = json.loads(split.LOCK.read_text(encoding="utf-8"))
    for path in split.locked_files():
        if lock["files"].get(path.name) != split.digest(path):
            raise ValidationLocked(f"{path.name} differs from the locked hash; nothing was opened")
    fingerprint = rule_base_fingerprint()
    if already_opened(lock, fingerprint):
        raise ValidationLocked("this engine was already evaluated on the validation group; see validation_lock.json")
    lock["opened"].append({"kind": KIND, "date": date.today().isoformat(), "what": purpose, "used_for_decision": False,
                           **fingerprint})
    split.LOCK.write_text(json.dumps(lock, ensure_ascii=False, indent=1), encoding="utf-8")
    return Labels(strength=review.load(review.ANNOTATIONS_VALIDATION),
                  pattern=pattern_review.load(split.PATTERN_VALIDATION))
