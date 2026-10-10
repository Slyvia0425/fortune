"""One test that runs a table of cases and reports every case that failed.

Used where a test is the same check over a list of inputs (a coordinate grid, the twelve hour edges, a list of known
offsets): one test in the output instead of dozens, and a failure still names the inputs that broke.
"""

from typing import Any, Iterable


def all_of(argnames: str, cases: Iterable[Any], ids: Any = None):
    names = [n.strip() for n in argnames.split(",")]
    table = list(cases)

    def decorate(check):
        def test():
            failures = []
            for case in table:
                values = tuple(case) if len(names) > 1 else (case,)
                try:
                    check(**dict(zip(names, values)))
                except Exception as error:                       # noqa: BLE001 - report which input failed, whatever the error
                    failures.append((dict(zip(names, values)), f"{type(error).__name__}: {error}"[:200]))
            assert not failures, f"{len(failures)} of {len(table)} cases failed: {failures[:5]}"

        test.__name__, test.__doc__, test.__module__ = check.__name__, check.__doc__, check.__module__
        return test

    return decorate
