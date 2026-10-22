#!/usr/bin/env python3
"""Check a commit message or a pull request title against the project's commit title rules.

A title reads <type>(<scope>): <title>, with a type and an optional scope from the lists below.
The title starts in lowercase, has no final period, and has 50 characters or fewer.
The message carries no co-author or tool attribution line.

The commit-msg hook in scripts/hooks/ runs this script on each commit. Install it once in each
clone with `git config core.hooksPath scripts/hooks`.

Usage: python3 scripts/commit_title.py --file MESSAGE_FILE
       python3 scripts/commit_title.py --title "feat(web): add a thing"
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

TYPES = frozenset({"feat", "fix", "chore", "docs", "refactor", "test", "style", "perf"})
SCOPES = frozenset({"protocol", "context", "readme", "roadmap", "web", "bridge", "firmware", "analysis", "repo"})
MAX_TITLE = 50
TITLE = re.compile(r"(?P<type>[a-z]+)(?:\((?P<scope>[^)]*)\))?: (?P<text>.+)")
GIT_WRITTEN_PREFIXES = ("Merge ", 'Revert "', "fixup! ", "squash! ", "amend! ")
ATTRIBUTION = re.compile(r"^(?:co-authored-by:|.*generated with \[?claude)", re.IGNORECASE)
SCISSORS = "# ------------------------ >8 ------------------------"


def title_problems(title: str) -> list[str]:
    if title.startswith(GIT_WRITTEN_PREFIXES):
        return []
    match = TITLE.fullmatch(title)
    if match is None:
        return [f"the title must look like <type>(<scope>): <title>, got {title!r}"]
    problems: list[str] = []
    if match["type"] not in TYPES:
        problems.append(f"type {match['type']!r} is not one of {', '.join(sorted(TYPES))}")
    if match["scope"] is not None and match["scope"] not in SCOPES:
        problems.append(f"scope {match['scope']!r} is not one of {', '.join(sorted(SCOPES))}")
    if match["text"][0].isupper():
        problems.append("the title text must start in lowercase")
    if title.endswith("."):
        problems.append("the title must not end with a period")
    if len(title) > MAX_TITLE:
        problems.append(f"the title has {len(title)} characters, and the limit is {MAX_TITLE}")
    return problems


def message_problems(message: str) -> list[str]:
    lines = [line for line in message.split(SCISSORS)[0].splitlines() if not line.startswith("#")]
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return ["the commit message is empty"]
    problems = title_problems(lines[0])
    problems.extend(
        f"remove the attribution line {line.strip()!r}" for line in lines[1:] if ATTRIBUTION.match(line.strip())
    )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--file", type=Path, help="commit message file, as git passes it to commit-msg")
    source.add_argument("--title", help="a pull request title")
    args = parser.parse_args()
    if args.file is not None:
        problems = message_problems(args.file.read_text(encoding="utf-8"))
    else:
        problems = title_problems(args.title)
    for problem in problems:
        print(f"commit title: {problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
