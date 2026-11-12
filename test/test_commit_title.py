import subprocess
from pathlib import Path

import pytest

from scripts.commit_title import message_problems, title_problems

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / "scripts" / "hooks" / "commit-msg"


@pytest.mark.parametrize(
    "title",
    [
        "feat: connect the tablet to the bridge",
        "fix(bridge): limit input replies on binary",
        "docs(repo): add ADR 0003 for uv",
        "Merge branch 'main' into feat/x",
        'Revert "feat: connect the tablet to the bridge"',
        "fixup! fix(web): round hello t_ms",
    ],
)
def test_a_title_that_follows_the_rules_passes(title: str) -> None:
    assert title_problems(title) == []


@pytest.mark.parametrize(
    ("title", "problem"),
    [
        ("connect the tablet", "must look like"),
        ("feature: connect the tablet", "type 'feature'"),
        ("fix(server): close sockets", "scope 'server'"),
        ("fix(): close sockets", "scope ''"),
        ("fix(web): Round hello t_ms", "lowercase"),
        ("fix(web): round hello t_ms.", "period"),
        ("fix(bridge): limit input replies and close on binary", "52 characters"),
    ],
)
def test_a_title_that_breaks_a_rule_names_the_rule(title: str, problem: str) -> None:
    assert problem in "\n".join(title_problems(title))


def test_a_message_checks_its_first_line_and_skips_git_comments() -> None:
    message = "\n# Please enter the commit message\nfix(web): round hello t_ms\n\n- why\n# On branch x\n"

    assert message_problems(message) == []


@pytest.mark.parametrize(
    "line", ["Co-Authored-By: Someone <a@b.c>", "🤖 Generated with [Claude Code](https://claude.com/claude-code)"]
)
def test_a_message_with_an_attribution_line_fails(line: str) -> None:
    assert "attribution" in "\n".join(message_problems(f"fix(web): round hello t_ms\n\n- why\n\n{line}\n"))


def test_text_below_the_scissors_line_is_ignored() -> None:
    message = "fix(web): round t_ms\n# ------------------------ >8 ------------------------\nCo-Authored-By: x\n"

    assert message_problems(message) == []


@pytest.mark.parametrize(("subject", "status"), [("fix(web): round hello t_ms", 0), ("Fix stuff.", 1)])
def test_the_hook_exits_nonzero_only_for_a_bad_message(tmp_path: Path, subject: str, status: int) -> None:
    message = tmp_path / "COMMIT_EDITMSG"
    message.write_text(subject + "\n", encoding="utf-8")

    result = subprocess.run([str(HOOK), str(message)], cwd=ROOT, capture_output=True, text=True, check=False)

    assert result.returncode == status
