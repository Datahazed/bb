# Continue from an archived environment

Status: implemented 2026-08-11.

Related change: PR #1016 (`feat(environments): add a lossless archive grace
period`).

## Outcome

Once a managed worktree has finished archiving, its read-only context banner
offers **Continue in new thread**. The action opens the root new-thread
composer with these selections already populated:

- the archived thread's project;
- **New worktree** on the archived environment's machine;
- **Continue from: `<archived branch>`**;
- a `Continue from @thread:<source>` prompt prefix with a rich source-thread
  mention.

Submitting creates a fresh managed environment that preserves the archived
environment's effective merge base and continues the archived branch's
committed state. Provisioning reuses the exact branch name when Git can attach
it safely. If that branch is already checked out elsewhere, provisioning
creates the normal thread-scoped branch at the archived branch's current
commit instead. If the archived branch no longer exists, creation fails with
an actionable error rather than silently falling back to the merge base and
losing branch-only commits.

The action never revives or reuses the terminal environment. It seeds the same
source-thread prompt mention as handoff, but does not unarchive the source
thread or create provider-session fork lineage.

## Product semantics

`Continue from` is a new create-environment intent, distinct from:

- **Existing worktree**, which attaches another thread to a live environment;
- **Branch from**, which always creates a new thread-scoped branch from a
  selected base;
- thread handoff, which seeds the same `Continue from @thread:...` prompt but
  reuses a live environment rather than continuing a destroyed one;
- forking, which carries provider-session/thread lineage.

The continuation selection is tied to the source environment. If the user
chooses a different branch in the root composer, the selection becomes an
ordinary **Branch from** selection; it must not keep the source environment's
merge base or exact-branch reuse policy. Changing project or environment mode
also clears the continuation intent.

Only committed branch state can be continued after destruction. Uncommitted
and untracked files were removed with the old worktree, and the UI must not
imply that they are restored.

## Findings

### The required metadata survives destruction

- `Environment` retains `projectId`, `hostId`, `workspaceProvisionType`,
  `branchName`, `baseBranch`, `defaultBranch`, and `mergeBaseBranch`.
- `destroy.completed` clears only `path`; it does not clear Git or host
  metadata.
- Destroyed environment rows remain readable through the ordinary environment
  endpoint until the existing seven-day pruning window expires.
- Managed teardown runs `git worktree remove`; it removes the checkout but
  does not delete the local branch from the source repository.

Use `resolveEnvironmentMergeBaseBranch(sourceEnvironment)` at the server
boundary to snapshot the source's effective merge base. This preserves an
explicit user-selected `mergeBaseBranch` and also resolves the existing
`baseBranch`/`defaultBranch` fallback chain to a stable value for the new
environment.

The original host is authoritative. The archived branch can be local-only, so
continuation must target `sourceEnvironment.hostId`, not the user's current
root-composer machine default.

### A named base branch is not continuation

The existing managed-worktree command always runs the equivalent of:

```bash
git worktree add -B <generated-thread-branch> <target> <base-branch>
```

Passing the archived branch as `baseBranch` therefore creates a differently
named branch. Passing the archived name as the command's `branchName` would be
worse: `-B` can reset that existing branch to the merge base, discarding the
commits the action is meant to preserve.

True continuation needs an explicit checkout intent all the way from the
create-thread request to host-workspace provisioning:

- attach the existing local branch without `-B` when it is available;
- create a generated fallback branch from that existing branch when the name
  is already checked out;
- reject a missing source branch.

This changes both the public create-thread contract and the server-to-host
provision command. `HOST_DAEMON_PROTOCOL_VERSION` must be incremented.

### The source environment should remain authoritative

Add a create-only environment variant shaped around the source environment id,
for example:

```ts
{
  type: "continue",
  sourceEnvironmentId: "env_archived",
}
```

The server loads the source environment and derives its project, host, branch,
project source, and effective merge base. The client may carry display
snapshots in one-shot route state for immediate rendering, but the request
must not trust client-provided Git metadata.

This creates a new environment record. It is not `{ type: "reuse" }`, and the
destroyed environment remains terminal.

### Root composer seeding must remain transient

Host-mode environment selections normally become the user's persisted project
preference. CTA navigation must not replace that preference. Generalize the
current reuse-only transient root-compose override so it can also hold
`host:<sourceHostId>:worktree` without a localStorage write.

The continuation branch seed must survive the render in which the project and
environment scope change. `useScopedBranchSelection` currently drops branch
state whenever its scope key changes; it should accept a typed pending seed and
apply it only when the intended `(projectId, environmentValue)` scope becomes
active. This avoids effect-order races and a one-frame stale selection.

## Branch reuse policy

Provision continuation under the existing checkout/worktree mutation locks so
the availability decision and `git worktree add` do not race with another bb
provision operation.

1. Verify the archived local branch still exists. If it does not, fail with a
   specific `branch_not_found`-style error. Do not create from the merge base.
2. If no worktree has that branch checked out, attach it directly with `git
worktree add <target> <branch>` and retain its exact name.
3. If the branch is already checked out, create the server-generated fallback
   branch from the archived branch's current commit. This preserves content
   and merge-base metadata but necessarily changes the working branch name.
4. Fall back only for the explicit “already checked out” condition. Permission,
   repository, lock, setup-script, and other Git failures remain failures.
5. Return the actual checked-out branch name through the existing provision
   result and persist it on the new environment.

The command should carry both the preferred existing branch and the generated
fallback branch so the daemon owns the atomic Git decision while the server
continues to own branch-name generation policy.

## Implementation plan

### 1. Add a create-only continuation contract

- Add `{ type: "continue", sourceEnvironmentId }` to
  `createThreadEnvironmentArgsSchema`; do not add it to generic environment
  action inputs that require a live target environment.
- Update the SDK create input and CLI spawn builder.
- Add `bb thread spawn --continue-from-environment <environment-id>` and make
  it mutually exclusive with `--environment`, `--new-environment`,
  `--base-branch`, `--machine`, and `--host`.
- Update the CLI help, guide, built-in bb CLI skill, and generated template
  surfaces required by `docs/cli-guide-and-skill.md`.
- Keep the source environment id as the only public continuation parameter;
  the server owns host, branch, and merge-base resolution.

### 2. Resolve and validate continuation on the server

- Extend stable thread-request environment resolution with a `continue`
  variant containing the loaded source environment and its local project
  source.
- Require:
  - source environment exists and belongs to the request project;
  - source status is `destroyed`;
  - source workspace provision type is `managed-worktree`;
  - source `branchName` is non-null;
  - `resolveEnvironmentMergeBaseBranch(source)` returns a branch;
  - source host is enrolled, online, and still has this project's local source.
- Produce a durable `continue-managed` provisioning intent containing:
  - source environment id;
  - host id and source path;
  - preferred branch name;
  - preserved merge-base branch.
- Persist that intent in the provisioning context and store the preferred
  continuation branch on the new environment row so a later failed-setup
  reprovision makes the same continuation decision instead of degrading to
  ordinary managed-worktree creation.
- Reject a pruned/missing source environment or missing branch/merge base with
  a useful 4xx response.

### 3. Provision a continued managed worktree

- Extend the managed host provision command with an optional
  `continueFromBranchName`: ordinary provisions retain the current generated
  `branchName` + `baseBranch` fields; continuation treats `branchName` as the
  generated fallback and `continueFromBranchName` as the preferred existing
  branch.
- Bump `HOST_DAEMON_PROTOCOL_VERSION` because the command sent between server
  and enrolled host daemons changes.
- Add host-workspace support for direct existing-branch worktree attachment and
  the narrowly defined checked-out-branch fallback.
- Keep ordinary managed-worktree behavior unchanged.
- Preserve idempotency when a retry finds the target already on either the
  preferred or fallback branch.
- Ensure failure cleanup removes only the partial worktree, never either Git
  branch.

### 4. Persist the continued environment's Git metadata

- Create a fresh environment row on the source host; never update the
  destroyed row or attach the new thread to it.
- Set the new row's `mergeBaseBranch` to the source environment's resolved
  effective merge base before provisioning.
- Persist the actual branch reported by the daemon:
  - preferred archived name when direct attachment succeeded;
  - generated fallback name when the archived branch was already checked out.
- Keep `baseBranch` metadata as the preserved merge base; the separate
  continuation marker stores the source branch used to reconstruct a retry.
- Add a nullable `continuation_branch_name` environment column. This is an
  internal recovery marker, not public source-environment lineage.

### 5. Define the one-shot app navigation seed

- Add a strict builder/reader around React Router's `unknown` location state.
- Carry:
  - `sourceEnvironmentId` for the eventual create request;
  - `projectId`, `hostId`, and `branchName` as display/selection snapshots;
  - the effective merge base as a snapshot for consistency checks and tests;
  - `focusPrompt: true`.
- Treat the source environment id as authoritative at submit; the server
  re-resolves every metadata field.
- Teach `hasSingleUseRootComposeTargetState` to capture and clear the seed from
  browser history.
- Do not copy source prompt content, provider choices, or thread lineage; seed
  only the standard rich source-thread mention.

### 6. Add the archived-banner action

- Extend `ThreadPromptEnvironmentGoneSection` with an optional continuation
  action.
- Render **Continue in new thread** only for `status === "destroyed"` when the
  source is a managed worktree with a branch and effective merge base.
- Keep **Archiving environment...** status-only while destruction is in
  progress, and preserve environment-gone priority over **Unarchive**.
- Ensure the CTA remains reachable when parent/fork/side-chat context is also
  present. `ReadOnlyContextBanner` currently hides status actions whenever the
  parent segment exists, so adjust that layout deliberately.
- If the retained environment is missing/pruned or lacks required Git
  metadata, leave the banner status-only rather than guessing.

### 7. Seed the root composer

- Set the archived project and transient
  `host:<sourceHostId>:worktree` environment selection.
- Represent the scoped branch selection with an explicit discriminant covering
  ordinary picks, local new branches, and source-environment continuation.
- Render the continuation selection as **Continue from: `<branch>`**.
- Replace the new-thread draft with the standard
  `Continue from @thread:<source>` rich-mention prefix and focus its end.
- Resolve untouched continuation to
  `{ type: "continue", sourceEnvironmentId }`.
- If the user selects another branch, convert the selection to ordinary
  **Branch from** and submit the existing named-base managed-worktree request.
- Clear continuation on project/environment changes or successful submission.
- Preserve the user's persisted environment preference; the continuation
  prompt intentionally replaces the current new-thread draft.

## Test plan

### Contract, server, and CLI

- Contract accepts the create-only `continue` variant and rejects it on generic
  live-environment inputs.
- Server rejects missing, cross-project, non-destroyed, non-managed, branchless,
  merge-base-less, and host/source-unavailable source environments.
- Server creates a fresh environment id on the source host and persists the
  source's effective merge base.
- Provisioning-context round trips preserve `continue-managed` across restart.
- CLI maps `--continue-from-environment` to the new request and enforces all
  mutual exclusions.
- SDK sends and parses the new create request without casts.

### Host and workspace

- Free archived branch is attached with the same name and unchanged commit.
- Branch checked out elsewhere produces a generated fallback branch at the
  same commit.
- Missing archived branch fails and does not create from the merge base.
- Unrelated Git/setup failures do not trigger fallback.
- Existing branch is never reset or deleted on success, failure, cancellation,
  or cleanup.
- Provision retries accept a target already using either requested branch.
- Host daemon command contract/version tests cover the new wire shape.

### App

- Destroyed + eligible source renders **Continue in new thread**; destroying
  and ineligible sources do not.
- CTA remains available alongside parent-thread context and suppresses
  **Unarchive**.
- Location-state reader strictly validates all fields and consumes state once.
- Composer shows the archived project, original machine's **New worktree**,
  and **Continue from: `<branch>`** without changing persisted preferences.
- Composer draft is replaced with a rich
  `Continue from @thread:<source>` prefix.
- Untouched submit emits `{ type: "continue", sourceEnvironmentId }`, never
  `{ type: "reuse" }` or a named-base approximation.
- Choosing another branch exits continuation and emits the existing
  managed-worktree named-base request.
- Project/environment changes clear continuation.

### Commands

```bash
pnpm exec turbo run test --filter=@bb/app -- ThreadPromptContextBanner
pnpm exec turbo run test --filter=@bb/app -- RootComposeView
pnpm exec turbo run test --filter=@bb/app -- root-compose-branch
pnpm exec turbo run test --filter=@bb/server-contract
pnpm exec turbo run test --filter=@bb/server -- thread-create
pnpm exec turbo run test --filter=@bb/host-daemon-contract
pnpm exec turbo run test --filter=@bb/host-workspace
pnpm exec turbo run test --filter=@bb/cli -- thread-spawn
pnpm exec turbo run test --filter=@bb/sdk
pnpm exec turbo run typecheck --filter=@bb/app
pnpm exec turbo run typecheck --filter=@bb/server
pnpm exec turbo run typecheck --filter=@bb/host-daemon
```

### Manual QA

1. Create a managed-worktree thread, commit work on its generated branch,
   select a non-default merge base, and archive the environment.
2. During grace/destruction, confirm the banner says **Archiving
   environment...** and has no continuation CTA.
3. After destruction, click **Continue in new thread**.
4. Confirm the root composer shows the original project, original machine's
   **New worktree**, and **Continue from: `<old branch>`**, with a rich
   `Continue from @thread:<source>` prompt prefix.
5. Submit and verify the created thread has a new environment id, the exact old
   branch name, its committed HEAD, and the selected merge base.
6. Check out the archived branch in another worktree and repeat. Verify bb
   creates a generated branch at the same HEAD while retaining the merge base.
7. Delete the archived branch and repeat. Verify submission fails visibly and
   does not create a branch from the merge base.
8. Repeat on a non-primary machine and with a child/fork thread.
9. Confirm an offline original machine remains selected but disabled rather
   than silently switching machines.

## Boundaries

- Do not restore the removed worktree or mutate the destroyed environment.
- Do not unarchive the source thread as part of continuation.
- Do not reuse provider-session history or create fork lineage.
- Do not copy prompt history or source prompt text beyond the standard rich
  source-thread mention.
- Do not extend destroyed-environment retention.
- Do not claim recovery of uncommitted or untracked files.
- Do not silently substitute merge-base state when the source branch is gone.
