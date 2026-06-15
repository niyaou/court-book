---
name: commit-diff-guard
description: Review git diffs for risky hardcoded values and debug-only leftovers before code is committed. Use when Codex is asked to commit, prepare a commit, review staged or unstaged changes, inspect a PR diff, or sanity-check whether temporary test code, mock data, fixed phone numbers, debug logging, forced branches, localhost endpoints, or manual overrides may leak into production. This skill only reports risks and gives strong warnings; it never edits code automatically.
---

# Commit Diff Guard

## Overview

Inspect the relevant diff before a commit or diff review. Flag suspicious additions that look like temporary debugging, hardcoded customer data, test overrides, or production-bypassing logic.

Do not modify code as part of this skill. Report findings, explain why each one is suspicious, and leave the final code change decision to the user.

## Workflow

1. Decide which diff to inspect.
Use `git diff --cached` when the user is committing staged changes.
Use `git diff` when the user wants a pre-stage review.
Use a provided patch file or explicit base range when the request is about a PR or an existing commit range.

2. Run the checker script.
Use `scripts/check_diff.py --staged` for staged changes.
Use `scripts/check_diff.py --working-tree` for unstaged changes.
Use `scripts/check_diff.py --base <git-range>` for a range such as `origin/main...HEAD`.
Use `scripts/check_diff.py --diff-file <patch>` when the diff is already on disk.

3. Review the findings manually.
Treat `HIGH` findings as likely commit blockers until reviewed.
Treat `MEDIUM` findings as suspicious context that still requires human judgment.
Read the reported code lines in the real file before concluding.

4. Report clearly.
List each suspicious addition with file, line, severity, and reason.
State explicitly that the skill did not change code.
Ask the user to decide whether to revert, rewrite, or keep the flagged lines.

## Detection Focus

Prioritize strong warnings for:

- Hardcoded customer-facing data such as phone numbers, emails, IDs, tokens, or names.
- Manual assignments to variables like `phone`, `mobile`, `tel`, `contact`, `email`, `openid`, `token`, `customerId`, or similar identifiers.
- Temporary test comments or markers such as `debug`, `test only`, `mock`, `fake`, `stub`, `temporary`, `for testing`, `临时`, `测试`.
- Debug artifacts such as `console.log`, `print`, `debugger`, or equivalent logging added purely for diagnosis.
- Forced logic such as `if (true)`, `if (false)`, bypass branches, fixed return values, or manual overrides that replace real data flow.
- Localhost or test endpoint overrides that should not reach production.

Do not treat the checker output as proof. It is a heuristic filter. Some findings will be false positives, but missing a fixed phone number or test override in a commit is usually worse than reviewing an extra warning.

## Reporting Standard

When presenting results:

- Start with `No suspicious additions found` when the checker is clean.
- Otherwise, list findings in severity order.
- Quote only the minimal relevant line snippet.
- Explain the production risk in plain language.
- End with a direct reminder that the skill only inspected the diff and did not modify code.

## Resources

Use `scripts/check_diff.py` as the default scanner.
