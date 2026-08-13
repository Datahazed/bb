# bb-plugin-github-notifications

Triage comments, mentions, and reviews on pull requests and issues you authored without leaving BB.

Install it from the BB Official catalog:

```sh
bb plugin install github-notifications
```

## What it does

- Adds a GitHub Activity panel to the BB sidebar.
- Uses one searchable, filterable, sortable table for fast triage.
- Labels every item by resource type, repository, title, update type, actor, and recency.
- Opens each item in a native Browser tab beside the plugin panel.

## Auth

The plugin uses the GitHub CLI credentials already available to BB. If `gh auth status` passes, the feed can load; otherwise authenticate with `gh auth login` and refresh the panel. The plugin does not store a separate token.

## Development

Run the focused checks from the repository root:

```sh
pnpm exec turbo run typecheck test build --filter=bb-plugin-github-notifications
```
