# Thread Hover Cards

Thread Hover Cards previews a sidebar thread's live status, latest agent update, execution details, repository, and pull request without navigating away. It also summarizes collapsed sections so the user can see their working, unread, question, and failure counts without expanding them.

## What it demonstrates

| Surface        | Example behavior                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Content script | Adds keyboard- and pointer-accessible hover cards to existing sidebar rows with complete reload cleanup.               |
| RPC            | Loads bounded thread, timing, pull-request, and section summaries through validated contracts.                         |
| Stable IDs     | Uses persisted section and project IDs without loading the full sidebar bootstrap.                                     |
| BB SDK         | Reads threads, projects, environments, execution options, and pull-request context without adding a public plugin API. |

Hover or focus a thread row to open its card. Hover or focus a stored section header to see its aggregate summary. Built-in groups such as Pinned and Unorganized intentionally do not open section cards.

## Run it

From the repository root:

```bash
pnpm install
pnpm exec turbo run typecheck --filter=bb-plugin-thread-hover-cards
pnpm exec turbo run test --filter=bb-plugin-thread-hover-cards
pnpm exec turbo run build --filter=bb-app
pnpm exec turbo run build --filter=bb-plugin-thread-hover-cards
bb plugin install ./examples/plugins/thread-hover-cards
```

After editing the plugin, run `bb plugin reload thread-hover-cards` or use `bb plugin dev` from this directory.

## Keep the two copies aligned

The standalone plugin lives in the `bb-plugins` repository. This example keeps the authored behavior aligned while retaining its own package configuration, generated SDK types, and build output.

Check the shared source files without changing either checkout:

```bash
pnpm --dir examples/plugins/thread-hover-cards sync:status -- /path/to/bb-plugins
```

The report lists matching, changed, and missing files and prints a focused diff command for the first change. Review and port the authored files it names; do not copy `package.json`, TypeScript or Vitest configuration, `types/`, or `dist/` between repositories.
