# @bb/plugin-sdk

The typed facade BB plugin authors compile against. Types only at the root
(`BbPluginApi`, the app contract); the `./app` subpath is shimmed by
`bb plugin build` to the host's shared runtime.

## Testing

`./testing` is the official plugin test harness: `createFakePluginHost()`
returns a `bb` satisfying `BbPluginApi` (real better-sqlite3 `:memory:`
storage, host-faithful validation and error shapes, a recordable `bb.sdk`
stub) plus a `harness` that drives rpc/http/cli/services/schedules/settings/
thread events deterministically. `./testing/app` tests a plugin's `app.tsx`
without the bb host: `loadPluginApp()` captures typed slot registrations and
`renderSlot()` mounts a slot with mock hook backends (vitest + jsdom +
Testing Library). See the "Testing a plugin" section of the
bb-plugin-authoring skill for patterns, and
`examples/plugins/slack-bot` and `marketplace/plugins/docs` for working tests.

Workspace/in-repo consumers only for V1: the testing subpaths are not part
of the bundled `.d.ts` that `bb plugin new` ships into scaffolded plugins
(`scripts/build-bundled-dts.mjs` bundles only the root and `./app`
contracts), so standalone plugins outside a checkout cannot use them yet.

## Dependency surface

The root contract preserves the complete `BbPluginApi`, including the full
`BbSdk` and app contract. Its public types reference `hono`,
`better-sqlite3` + `@types/better-sqlite3`, `zod`, and `react` +
`@types/react`; they are optional peers for in-repo consumers. A
`bb plugin new` scaffold declares the type dependencies its bundled `.d.ts`
needs and typechecks them with `skipLibCheck: false`.

The `@bb/*` type dependencies (`@bb/domain`, `@bb/sdk`, `@bb/server-contract`)
are workspace-internal. The scaffold declaration generator flattens them into
portable named DTOs, so generated plugins resolve no workspace packages.
