## Pull Request Type

- The type from the title: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, or `perf`

## Summary

- Two to four bullets. Each bullet states one result of the change and why the project needs it.
- Describe what the branch does now, as the diff against `main` shows it.

## Scope

- `<path>`: what the change does in this file or folder
- One bullet for each changed file or folder

## Key Changes

- Each change in behavior, and each decision that the diff alone does not explain
- Each edit across many files that changes only formatting or names

## Reviewer Guide

1. `<path>`: the file to read first, and why
2. `<path>`: the next file, in the order that explains the change best

## Reviewers

- Owner: the team or members in the ROADMAP.md "Software parts" Owner column for each affected part
- `protocol/` changed: yes, so both teams review, or no

## Risk / Impact

- Flight: how the change affects drone commands or safety behavior
- Messages and records: how the change affects the message format or trial records
- Setup: how the change affects installation, configuration, or the trial procedure

## Validation

- `python3 scripts/check.py`: each output line, with its PASS, FAIL, SKIP, or INCOMPLETE result
- Prose: the result, or "not run" and the reason
- Evidence: the result for each changed requirement, target, decision, and source link
- Document roles: the result for each changed section

## Incomplete Checks

- Each INCOMPLETE line and each judged check that did not run, with the reason

## Breaking Changes

- What stops working, and what each team must change

## Labels

- `LABEL-ID`: how the change affects the label, with a link to its CONTEXT.md section

## Notes

- Facts that reviewers need and that no other section holds, such as follow-up work or known limits

## Attachments

- Screen captures, test logs, or measurement files that support the Validation section

## Self Checklist

<!-- Tick each box before you show this body to the user for approval. -->

- [ ] Tests cover each changed behavior, or the change has no behavior to test
- [ ] The Validation section gives the result of each check
- [ ] The owning document records each change to behavior or procedure
- [ ] Each changed requirement, target, decision, and source link matches its source
