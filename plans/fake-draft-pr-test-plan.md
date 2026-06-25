# Fake Draft PR Test Plan

## Goal

Exercise the draft PR workflow with a deliberately fake plan and a harmless
README edit.

## Scope

- Add one clearly labeled test edit.
- Add this fake plan under `plans/`.
- Open a draft PR for workflow validation.

## Exit Criteria

- The test edit is visible in the repository diff.
- The fake plan exists at `plans/fake-draft-pr-test-plan.md`.
- A draft PR is created for the branch.

## Validation

- `git diff --check`
- Confirm the PR is marked as draft.
