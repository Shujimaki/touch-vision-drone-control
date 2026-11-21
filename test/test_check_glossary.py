import importlib.util
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location("check", Path(__file__).parents[1] / "scripts" / "check.py")
check = sys.modules["check"] = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)

GLOSSARY = """**Swarm**:
The three drones.
_Avoid_: team (for the drones)
_Never_: Fleet, Mocap server
"""


def findings(*lines: str) -> list[str]:
    added = [("web/src/x.ts", number, text) for number, text in enumerate(lines, start=1)]
    return check.glossary_findings(added, check.never_terms(GLOSSARY))


def test_only_never_lines_are_banned_not_avoid_lines() -> None:
    assert check.never_terms(GLOSSARY) == [("fleet",), ("mocap", "server")]


def test_a_never_word_in_prose_fails() -> None:
    assert findings("The fleet takes off.") == ["web/src/x.ts:1: fleet"]


def test_a_never_word_inside_a_camel_case_or_snake_case_identifier_fails() -> None:
    assert findings("import { flightFleet } from './a';", "FLEET_SIZE = 3", "type FleetDrone = {}") == [
        "web/src/x.ts:1: fleet",
        "web/src/x.ts:2: fleet",
        "web/src/x.ts:3: fleet",
    ]


def test_a_plural_never_word_fails() -> None:
    assert findings("Two fleets.") == ["web/src/x.ts:1: fleet"]


def test_a_multi_word_never_term_fails_only_as_consecutive_words() -> None:
    assert findings("the mocapServer url", "a mocap camera and a server") == ["web/src/x.ts:1: mocap server"]


def test_a_word_that_only_contains_a_never_word_passes() -> None:
    assert findings("The fleetingly short hover.", "Swarm drones") == []
