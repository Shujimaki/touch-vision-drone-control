---
name: deliver-change
description: Deliver a change to this repository through a topic branch, the repository checks, a conventional commit, a pull request, and a squash-merge. Use when committing, opening or updating a pull request, or merging in this repository. Use it instead of /commit, /ship, or the git-pr skills.
---

# Deliver Change

Every change reaches `main` as one squash-merged pull request. The pull request title becomes the commit subject on `main`, so it follows the commit title rules. The user approves three gates: the push, the pull request body, and the merge.

[AGENTS.md "Before delivery"](../../../AGENTS.md#before-delivery) owns what to check. This skill owns the order and the commands.

This skill is based on the `commit` and `open-pr` skills and the pull request template of the Casper Studios git-pr plugin 3.0.0. This project uses its own body location, title format, review rule, and attribution rule. Run this skill instead of the plugin skills.

Start at the first step whose completion criterion is not met.

## 1. Branch

If `git branch --show-current` prints `main`, create a topic branch with `git switch -c <type>/<topic>`. Use a commit type and a short topic, for example `docs/message-format-v1`.

Done when the current branch is not `main`.

## 2. Stage

Run `git status --porcelain --untracked-files=all`. Stage each intended path by name with `git add -- <path>...`.
Never stage with `git add -A`, `git add .`, or `git commit -a`. They also stage stray files that no ignore rule covers.

The check script in step 3 fails if a staged file matches a `.gitignore` rule, for example a file in `.local/`.

Done when `git diff --cached --name-only` lists exactly the intended paths.

## 3. Check

Run `python3 scripts/check.py`. It checks the staged snapshot and prints one PASS, FAIL, SKIP, or INCOMPLETE line for each check.
Fix each FAIL, stage the fix, and run the script again. Keep the final output for the pull request.

Then run the checks that need judgment, and record a result for each:

- **Prose.** If `.local/AGENTS.personal.md` exists, apply its writing conventions and its "Before delivery" checks to each changed prose section. Otherwise, record the check as not run.
- **Evidence.** Check each changed requirement, target, decision, and source link against its supporting material.
- **Document roles.** Check that each changed section fits the role of its document in the AGENTS.md table.

Done when the script exits 0 and each judged check has a recorded result.

## 4. Commit

Write the message in this format:

```text
<type>(<scope>): <title>

- <why the change was needed>
- <why, with each label the change touches, for example DEC-11>
```

- **Title.** Use lowercase and no period. Keep it to 50 characters or fewer.
- **Type.** Use `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, or `perf`. `chore` covers tooling and dependencies, `refactor` keeps behavior, and `style` changes only formatting.
- **Scope.** Use `protocol`, `context`, `readme`, `roadmap`, `web`, `bridge`, `firmware`, `analysis`, or `repo`. Omit the scope when the change spans several areas.
- **Body.** Write one-line bullets that explain why the change was needed.
- **Labels.** Cite each REQ-, TARGET-, DEC-, REC-, and OPEN- label whose meaning the change touches. List the candidates with `git diff --cached -U0 | grep '^[+-]' | grep -oE '(REQ|TARGET|DEC|REC|OPEN)-[0-9]+' | sort -u`.
- **Footer.** Add a footer only for `BREAKING CHANGE: <what breaks>` or `Closes #<issue>`.
- **Attribution.** Add no `Co-Authored-By` trailer and no tool footer. The project chose this rule on 2026-09-27.

Commit with a heredoc, so that the body keeps its line breaks:

```bash
git commit -F - <<'EOF'
docs(protocol): add units to telemetry fields

- Both teams need one unit for each field before the bridge parses telemetry (DEC-11)
EOF
```

Done when `git log -1 --format=%s | awk '{ print length }'` prints 50 or less, and `git show --stat HEAD` lists only the intended paths.

For more commits on the same branch, repeat steps 2 to 4.

## 5. Push

If `git remote` prints nothing, stop. Tell the user that the repository has no GitHub remote yet.

If `git ls-remote --heads origin main` prints nothing, the remote has no `main` branch yet. Ask the user to approve `git push origin main` first.

Ask the user to approve the push. After approval, run `git push -u origin HEAD`.

Done when `git status -sb` shows the branch tracking its `origin` branch, with no commits ahead.

## 6. Pull Request

1. Run `git fetch origin`. Read `git log --oneline origin/main..HEAD` and `git diff origin/main...HEAD`. Describe the final state of the branch. Ignore early commits that later commits replaced.
2. Copy [pull-request-template.md](pull-request-template.md) to `PR.md` in the session scratchpad. If the session has no scratchpad, create one with `mktemp -d`. Keep the file outside the repository.
3. Fill each section of `PR.md`, and write "None" where a section does not apply.
   - **Validation.** Copy each script line with its result. Add the result of each judged check.
   - **Incomplete Checks.** List each INCOMPLETE line and each judged check that did not run.
   - **Labels.** List each REQ-, TARGET-, DEC-, REC-, and OPEN- label that the change touches. Link each label to its CONTEXT.md section.
   - **Reviewers.** Name the owner of the affected part from the ROADMAP.md "Software parts" table. Changes to `protocol/` need both teams.
4. Write the title in the commit title format, with 50 characters or fewer. The squash-merge makes it the commit subject on `main`.
5. Show the user the title and the body. Wait for approval, and apply the user's edits.
6. If step 7 requires an approval, find the reviewers. If no CODEOWNERS file assigns them, ask the user for the reviewers' GitHub usernames.
7. Create the pull request. Add `--draft` when the change needs the other team's review. Every `protocol/` change needs it. Add `--reviewer <login>` for each username.

   ```bash
   gh pr create --base main --head "$(git branch --show-current)" \
     --title '<type>(<scope>): <title>' --body-file "<scratchpad>/PR.md"
   ```

8. After `gh pr create` succeeds, delete `PR.md` and give the user the pull request URL.

After the other team agrees to a draft, run `gh pr ready`. After review feedback, repeat steps 2 to 5 and update the Validation section with `gh pr edit --body-file`.

Done when `gh pr view --json url,title,isDraft` shows the pull request with the approved title.

## 7. Merge

Merge only when all of these conditions are true:

- The pull request has the approvals it needs:
  - A `protocol/` change: both teams approved.
  - Any other change: one reviewer approved, or the user is a repository admin.
- The pull request is not a draft.
- The user approved the merge.

To check the admin role, run `gh api 'repos/{owner}/{repo}' --jq .permissions.admin`. It prints `true` for an admin.

Write the squash commit body to `merge-body.md` in the scratchpad. Use the why bullets and labels from the branch commits. Add no trailer.
Then merge with an explicit subject, so that GitHub adds no ` (#N)` suffix and no commit list:

```bash
gh pr merge <number> --squash --delete-branch \
  --subject '<pull request title>' --body-file "<scratchpad>/merge-body.md"
git switch main && git pull --ff-only
```

If an admin merges a pull request without an approval, add `--admin` to `gh pr merge`. The `main` ruleset lets admins skip the approval, but only through a pull request.

Done when `git log -1 --format=%B main` shows one conventional commit without a trailer, and `git branch --list <branch>` prints nothing.
