#!/usr/bin/env python3
"""Run the automatic repository checks before a commit or a pull request.

AGENTS.md "Before delivery" owns the check rules. This script runs the checks
that need no judgment. It reads the staged snapshot (the Git index), so stage
the change first. It prints one line for each check:

  PASS        The check ran and found no problem.
  FAIL        The check found a problem. Indented lines give the details.
  SKIP        The check does not apply to this change.
  INCOMPLETE  The check applies but could not run.

The exit status is 1 if any check fails. Otherwise it is 0.

Usage: python3 scripts/check.py [--base REF]
"""

from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(
    subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
)
MERMAID_CLI = ["npx", "-y", "@mermaid-js/mermaid-cli@11"]
# Download and browser errors mean that the render did not run, not that a diagram is wrong.
MERMAID_SETUP_ERROR = re.compile(
    r"npm (?:ERR!|error)|E404|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET"
    r"|Could not find (?:Chrome|browser)|Failed to launch the browser|Browser was not found",
    re.IGNORECASE,
)
# Only the repository ignore rules count, not each developer's global ignore file.
REPO_IGNORE_RULES = ["-c", f"core.excludesFile={os.devnull}"]
SECRET_PATTERNS = {
    "GitHub token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})"),
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "AWS access key": re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    "Slack token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    "Anthropic or OpenAI key": re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}"),
    "Google API key": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "assigned secret": re.compile(
        r"(?i)\b(?:api[_-]?key|secret|token|passw(?:or)?d)\b[\"']?\s*[:=]\s*[\"'][^\"'\s]{12,}[\"']"
    ),
}
BRACKETED = r"\[((?:[^\[\]]|\[[^\[\]]*\])*)\]"
INLINE_LINK = re.compile(
    r"!?" + BRACKETED
    + r"\(\s*(<[^>\n]*>|(?:[^()\s]|\([^()\s]*\))*)(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*\)"
)
REFERENCE_LINK = re.compile(BRACKETED + r"\[([^\]]*)\]")
REFERENCE_DEFINITION = re.compile(r"^ {0,3}\[([^\]]+)\]:\s*(<[^>\n]*>|\S+)")
HEADING = re.compile(r"^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$")
HTML_ANCHOR = re.compile(r"<[A-Za-z][^>]*\s(?:id|name)=[\"']([^\"']+)[\"']")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")


@dataclass
class Result:
    status: str
    name: str
    summary: str
    details: list[str] = field(default_factory=list)


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout


def run(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command, cwd=cwd, capture_output=True, text=True, timeout=600, check=False
    )


def tail(process: subprocess.CompletedProcess[str], lines: int = 20) -> list[str]:
    return (process.stdout + process.stderr).strip().splitlines()[-lines:]


@cache
def index_files() -> frozenset[str]:
    return frozenset(path for path in git("ls-files", "-z").split("\0") if path)


@cache
def index_dirs() -> frozenset[str]:
    dirs = {""}
    for path in index_files():
        while path:
            path = posixpath.dirname(path)
            dirs.add(path)
    return frozenset(dirs)


@cache
def read_index(path: str) -> str:
    return subprocess.run(
        ["git", "show", f":{path}"], cwd=ROOT, capture_output=True, check=True
    ).stdout.decode("utf-8", errors="replace")


def base_exists(base: str) -> bool:
    return (
        subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", f"{base}^{{commit}}"],
            cwd=ROOT,
            capture_output=True,
            check=False,
        ).returncode
        == 0
    )


def diff_ranges(base: str) -> list[list[str]]:
    """Return the diff arguments for staged changes and, if present, branch commits."""
    ranges = [["--cached"]]
    if base_exists(base):
        ranges.append([f"{base}...HEAD"])
    return ranges


def changed_files(base: str) -> set[str]:
    changed: set[str] = set()
    for diff_range in diff_ranges(base):
        output = git("diff", "--name-only", "-z", "--diff-filter=d", *diff_range)
        changed.update(path for path in output.split("\0") if path)
    return changed & index_files()


def added_lines(base: str) -> list[tuple[str, int, str]]:
    lines: list[tuple[str, int, str]] = []
    for diff_range in diff_ranges(base):
        path, number = "", 0
        for line in git("diff", "-U0", "--no-color", "--no-ext-diff", *diff_range).splitlines():
            if line.startswith("+++ "):
                path = line[6:] if line.startswith("+++ b/") else ""
            elif line.startswith("@@"):
                match = re.search(r"\+(\d+)", line)
                number = int(match.group(1)) if match else 0
            elif line.startswith("+") and path:
                lines.append((path, number, line[1:]))
                number += 1
    return lines


def check_ignored_files() -> Result:
    tracked = git(*REPO_IGNORE_RULES, "ls-files", "--cached", "--ignored", "--exclude-standard", "-z")
    matches = sorted(path for path in tracked.split("\0") if path)
    if matches:
        return Result("FAIL", "ignored-files", "staged or tracked files match an ignore rule", matches)
    return Result("PASS", "ignored-files", "no staged or tracked file matches an ignore rule")


