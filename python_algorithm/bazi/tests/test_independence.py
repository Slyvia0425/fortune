"""The service does not depend on the offline research code: nothing outside bazi/research (and the tests) imports it."""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]               # bazi/


def test_nothing_the_service_runs_imports_the_research_package():
    offenders = []
    for path in ROOT.rglob("*.py"):
        rel = path.relative_to(ROOT).parts
        if rel[0] in ("research", "tests"):
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names = [node.module or ""] if isinstance(node, ast.ImportFrom) else [a.name for a in node.names] if isinstance(node, ast.Import) else []
            offenders += [f"{'/'.join(rel)}:{node.lineno}: {n}" for n in names if n == "bazi.research" or n.startswith("bazi.research.")]
            if isinstance(node, ast.ImportFrom) and node.module == "bazi":
                offenders += [f"{'/'.join(rel)}:{node.lineno}: from bazi import research" for a in node.names if a.name == "research"]
    assert not offenders, offenders


def test_the_data_the_service_reads_is_not_under_research():
    """The service reads bazi/data (basics, cities) and bazi/rules/data; the cases and the reports are research data."""
    assert (ROOT / "data" / "basics").is_dir() and (ROOT / "data" / "cities.tsv").is_file()
    assert not (ROOT / "data" / "cases").exists() and (ROOT / "research" / "data" / "cases").is_dir()
