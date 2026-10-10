"""Check machine-readable interpretation claims; does not certify unrestricted prose."""


def validate_claims(pack, claims):
    allowed = {
        u["entity_revision_id"]
        for u in pack["supporting_evidence"]
        if not u["not_for_interpretation"]
    }
    selected = {(r["role_id"], r["line_ref"]) for r in pack["selected_use"]}
    errors = []
    for index, claim in enumerate(claims):
        prefix = f"claims[{index}]"
        if not claim.get("evidence_ids") or not set(claim["evidence_ids"]) <= allowed:
            errors.append(prefix + ":UNSUPPORTED_CITATION")
        if claim.get("method_profile_id") != pack["method_profile_id"]:
            errors.append(prefix + ":METHOD_MISMATCH")
        if claim.get("chart_hash") != pack["chart_hash"]:
            errors.append(prefix + ":CHART_MISMATCH")
        if (
            claim.get("strong_conclusion")
            and not pack["interpretation_contract"]["strong_conclusion_allowed"]
        ):
            errors.append(prefix + ":CONCLUSION_EXCEEDS_EVIDENCE")
        if claim.get("selected_use"):
            use = claim["selected_use"]
            if (use.get("role_id"), use.get("line_ref")) not in selected:
                errors.append(prefix + ":UNSUPPORTED_SELECTION")
        for fact in claim.get("facts", []):
            value = pack["facts"]
            for part in fact.get("path", "").split("."):
                value = value.get(part) if isinstance(value, dict) else None
            if value is None or value != fact.get("value"):
                errors.append(prefix + ":FACT_MISMATCH")
        if claim.get("recast") or claim.get("copy_case_outcome"):
            errors.append(prefix + ":FORBIDDEN_ACTION")
    return {"valid": not errors, "errors": errors, "scope": "structured_claims_only"}
