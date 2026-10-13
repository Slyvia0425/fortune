"""No divination calculations here: match only versioned, frozen core facts."""

from .conditions import evaluate

KIN = {"parents", "siblings", "offspring", "wealth", "officials"}
POSITIONS = {"self", "response"}
ROLE_NAMES = {
    "parents": "父母",
    "siblings": "兄弟",
    "offspring": "子孙",
    "wealth": "妻财",
    "officials": "官鬼",
    "self": "世",
    "response": "应",
}


def rule_condition(rule, facts):
    if not rule.get("executable"):
        return {"value": "unknown", "reason": "RULE_NOT_EXECUTABLE", "missing_fields": []}
    condition = evaluate(rule.get("conditions_ast"), facts)
    if condition["value"] == "false":
        return condition
    exceptions = rule.get("exceptions_ast")
    if exceptions:
        exception = evaluate(exceptions, facts)
        if exception["value"] == "true":
            return {"value": "false", "reason": "EXCEPTION_APPLIES", "missing_fields": []}
        if exception["value"] == "unknown":
            return {
                "value": "unknown",
                "reason": "EXCEPTION_UNRESOLVED",
                "missing_fields": sorted(
                    set(condition["missing_fields"] + exception["missing_fields"])
                ),
            }
    return condition


def complete_main(core):
    lines = core.get("main_lines", [])
    return (
        core.get("main_lines_complete") is True
        and len(lines) == 6
        and {line.get("position") for line in lines} == set(range(1, 7))
        and all(line.get("kin") in KIN and isinstance(line.get("ref"), str) for line in lines)
        and len({line["ref"] for line in lines}) == 6
    )


def match_role(role, core):
    result = {
        "role_id": "role:" + role,
        "role_status": "conditional",
        "supporting_rule_ids": [],
        "main_hexagram_line_refs": [],
        "hidden_line_refs": [],
        "transformed_line_refs": [],
        "presence_status": "unknown",
        "selected_line_ref": None,
        "missing_facts": [],
        "conflicts": [],
    }
    main = core.get("main_lines", [])
    if role in POSITIONS:
        lines = [line for line in main if line.get("position_role") == role]
        if len(lines) != 1:
            result["missing_facts"] = ["core.position_roles"]
        else:
            result.update(
                presence_status="known_present", main_hexagram_line_refs=[lines[0]["ref"]]
            )
        return result
    result["transformed_line_refs"] = [
        line["ref"] for line in core.get("transformed_lines", []) if line.get("kin") == role
    ]
    if not complete_main(core):
        result["missing_facts"] = ["core.main_lines.kin"]
        return result
    refs = [line["ref"] for line in main if line["kin"] == role]
    result.update(
        main_hexagram_line_refs=refs, presence_status="known_present" if refs else "known_absent"
    )
    if not refs:
        if core.get("hidden_lines_complete") is not True:
            result["missing_facts"].append("core.hidden_lines")
        result["hidden_line_refs"] = [
            line["ref"] for line in core.get("hidden_lines", []) if line.get("kin") == role
        ]
    return result


def derive(units, core):
    roles = {}
    for unit in units:
        action = unit.get("action_ast") or {}
        role = action.get("role")
        if (
            unit.get("not_for_interpretation")
            or unit.get("condition_evaluation") != "true"
            or action.get("op") != "propose_role"
            or role not in KIN | POSITIONS
        ):
            continue
        candidate = roles.setdefault(role, match_role(role, core))
        candidate["supporting_rule_ids"].append(unit["entity_revision_id"])
        candidate["conflicts"] = sorted(
            set(candidate["conflicts"] + unit.get("conflict_group_ids", []))
        )
    # A unique observed line is still a candidate; selection needs an encoded rule.
    for role, candidate in roles.items():
        selections = []
        for unit in units:
            action = unit.get("action_ast") or {}
            if (
                unit.get("not_for_interpretation")
                or unit.get("condition_evaluation") != "true"
                or unit.get("conflict_group_ids")
                or candidate["conflicts"]
                or action.get("op") != "select_line"
                or action.get("role") != role
            ):
                continue
            scope = action.get("scope")
            # Select a unique predicate match within an explicit scope.
            if scope not in ("main", "hidden", "transformed"):
                continue
            if scope == "main" and candidate["presence_status"] == "unknown":
                continue
            if scope != "main" and core.get(scope + "_lines_complete") is not True:
                continue
            lines = [
                line
                for line in core.get(scope + "_lines", [])
                if (line.get("kin") == role if role in KIN else line.get("position_role") == role)
            ]
            matches = [(line, evaluate(action.get("where"), {"line": line})) for line in lines]
            if any(value["value"] == "unknown" for _, value in matches):
                continue
            chosen = [line["ref"] for line, value in matches if value["value"] == "true"]
            if len(chosen) == 1:
                selections.append((chosen[0], unit["entity_revision_id"]))
        if len({ref for ref, _ in selections}) == 1:
            candidate["selected_line_ref"] = selections[0][0]
            candidate["selection_rule_ids"] = [rid for _, rid in selections]
        elif len({ref for ref, _ in selections}) > 1:
            candidate["conflicts"].append("SELECTION_RULE_CONFLICT")
    return list(roles.values())


def comparable(metadata, context):
    # Only manually reviewed case context can establish comparability; no extraction from outcomes.
    saved = metadata.get("question_context") or {}
    if metadata.get("question_context_review_status") != "approved":
        return {
            "value": "unknown",
            "missing_fields": ["reviewed_case_question_context"],
            "direct_analogy": False,
        }
    fields = ("topic", "subject_relation", "goal")
    different = [
        f
        for f in fields
        if saved.get(f) is not None and context.get(f) is not None and saved[f] != context[f]
    ]
    missing = [f for f in fields if saved.get(f) is None or context.get(f) is None]
    return {
        "value": "false" if different else "unknown" if missing else "true",
        "different_fields": different,
        "missing_fields": missing,
        "direct_analogy": not different and not missing,
        "copy_outcome_allowed": False,
    }
