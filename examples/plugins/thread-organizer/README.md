# Thread Organizer example

Thread Organizer is the reference consumer for plugin-owned thread workflows.
It demonstrates the experimental section-icon, section-action, and runtime
skill-slot APIs introduced by the lower layers of this PR stack.

This example intentionally declares `engines.bbPluginSdk >=0.4.17`, the SDK
release containing all three capabilities. It consumes the workspace SDK
directly and does not vendor or relabel the released 0.4.10 package.

## Behavior

- Running threads appear in their remembered workflow stage.
- Idle unread threads appear in Inbox and stay there after being marked read.
- After reading one, drag it to any workflow section to clear it from Inbox
  without starting another agent turn.
- Other read and unread changes do not move a thread after it reaches Inbox.
- A user move changes the remembered stage. `bb organizer phase <stage-key>`
  moves it or refreshes substantially changed work that remains in that stage.
- Inbox keeps that system behavior even when its visible title or icon changes.
- Inbox starts expanded. Other configured sections start collapsed until the
  user changes their collapse state.
- Reordering a non-Inbox stage in the native sidebar saves the same workflow
  order used by plugin settings and future agent instructions.
- Automation-origin root threads follow the same workflow as ordinary roots.
- Stage changes and same-stage refreshes enter one bounded title queue.
  Thread Organizer batches queued threads into one invisible worker, which
  reassesses whether each title still describes the active work. Generated
  renames are limited to five words. If you rename a thread while that worker
  is running, its older proposal is discarded and the thread is queued again
  with its latest title. That title remains eligible for later reassessment
  whenever the active work changes again.
- Every native section header gets a direct Focus Section action with a concise
  stateful tooltip; plain click toggles it, Show all Sections restores the
  sidebar, and the pressed state stays visible.

The plugin does not classify prompts to choose stages. The first configured
non-Inbox stage is remembered mechanically until an agent runs `bb organizer
phase <stage-key>` or the user moves the thread. Agents autonomously apply the
resolved stage when substantial work changes, including changes that remain
within the same stage; those checkpoints drive batched title reassessment and
never require user permission.

## Use

### Configure

Open Thread Organizer in bb’s plugin settings. The workflow editor lets users:

- rename and re-icon Inbox while leaving its routing protected;
- search and choose from bb’s full semantic icon catalog in a visual picker;
- add, remove, reorder, rename, and re-icon other stages;
- describe what belongs in each stage.

The defaults are Planning, Spec Review, Building, Testing / Deploy, Handoff,
and On Hold. Whenever an agent session starts or resumes, the plugin fills the
bundled skill’s predefined workflow slot from the latest saved configuration.

### Move a thread

Run the configured stage key from inside a bb thread:

```bash
bb organizer phase building
bb organizer phase testing-deploy
bb organizer phase on-hold
```

Inbox is system-managed and cannot be selected by the CLI. The bundled skill
re-evaluates the resolved next concrete action at substantive task start,
indirect kickoffs, scope changes, implementation, validation, failed
validation, and handoff. Internal task plans and `update_plan` do not move the
bb workflow stage; only `bb organizer phase` does. A same-stage refresh
does not move the row, but it does queue a title freshness check.

## Run from this repository

```bash
pnpm exec turbo run typecheck --filter=bb-plugin-thread-organizer-example
pnpm exec turbo run test --filter=bb-plugin-thread-organizer-example
bb plugin install "path:$PWD/examples/plugins/thread-organizer" --yes
```
