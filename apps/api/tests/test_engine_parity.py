"""The Python engine must reproduce the TypeScript engine's plans.

fixtures/engine-parity/expected.json is generated from the TS engine (the
browser renders that one) with `npm run parity:update` in apps/web. Python
rounds output coordinates to 3 decimals, so numbers are compared within
TOLERANCE metres; everything else (room order, types, labels, counts,
suggestion text) must match exactly.
"""
import json
import math
from pathlib import Path

import pytest

from app.services.floorplan import generate_plan

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "engine-parity"
CASES = json.loads((FIXTURES / "cases.json").read_text(encoding="utf-8"))
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))

TOLERANCE = 1.5e-3
# Fields only the API returns; not part of the shared PlanResult contract.
PYTHON_ONLY = {"summary"}


def _diff(ts, py, path: str, out: list[str]) -> None:
    if isinstance(ts, dict) and isinstance(py, dict):
        for k in sorted(set(ts) | set(py)):
            if path == "" and k in PYTHON_ONLY:
                continue
            # TS omits undefined fields; Python emits None. Treat as equal.
            a, b = ts.get(k), py.get(k)
            if a is None and b is None:
                continue
            if k not in ts:
                out.append(f"{path}.{k}: only in Python ({b!r:.60})")
            elif k not in py:
                out.append(f"{path}.{k}: missing in Python (TS={a!r:.60})")
            else:
                _diff(a, b, f"{path}.{k}", out)
    elif isinstance(ts, list) and isinstance(py, list):
        if len(ts) != len(py):
            out.append(f"{path}: length TS={len(ts)} Python={len(py)}")
        for i, (a, b) in enumerate(zip(ts, py)):
            _diff(a, b, f"{path}[{i}]", out)
    elif (isinstance(ts, (int, float)) and isinstance(py, (int, float))
          and not isinstance(ts, bool) and not isinstance(py, bool)):
        if not math.isclose(ts, py, abs_tol=TOLERANCE):
            out.append(f"{path}: TS={ts} Python={py}")
    elif ts != py:
        out.append(f"{path}: TS={ts!r:.80} Python={py!r:.80}")


def test_every_case_has_expected_output():
    assert sorted(EXPECTED) == sorted(c["name"] for c in CASES), (
        "cases.json and expected.json are out of sync; run `npm run parity:update` in apps/web"
    )


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_python_engine_matches_typescript(case):
    # JSON round-trip turns Python tuples into lists, like the TS fixture.
    plan = json.loads(json.dumps(generate_plan(case["req"])))
    out: list[str] = []
    _diff(EXPECTED[case["name"]], plan, "", out)
    assert not out, f"{len(out)} difference(s) from the TS engine:\n  " + "\n  ".join(out[:25])