def check_secrets(base: str) -> Result:
    lines = added_lines(base)
    findings = [
        f"{path}:{number}: possible {kind}"
        for path, number, text in lines
        for kind, pattern in SECRET_PATTERNS.items()
        if pattern.search(text)
    ]
    if findings:
        return Result("FAIL", "secrets", "added lines contain possible tokens or keys", findings)
    return Result("PASS", "secrets", f"no token or key pattern in {len(lines)} added lines")


def blank(match: re.Match[str]) -> str:
    return re.sub(r"[^\n]", " ", match.group())


def without_code_blocks(text: str) -> list[str]:
    """Blank HTML comments and fenced code blocks, and keep the line numbers."""
    lines = re.sub(r"<!--.*?-->", blank, text, flags=re.DOTALL).splitlines()
    fence = ""
    for index, line in enumerate(lines):
        match = FENCE.match(line)
        if fence:
            if match and match.group(1)[0] == fence[0] and len(match.group(1)) >= len(fence):
                fence = ""
            lines[index] = ""
        elif match:
            fence = match.group(1)
            lines[index] = ""
    return lines


def slug(heading: str) -> str:
    """Return the anchor that GitHub generates for a heading."""
    text = re.sub(r"!?" + BRACKETED + r"(?:\([^)]*\)|\[[^\]]*\])", r"\1", heading)
    text = re.sub(r"<[^>]+>", "", text).replace("`", "").replace("*", "")
    kept = "".join(
        char
        for char in text.strip().lower()
        if char in " -_" or unicodedata.category(char)[0] in "LMN"
    )
    return kept.replace(" ", "-")


@cache
def anchors(path: str) -> frozenset[str]:
    found: set[str] = set()
    counts: dict[str, int] = {}
    for line in without_code_blocks(read_index(path)):
        found.update(HTML_ANCHOR.findall(line))
        match = HEADING.match(line)
        if not match:
            continue
        anchor = slug(match.group(1) or "")
        if anchor in counts:
            counts[anchor] += 1
            anchor = f"{anchor}-{counts[anchor]}"
        else:
            counts[anchor] = 0
        found.add(anchor)
    return frozenset(found)


def resolve(source: str, target: str) -> tuple[str, str]:
    """Return the repository path and the fragment that a local link points to."""
    path, _, fragment = target.partition("#")
    path = unquote(path)
    if path.startswith("/"):
        resolved = posixpath.normpath(path.lstrip("/"))
    elif path:
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source), path))
    else:
        resolved = source
    return ("" if resolved == "." else resolved), unquote(fragment)


def is_ignored(path: str) -> bool:
    command = ["git", *REPO_IGNORE_RULES, "check-ignore", "-q", "--", path]
    return subprocess.run(command, cwd=ROOT, check=False).returncode == 0


def check_links() -> Result:
    markdown = sorted(path for path in index_files() if path.endswith(".md"))
    problems: list[str] = []
    local = ignored = external = 0
    for source in markdown:
        definitions: set[str] = set()
        usages: list[tuple[int, str]] = []
        targets: list[tuple[int, str]] = []
        for number, line in enumerate(without_code_blocks(read_index(source)), start=1):
            line = re.sub(r"(`+).+?\1", blank, line)
            definition = REFERENCE_DEFINITION.match(line)
            if definition:
                definitions.add(" ".join(definition.group(1).split()).casefold())
                targets.append((number, definition.group(2)))
                continue
            targets.extend((number, match.group(2)) for match in INLINE_LINK.finditer(line))
            line = INLINE_LINK.sub(blank, line)
            usages.extend(
                (number, match.group(2) or match.group(1))
                for match in REFERENCE_LINK.finditer(line)
            )
        for number, label in usages:
            if " ".join(label.split()).casefold() not in definitions:
                problems.append(f"{source}:{number}: reference [{label}] has no definition")
        for number, target in targets:
            target = target.strip().removeprefix("<").removesuffix(">")
            if not target or SCHEME.match(target) or target.startswith("//"):
                external += bool(target)
                continue
            local += 1
            resolved, fragment = resolve(source, target)
            if resolved == ".." or resolved.startswith("../"):
                problems.append(f"{source}:{number}: {target}: points outside the repository")
            elif resolved in index_files() or resolved in index_dirs():
                if fragment and resolved.endswith(".md") and fragment not in anchors(resolved):
                    problems.append(f"{source}:{number}: {target}: no heading or anchor #{fragment}")
            elif is_ignored(resolved):
                ignored += 1
            else:
                problems.append(f"{source}:{number}: {target}: not in the staged snapshot")
    summary = (
        f"{len(markdown)} Markdown files, {local} local links"
        f" ({ignored} into ignored local files), {external} external links not checked"
    )
    if problems:
        return Result("FAIL", "links", summary, problems)
    return Result("PASS", "links", summary)


