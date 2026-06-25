# Fake Test Edit Plan

## Goal

Exercise the branch, plan, and draft PR workflow with a deliberately fake plan.

## Scope

- Add a harmless documentation edit.
- Add this fake plan file under `plans/`.
- Open a draft PR for review of the workflow only.

## Exit Criteria

- The worktree contains only the fake plan and test edit.
- A draft PR exists for the branch.

## Validation

- Run `git diff --check`.
- Inspect `git status --short`.
