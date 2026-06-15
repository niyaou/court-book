#!/usr/bin/env python3
"""Scan a git diff for likely debug leftovers and hardcoded production risks."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d ()-]{7,}\d)(?!\d)")
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
URL_RE = re.compile(r"https?://[^\s\"')]+", re.IGNORECASE)
STRING_ASSIGN_RE = re.compile(
    r"(?i)\b(phone|mobile|tel|telephone|contact|email|mail|openid|unionid|token|secret|customerid|userid|username)\b"
    r"[^=\n:]{0,40}(?:=|:)\s*['\"][^'\"]+['\"]"
)
NUMBER_ASSIGN_RE = re.compile(
    r"(?i)\b(phone|mobile|tel|telephone|contact|customerid|userid)\b[^=\n:]{0,40}(?:=|:)\s*\d{5,}"
)
TEST_MARKER_RE = re.compile(
    r"(?i)\b(debug|debug-only|test only|for testing|temporary|temp|mock|fake|stub|sample data|hardcode|hard-coded|bypass)\b"
)
CN_TEST_MARKER_RE = re.compile(r"(测试|调试|临时|写死|硬编码|模拟数据|假数据|占位)")
DEBUG_LOG_RE = re.compile(
    r"(?i)\b(console\.(log|debug|info|warn|error)|print(?:ln)?\s*\(|logger\.(debug|info)\s*\(|debugger\b)"
)
FORCED_BRANCH_RE = re.compile(r"(?i)\bif\s*\(\s*(true|false|1|0)\s*\)|\?\s*(true|false)\s*:")
FORCED_VALUE_RE = re.compile(
    r"(?i)\b(return|setData|setState|const|let|var)\b.*['\"](?:123456|test|mock|fake|debug)['\"]"
)
LOCAL_ENDPOINT_RE = re.compile(r"(?i)(localhost|127\.0\.0\.1|0\.0\.0\.0|dev\.|test\.|staging\.)")


@dataclass
class Finding:
    severity: str
    path: str
    line_no: int
    reason: str
    snippet: str


def run_git_diff(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        check=False,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout


def load_diff(cli_args: argparse.Namespace) -> str:
    if cli_args.diff_file:
        return Path(cli_args.diff_file).read_text()
    if cli_args.base:
        return run_git_diff(["diff", "--unified=0", cli_args.base])
    if cli_args.working_tree:
        return run_git_diff(["diff", "--unified=0"])
    return run_git_diff(["diff", "--cached", "--unified=0"])


def parse_added_lines(diff_text: str) -> Iterable[tuple[str, int, str]]:
    current_path = None
    new_line_no = 0
    for raw_line in diff_text.splitlines():
        if raw_line.startswith("+++ b/"):
            current_path = raw_line[6:]
            continue
        if raw_line.startswith("@@"):
            match = re.search(r"\+(\d+)", raw_line)
            if match:
                new_line_no = int(match.group(1))
            continue
        if raw_line.startswith("+") and not raw_line.startswith("+++"):
            if current_path is not None:
                yield current_path, new_line_no, raw_line[1:]
            new_line_no += 1
            continue
        if raw_line.startswith("-") and not raw_line.startswith("---"):
            continue
        if current_path is not None and raw_line.startswith(" "):
            new_line_no += 1


def classify_line(path: str, line_no: int, line: str) -> list[Finding]:
    findings: list[Finding] = []
    stripped = line.strip()
    if not stripped:
        return findings

    def add(severity: str, reason: str) -> None:
        findings.append(
            Finding(
                severity=severity,
                path=path,
                line_no=line_no,
                reason=reason,
                snippet=stripped[:220],
            )
        )

    if STRING_ASSIGN_RE.search(stripped) or NUMBER_ASSIGN_RE.search(stripped):
        add("HIGH", "manual assignment to a sensitive identifier with a literal value")

    if PHONE_RE.search(stripped) and re.search(r"(?i)(phone|mobile|tel|contact|客服|电话)", stripped):
        add("HIGH", "hardcoded phone-like value near a phone/contact identifier")

    if EMAIL_RE.search(stripped) and re.search(r"(?i)(email|mail|contact)", stripped):
        add("HIGH", "hardcoded email-like value near an email/contact identifier")

    url_match = URL_RE.search(stripped)
    if url_match and LOCAL_ENDPOINT_RE.search(url_match.group(0)):
        add("HIGH", "endpoint override points to localhost, test, or staging-style host")

    if DEBUG_LOG_RE.search(stripped):
        add("MEDIUM", "debug logging or debugger statement added in diff")

    if TEST_MARKER_RE.search(stripped) or CN_TEST_MARKER_RE.search(stripped):
        add("MEDIUM", "comment or code text suggests temporary testing or hardcoding")

    if FORCED_BRANCH_RE.search(stripped):
        add("HIGH", "forced boolean branch can bypass real production logic")

    if FORCED_VALUE_RE.search(stripped):
        add("MEDIUM", "literal test-style value assigned in executable code")

    return dedupe_findings(findings)


def dedupe_findings(findings: list[Finding]) -> list[Finding]:
    seen: set[tuple[str, str]] = set()
    unique: list[Finding] = []
    for finding in findings:
        key = (finding.severity, finding.reason)
        if key in seen:
            continue
        seen.add(key)
        unique.append(finding)
    return unique


def summarize(findings: list[Finding]) -> int:
    if not findings:
        print("No suspicious additions found.")
        return 0

    severity_rank = {"HIGH": 0, "MEDIUM": 1}
    findings.sort(key=lambda item: (severity_rank[item.severity], item.path, item.line_no))

    print("Suspicious additions found:\n")
    for finding in findings:
        print(f"[{finding.severity}] {finding.path}:{finding.line_no}")
        print(f"Reason: {finding.reason}")
        print(f"Line:   {finding.snippet}\n")

    high_count = sum(1 for item in findings if item.severity == "HIGH")
    medium_count = sum(1 for item in findings if item.severity == "MEDIUM")
    print(f"Summary: {high_count} HIGH, {medium_count} MEDIUM")
    print("This script only reports risk signals. Review the real file before committing.")
    return 2 if high_count else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scan a diff for likely hardcoded test data and debug leftovers."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--staged", action="store_true", help="Scan staged changes (default).")
    mode.add_argument("--working-tree", action="store_true", help="Scan unstaged changes.")
    mode.add_argument("--base", help="Scan a git diff range such as origin/main...HEAD.")
    mode.add_argument("--diff-file", help="Scan an existing patch file.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    diff_text = load_diff(args)
    findings: list[Finding] = []
    for path, line_no, line in parse_added_lines(diff_text):
        findings.extend(classify_line(path, line_no, line))
    return summarize(findings)


if __name__ == "__main__":
    sys.exit(main())