def check_json() -> Result:
    examples = sorted(
        path
        for path in index_files()
        if posixpath.dirname(path) == "protocol/examples" and path.endswith(".json")
    )
    if not examples:
        return Result("SKIP", "json", "no protocol/examples/*.json files")
    problems: list[str] = []
    for path in examples:
        try:
            json.loads(read_index(path))
        except json.JSONDecodeError as error:
            problems.append(f"{path}:{error.lineno}: {error.msg}")
    summary = f"{len(examples)} files in protocol/examples"
    if problems:
        return Result("FAIL", "json", summary, problems)
    return Result("PASS", "json", summary)


def check_mermaid(base: str) -> Result:
    diagrams = sorted(
        path
        for path in changed_files(base)
        if path.endswith(".mmd")
        or (path.endswith(".md") and re.search(r"^ {0,3}(`{3,}|~{3,})\s*mermaid", read_index(path), re.MULTILINE))
    )
    if not diagrams:
        return Result("SKIP", "mermaid", "no changed file contains a Mermaid diagram")
    if not shutil.which("npx"):
        return Result("INCOMPLETE", "mermaid", "npx is not installed", diagrams)
    problems: list[str] = []
    setup_errors: list[str] = []
    with tempfile.TemporaryDirectory() as temp:
        for index, path in enumerate(diagrams):
            source = Path(temp, str(index), posixpath.basename(path))
            source.parent.mkdir()
            source.write_text(read_index(path), encoding="utf-8")
            output = source.parent / "out" / source.name
            output.parent.mkdir()
            if path.endswith(".mmd"):
                output = output.with_suffix(".svg")
            try:
                process = run([*MERMAID_CLI, "-i", str(source), "-o", str(output)], ROOT)
            except subprocess.TimeoutExpired:
                return Result("INCOMPLETE", "mermaid", "mermaid-cli timed out", diagrams)
            if process.returncode != 0:
                errors = setup_errors if MERMAID_SETUP_ERROR.search(process.stdout + process.stderr) else problems
                errors.append(f"{path}:")
                errors.extend(f"  {line}" for line in tail(process))
    if problems:
        return Result("FAIL", "mermaid", "a diagram failed to render", problems)
    if setup_errors:
        return Result("INCOMPLETE", "mermaid", "mermaid-cli could not download or start", setup_errors)
    return Result("PASS", "mermaid", f"rendered {', '.join(diagrams)}")


def local_binary(directory: Path, name: str) -> Path | None:
    for folder in (directory, *directory.parents):
        candidate = folder / "node_modules" / ".bin" / name
        if candidate.exists():
            return candidate
        if folder == ROOT:
            break
    return None


def run_suite(name: str, label: str, directory: Path, command: list[str]) -> Result:
    try:
        process = run(command, directory)
    except subprocess.TimeoutExpired:
        return Result("INCOMPLETE", name, f"{label} timed out")
    if process.returncode == 0:
        return Result("PASS", name, label)
    if name == "pytest" and process.returncode == 5:
        return Result("INCOMPLETE", name, f"{label} collected no tests")
    return Result("FAIL", name, label, tail(process))


def config_dirs(filename: str, contains: str = "") -> list[str]:
    return sorted(
        posixpath.dirname(path)
        for path in index_files()
        if posixpath.basename(path) == filename and contains in read_index(path)
    )


def check_code_suites() -> list[Result]:
    results: list[Result] = []
    suites = [
        ("pytest", "pyproject.toml", "", "uv", ["uv", "run", "pytest"]),
        ("tsc", "tsconfig.json", "", "tsc", ["tsc", "--noEmit"]),
        ("vitest", "package.json", '"vitest"', "vitest", ["vitest", "run"]),
    ]
    for name, filename, contains, binary, command in suites:
        directories = config_dirs(filename, contains)
        if not directories:
            results.append(Result("SKIP", name, f"no {filename} configures {name}"))
            continue
        for directory in directories:
            cwd = ROOT / directory
            label = f"{' '.join(command)} in {directory or '.'}"
            executable = shutil.which(binary) if binary == "uv" else local_binary(cwd, binary)
            if executable is None:
                reason = "uv is not installed" if binary == "uv" else "dependencies are not installed"
                results.append(Result("INCOMPLETE", name, f"{label}: {reason}"))
                continue
            results.append(run_suite(name, label, cwd, [str(executable), *command[1:]]))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--base",
        default="main",
        help="branch that the change merges into (default: main)",
    )
    base = parser.parse_args().base
    note = "" if base_exists(base) else f" ({base} not found, so only staged changes count)"
    print(f"Checking the staged snapshot against {base}{note}.")
    results = [
        check_ignored_files(),
        check_secrets(base),
        check_links(),
        check_json(),
        check_mermaid(base),
        *check_code_suites(),
    ]
    for result in results:
        print(f"{result.status:<11} {result.name:<14} {result.summary}")
        for detail in result.details:
            print(f"    {detail}")
    print('Not automated: prose rules, evidence and source links, and document roles (AGENTS.md "Before delivery").')
    return 1 if any(result.status == "FAIL" for result in results) else 0


if __name__ == "__main__":
    sys.exit(main())
