"""Small fail-closed three-valued AST evaluator; no eval or generated code."""


def evaluate(ast, facts, depth=0):
    if depth > 20 or not isinstance(ast, dict) or not ast:
        return {"value": "unknown", "missing_fields": [], "reason": "UNENCODED_OR_INVALID_AST"}
    for op in ("all", "any"):
        if op in ast:
            children = ast[op]
            if not isinstance(children, list) or not children or len(children) > 100:
                return {"value": "unknown", "missing_fields": [], "reason": "INVALID_AST"}
            results = [evaluate(child, facts, depth + 1) for child in children]
            values = [r["value"] for r in results]
            decisive, neutral = ("false", "true") if op == "all" else ("true", "false")
            result = (
                decisive
                if decisive in values
                else neutral
                if all(v == neutral for v in values)
                else "unknown"
            )
            return {
                "value": result,
                "missing_fields": sorted({f for r in results for f in r["missing_fields"]}),
            }
    if "not" in ast:
        r = evaluate(ast["not"], facts, depth + 1)
        return {**r, "value": {"true": "false", "false": "true", "unknown": "unknown"}[r["value"]]}
    field, op = ast.get("field"), ast.get("op")
    if not isinstance(field, str) or op not in ("eq", "in", "exists"):
        return {"value": "unknown", "missing_fields": [], "reason": "INVALID_AST"}
    value = facts
    for key in field.split("."):
        if not isinstance(value, dict) or key not in value or value[key] is None:
            return {"value": "unknown", "missing_fields": [field]}
        value = value[key]
    if op == "in" and not isinstance(ast.get("value"), list):
        return {"value": "unknown", "missing_fields": [], "reason": "INVALID_AST"}
    matched = (
        True
        if op == "exists"
        else value == ast.get("value")
        if op == "eq"
        else value in ast["value"]
    )
    return {
        "value": "true" if matched else "false",
        "missing_fields": [],
        "matched_fact_refs": [field],
    }
