# Plugin environment targets

Source: item 2 of https://gist.github.com/hemaaanth/e7facb84ab768043aa3c27dfdd5cdc5a
(a sandboxes plugin offering Daytona / E2B / Modal as places to run a
thread). Date: 2026-09-01. Baseline `origin/main` @ `e9b376638b`.

Decisions taken (2026-09-01):

- A target selection carries **configuration**: the picker shows a
  target's own configuration control next to it, and the chosen value
  travels with the environment to the plugin.
- bb's own **"New worktree" is the first target**, and it is a real
  first-party plugin (`plugins/worktree`, `defaultEnabled: true` in
  `builtin-registry.ts`), registered through the same call, the same
  decision and the same configuration channel as any plugin target. Its
  configuration control *is* today's "Branch from:" picker. **It
  provisions the worktree itself**, on the machine, through a host worker
  — the plugin creates the worktree, runs its setup script, and later runs
  its teardown script and removes the worktree — so its **settings for the
  setup and teardown script paths** are the plugin's own business and core
  learns nothing about scripts. Local checkout and existing-worktree
  selections are not targets: a target is something that *provisions*;
  those two attach to something that already exists and keep their
  `host`/`reuse` shapes.
- A first-party **Docker sandbox** plugin is the generic example: it makes
  its own machine per thread, is tied to no enrolled host or vendor, and
  ships with pause/resume so it is a copy-from reference, not a toy.
- Declaration and behaviour live in **one registration**: `provision` sits
  on `registerTarget` beside `title`, the way `bb.providers.register`
  carries a provider's declaration and behaviour together. There is no
  second hook name. The decision vocabulary, failure isolation, decision
  box, wait rows and restart re-asking are the ones `message.dispatch`
  already has.

The plan is written from the plugin author's side first. Every API in §1
exists on `main` except the ones marked **NEW**.

## 1. What the plugin author writes

`plugins/docker-sandbox` — the reference plugin. One target with one
configuration field (the image), so the configuration channel is exercised
by the example and not only by the worktree target.

### `server.ts` — provisioning

```ts
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const configurationSchema = z.object({ image: z.string().min(1) });

type Launch =
  | { phase: "starting"; progress: string }
  | { phase: "enrolling"; hostId: string; container: string; progress: string }
  | { phase: "ready"; hostId: string; container: string; path: string }
  | { phase: "failed"; error: string; failedAt: number };

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    providerApiKey: { type: "string", label: "Provider API key for the sandbox", secret: true },
    serverUrl: {
      type: "string",
      label: "bb server URL as seen from a container",
      description: "Defaults to the server's loopback URL with host.docker.internal.",
    },
    idleMinutes: { type: "string", label: "Pause a sandbox after this many idle minutes", default: "10" },
  });

  // NEW. Declaration + behaviour in one place. `defaultConfiguration` is
  // what the picker submits until the configuration control changes it;
  // a target with nothing to configure declares `null`.
  //
  // `provision` is asked on the thread's first dispatch attempt and on
  // every re-attempt (drain, restart, Send now). Answer from remembered
  // state in milliseconds; do the work elsewhere and call
  // `bb.environments.experimental_recheck()` when it advances.
  bb.environments.experimental_registerTarget({
    id: "container",
    title: "Docker container",
    icon: "Container",
    defaultConfiguration: { image: "ghcr.io/get-bb/sandbox:node-22" },
    provision: async ({ thread, project, configuration }) => {
      const parsed = configurationSchema.safeParse(configuration);
      if (!parsed.success) return { action: "reject", message: "Choose a container image." };
      if (project.gitRemoteUrl === null) {
        return { action: "reject", message: "This project has no git remote to clone." };
      }
      const launch = await bb.storage.kv.get<Launch>(`launch:${thread.id}`);
      if (launch === undefined) {
        void startLaunch(thread.id, parsed.data.image, project.gitRemoteUrl);
        return { action: "wait", reason: "Starting container…" };
      }
      switch (launch.phase) {
        case "starting":
        case "enrolling":
          return { action: "wait", reason: launch.progress };
        case "failed":
          // The row's sendAt is the retry timer; Send now re-asks sooner.
          return { action: "wait", reason: `Failed: ${launch.error}`, sendAt: launch.failedAt + 30_000 };
        case "ready":
          return {
            action: "ready",
            environment: {
              type: "host",
              hostId: launch.hostId,
              workspace: { type: "unmanaged", path: launch.path },
            },
          };
      }
    },
  });

  async function startLaunch(threadId: string, image: string, remote: string) {
    const key = `launch:${threadId}`;
    const container = `bb-sandbox-${threadId}`;
    try {
      await bb.storage.kv.set(key, { phase: "starting", progress: "Starting container…" });
      const { providerApiKey, serverUrl } = await settings.get();
      // The join-code route pre-creates the host row, so the id is known
      // before the daemon connects.
      const { joinCode, hostId } = await bb.sdk.hosts.createJoinCode();
      await docker("run", "-d", "--name", container,
        "-e", `BB_SERVER_URL=${serverUrl ?? defaultServerUrl(bb.server.loopbackBaseUrl)}`,
        "-e", `BB_HOST_ENROLL_KEY=${joinCode}`,
        "-e", `BB_HOST_NAME=${container}`,
        "-e", `ANTHROPIC_API_KEY=${providerApiKey}`,
        image, "bb-app", "host-daemon");
      await bb.storage.kv.set(key, { phase: "enrolling", hostId, container, progress: "Waiting for the container to enroll…" });
      await bb.environments.experimental_recheck();

      await waitUntil(async () => (await bb.sdk.hosts.get({ hostId })).status === "connected");
      await docker("exec", container, "git", "clone", remote, "/workspace");
      await bb.storage.kv.set(key, { phase: "ready", hostId, container, path: "/workspace" });
      await bb.storage.kv.set(`host:${hostId}`, { container, state: "running" });
    } catch (error) {
      await bb.storage.kv.set(key, {
        phase: "failed",
        error: error instanceof Error ? error.message : String(error),
        failedAt: Date.now(),
      });
    }
    await bb.environments.experimental_recheck();
  }
```

### `server.ts` — after provisioning: pause and resume

None of this touches the new API. It is the existing `message.dispatch`
hook and thread events, which is the point: a target owns *provisioning*
and nothing after it.

```ts
  type Sandbox = { container: string; state: "running" | "paused" | "resuming" };

  // RESUME. The hook runs before every attempt — inline sends included,
  // which matters because an inline send to a disconnected host is
  // otherwise a 502 to the caller ("Host daemon is not connected"); the
  // `host-offline` queue wait only appears when a *drain* meets an offline
  // host. `join-turn` cannot happen on a paused host (nothing is running).
  bb.experimental_hooks.on("message.dispatch", async ({ host, attempt }) => {
    if (host === null || attempt === "join-turn") return { action: "proceed" };
    const sandbox = await bb.storage.kv.get<Sandbox>(`host:${host.id}`);
    if (sandbox === undefined || host.status === "connected") return { action: "proceed" };
    if (sandbox.state !== "resuming") {
      await bb.storage.kv.set(`host:${host.id}`, { ...sandbox, state: "resuming" });
      void resume(host.id, sandbox);
    }
    return { action: "wait", reason: "Resuming sandbox…" };
  });

  async function resume(hostId: string, sandbox: Sandbox) {
    await docker("start", sandbox.container); // the entrypoint restarts the daemon,
    // which reconnects with its persisted auth state — no new join code.
    await waitUntil(async () => (await bb.sdk.hosts.get({ hostId })).status === "connected");
    await bb.storage.kv.set(`host:${hostId}`, { ...sandbox, state: "running" });
    await bb.experimental_hooks.recheck("message.dispatch");
  }

  // PAUSE. Mark idleness per host on thread.idle, clear it on thread.active,
  // and let a durable sweep act — cron over in-memory timers so a server
  // restart does not lose a pending pause.
  bb.events.on("thread.idle", async ({ thread }) => {
    if (thread.environmentId === null) return;
    const { hostId } = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    if ((await bb.storage.kv.get(`host:${hostId}`)) !== undefined) {
      await bb.storage.kv.set(`idle:${hostId}`, Date.now());
    }
  });
  bb.events.on("thread.active", async ({ thread }) => {
    if (thread.environmentId === null) return;
    const { hostId } = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    await bb.storage.kv.delete(`idle:${hostId}`);
  });

  bb.background.schedule("pause-idle-sandboxes", "* * * * *", async () => {
    const { idleMinutes } = await settings.get();
    const running = await bb.sdk.threads.listRunning();   // rows are { id, hostId }
    const busy = new Set(running.map((row) => row.hostId));
    const queued = await bb.sdk.threads.queue.list();      // anything about to dispatch
    for (const key of await bb.storage.kv.list("idle:")) {
      const hostId = key.slice("idle:".length);
      const idleSince = await bb.storage.kv.get<number>(key);
      const sandbox = await bb.storage.kv.get<Sandbox>(`host:${hostId}`);
      if (idleSince === undefined || sandbox === undefined || sandbox.state !== "running") continue;
      if (busy.has(hostId) || queued.some((row) => rowIsOnHost(row, hostId))) continue;
      if (Date.now() - idleSince < Number(idleMinutes) * 60_000) continue;
      await docker("stop", sandbox.container);
      await bb.storage.kv.set(`host:${hostId}`, { ...sandbox, state: "paused" });
      await bb.storage.kv.delete(key);
    }
  });
```

`listRunning` rather than the plugin's own bookkeeping keeps a second
thread on the same sandbox (an environment reuse) awake; the queue check
keeps a scheduled message due in a minute from paying a resume. Preserve
vs. snapshot is the provider's business: a paused VM thaws the daemon and
provider session intact; a stopped container restarts the daemon from its
entrypoint and the next turn resumes the provider session from its on-disk
files, exactly as bb does after a daemon restart on a laptop. There is no
"thread viewed" event, so resume happens on send, with the wait reason
covering the latency.

### `server.ts` — teardown

```ts
  // The launch ends when the thread goes away or the user deletes the
  // waiting first message (NEW event, §5).
  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => teardown(thread.id));
  }
  bb.events.on("message.cancelled", ({ entry }) => teardown(entry.threadId));

  async function teardown(threadId: string) {
    const launch = await bb.storage.kv.get<Launch>(`launch:${threadId}`);
    if (launch === undefined) return;
    await bb.storage.kv.delete(`launch:${threadId}`);
    if ("container" in launch) await docker("rm", "-f", launch.container);
    if ("hostId" in launch) {
      await bb.storage.kv.delete(`host:${launch.hostId}`);
      await bb.storage.kv.delete(`idle:${launch.hostId}`);
      await bb.sdk.hosts.delete({ hostId: launch.hostId });
    }
  }
}
```

The image is the plugin's problem, and the README says what it must
contain: `bb-app` (from the server's own `/install/bb-app.tgz`), git, and
the provider CLI the user will pick; the daemon is the entrypoint so
`docker start` brings it back. Networking assumption, stated in the README:
on Docker Desktop `host.docker.internal` reaches the server's loopback
bind; on Linux the server must listen on a reachable address
(`BB_SERVER_BIND_HOST`) and the setting overrides the URL.

### `app.tsx`

```tsx
import { experimental_registerEnvironmentTargetConfiguration } from "@get-bb/plugin-sdk/app";

// NEW — the control the picker renders next to this target. `value` is the
// configuration that will be submitted; `onChange(null)` blocks submit with
// "Configure Docker container".
experimental_registerEnvironmentTargetConfiguration({
  targetId: "container",
  component: ({ value, onChange }) => (
    <ImageSelect value={readImage(value)} onChange={(image) => onChange(image ? { image } : null)} />
  ),
});
```

### What the author gets without writing it

The thread exists and is open from the moment the user presses Enter; the
queued card reads "Held by Docker sandbox · Starting container…" and
updates on every `recheck`; a failure is the card's line with a countdown;
Send now retries at once; a server restart re-asks and the plugin answers
from `kv`; the concurrency limiter and every other `message.dispatch` hook
run after the environment exists, against the real host; a message to a
paused sandbox shows "Resuming sandbox…" instead of failing; Delete /
archive tear the container down.

### Test, with the existing harness (no Docker needed)

```ts
const { bb, harness } = createFakePluginHost({ settings: { providerApiKey: "k" } });
await plugin(bb);
const target = harness.registrations.environmentTargets["container"]!;   // NEW harness field
expect(await target.provision(ctx({ image: "img" }))).toEqual({ action: "wait", reason: "Starting container…" });
// fake `docker` + drive harness.sdk hosts.get to "connected" …
expect(await target.provision(ctx({ image: "img" }))).toMatchObject({ action: "ready" });
expect(await target.provision(ctx(null))).toMatchObject({ action: "reject" });

const dispatch = harness.registrations.hooks["message.dispatch"]!;
expect(await dispatch(dispatchCtx({ hostStatus: "disconnected" }))).toMatchObject({ action: "wait" });
expect(await dispatch(dispatchCtx({ hostStatus: "connected" }))).toEqual({ action: "proceed" });

await harness.emitThreadEvent("thread.idle", { thread, lastAssistantText: null });
// advance time, run the "pause-idle-sandboxes" schedule via harness.registrations.schedules …
await harness.emitThreadEvent("message.cancelled", { entry });
```

## 2. The worktree target, written the same way

`plugins/worktree` — first-party, enabled by default, and the reason the
plugin path gets exercised on every New Thread. It is a plugin in the full
sense: it does the provisioning, not just the deciding. Its host entry
runs on the chosen machine (the same `bb.host` mechanism keep-awake uses to
own a child process there) and reuses `@bb/host-workspace` — the package
the daemon's own provisioning is built from — so nothing is duplicated:
`fetchRemoteBaseBranch`, `createWorktree`, `runSetupScript`,
`runTeardownScript`, `removeWorktree`.

### `server.ts`

```ts
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { worktreeHostContract } from "./contract.js"; // create / teardown methods, Standard Schema

type Launch =
  | { phase: "creating"; progress: string }
  | { phase: "ready"; path: string }
  | { phase: "failed"; error: string; failedAt: number };

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    setupScript: {
      type: "string", label: "Setup script", default: ".bb-env-setup.sh",
      description: "Path relative to the worktree root, run after the worktree is created.",
    },
    teardownScript: {
      type: "string", label: "Teardown script", default: ".bb-env-teardown.sh",
      description: "Path relative to the worktree root, run before the worktree is removed.",
    },
  });
  const host = bb.hosts.experimental_client({ contract: worktreeHostContract });

  bb.environments.experimental_registerTarget({
    id: "worktree",
    title: "New worktree",
    icon: "GitBranch",
    // NEW flag: the picker lists this target once per enrolled machine and
    // pre-fills `configuration.hostId`; the control beside it completes the
    // rest. A target that makes its own machine (Docker sandbox) omits it.
    hostScoped: true,
    defaultConfiguration: null,
    provision: async ({ thread, project, configuration }) => {
      const parsed = worktreeConfigurationSchema.safeParse(configuration); // { hostId, baseBranch }
      if (!parsed.success) return { action: "reject", message: "Choose a base branch." };
      const launch = await bb.storage.kv.get<Launch>(`launch:${thread.id}`);
      if (launch === undefined) {
        void create(thread.id, project.id, parsed.data);
        return { action: "wait", reason: "Creating worktree…" };
      }
      switch (launch.phase) {
        case "creating":
          return { action: "wait", reason: launch.progress };
        case "failed":
          return { action: "wait", reason: `Failed: ${launch.error}`, sendAt: launch.failedAt + 30_000 };
        case "ready":
          return {
            action: "ready",
            environment: {
              type: "host",
              hostId: parsed.data.hostId,
              workspace: { type: "unmanaged", path: launch.path },
            },
          };
      }
    },
  });

  async function create(threadId: string, projectId: string, c: { hostId: string; baseBranch: BaseBranchSpec }) {
    const key = `launch:${threadId}`;
    try {
      await bb.storage.kv.set(key, { phase: "creating", progress: "Creating worktree…" });
      const { setupScript } = await settings.get();
      const { path } = await host.call(c.hostId, "create", {
        projectId, threadId, baseBranch: c.baseBranch, setupScript,
        onProgress: (text) => bb.storage.kv.set(key, { phase: "creating", progress: text }).then(() => bb.environments.experimental_recheck()),
      });
      await bb.storage.kv.set(key, { phase: "ready", path });
    } catch (error) {
      await bb.storage.kv.set(key, { phase: "failed", error: String(error), failedAt: Date.now() });
    }
    await bb.environments.experimental_recheck();
  }

  // Teardown when the last live thread leaves the worktree — the plugin
  // owns what core's "managed" lifecycle did for it, because core never
  // deletes an unmanaged path.
  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, async ({ thread }) => {
      if (thread.environmentId === null) return;
      const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
      const mine = await bb.storage.kv.get<{ path: string }>(`environment:${environment.id}`);
      if (mine === undefined) return;
      const live = (await bb.sdk.threads.list({ projectId: thread.projectId, archived: false }))
        .filter((row) => row.environmentId === environment.id);
      if (live.length > 0) return;
      const { teardownScript } = await settings.get();
      await host.call(environment.hostId, "teardown", { path: mine.path, teardownScript });
      await bb.storage.kv.delete(`environment:${environment.id}`);
    });
  }
  bb.events.on("message.cancelled", ({ entry }) => bb.storage.kv.delete(`launch:${entry.threadId}`));
}
```

`host.ts` is the host entry (`experimental_defineHostEntry`): `create`
calls `fetchRemoteBaseBranch` + `createWorktree` + `runSetupScript` from
`@bb/host-workspace` under the request's abort signal and returns the
path; `teardown` calls `runTeardownScript` + `removeWorktree`. Both are
what the daemon runs today, called from a plugin instead.

### `app.tsx`

```tsx
import {
  experimental_BranchPicker, // NEW export: the host's branch picker with its options loading
  experimental_registerEnvironmentTargetConfiguration,
} from "@get-bb/plugin-sdk/app";

experimental_registerEnvironmentTargetConfiguration({
  targetId: "worktree",
  component: ({ projectId, value, onChange }) => {
    const { hostId, baseBranch } = readConfiguration(value);
    return (
      <experimental_BranchPicker
        hostId={hostId}
        projectId={projectId}
        value={baseBranch}
        onChange={(next) => onChange({ hostId, baseBranch: next })}
      />
    );
  },
});
```

### What this means for core

Nothing about scripts. No new columns, no new command fields, no protocol
bump: the setting is read by the plugin and handed to its own host entry.
The environment core records at admission is an ordinary unmanaged one
(`direct-unmanaged` intent, `environmentId` created with the path), so
existing-worktree reuse, diff, commit and PR actions work on it unchanged.

What the plugin takes over from core's managed lifecycle, because an
unmanaged path is never touched by core: cleanup when the last live thread
leaves (above), and there is no reprovision/retire for these worktrees
until the plugin offers them. Core's managed-worktree provisioning stays
for the inputs that still produce `host/managed-worktree` (stored
automation requests, `project-default` resolution) and becomes deletable
once those are switched to the target — a follow-up that is net deletion.

## 3. What the user does

Pick "New worktree" or "Docker container" in the New Thread picker, set the
control beside it (branch / image), type, Enter. `bb thread spawn --target
docker-sandbox/container --target-config '{"image":"…"}'`;
`--new-environment worktree --base-branch main` keeps working and produces
the worktree target. A plugin-hosted `experimental_NewThreadComposer` and
automations get it through the same environment value.

## 4. What core adds

Four SDK members, all `experimental_` with `docs/api_to_audit.md` entries:

**`bb.environments.experimental_registerTarget({ id, title, icon, hostScoped, defaultConfiguration, provision })`**
(backend). Held per plugin like `bb.providers.register` registrations,
cleared on dispose; registering an id twice replaces. `hostScoped: true`
means the picker lists the target once per enrolled machine and pre-fills
`configuration.hostId`. `GET /system/environment-targets` serves
`{ pluginId, targetId, title, icon, hostScoped, defaultConfiguration }[]`.
There is one registry and one registration path; core registers nothing
itself. Like providers, thread creation waits for plugin registrations to
settle (`whenRegistrationsSettled`) before resolving a target.

```ts
provision(context: {
  thread: ThreadResponse; project: Project;
  configuration: JsonValue; queuedMessage: ThreadQueuedMessage | null;
}): Decision | Promise<Decision>
type Decision =
  | { action: "ready"; environment: CreateThreadEnvironmentArgs /* host | reuse */ }
  | { action: "wait"; reason: string; sendAt?: number | null }
  | { action: "reject"; message: string };
```

Invoked through `invokeHook` with the same 10s decision box and fail-closed
rule as `message.dispatch`; the wait row is the same `plugin` wait. Core
asks only the target the intent names. If that plugin is not running, core
cannot fail open (there is nothing to run on), so it records a plugin wait
with a core-authored reason ("Docker container is not available") and a
backoff `sendAt`.

**`bb.environments.experimental_recheck()`** (backend). Asks core to
re-attempt this plugin's waiting rows now — a queue drain, exactly what
`experimental_hooks.recheck` does.

**`experimental_BranchPicker`** (app). The host's branch picker with its
branch-options loading, props `{ hostId, projectId, value, onChange }` —
the same additive-versioning exception as `experimental_ProviderModelPicker`.

**`experimental_registerEnvironmentTargetConfiguration({ targetId, component })`**
(app). Component props `{ projectId: string | null; value: JsonValue | null;
onChange(next: JsonValue | null): void }`. Rendered by the picker row when
that target is selected; `null` blocks submit with "Configure <title>".
Absent registration → the target's `defaultConfiguration` is submitted
unchanged.

Testing kit: `FakePluginRegistrations.environmentTargets` (id → the
registration) and a `recheckCount` that also counts
`experimental_recheck`.

Everything else is existing machinery:

| Need | Already exists |
|---|---|
| the queued row, its card, `bb thread queue` | `waitingOn: { kind: "plugin", pluginId, reason }` |
| retry timer / retry now | the row's `sendAt` + due sweep / Send now |
| restart | the row and `pending_start_context` persist; the next attempt re-asks |
| plugin uninstalled mid-wait | orphan sweep releases its rows; the re-attempt hits the "not available" rule |
| resume before a send | `message.dispatch` hook (§1) |
| pause when idle | `thread.idle` / `thread.active` events + `bb.background.schedule` (§1) |

Where core asks: `dispatch-attempt.ts`, step 1 (core waits), on a first
dispatch whose start-context intent is `plugin-target`, **before** the
`message.dispatch` pass. `ready` resolves the returned args with the same
placement resolution creation uses (`resolveEnvironmentPlacement`, lifted
out of `createThreadFromRequest`), writes the resolved intent and
`environmentId` in one transaction, and the same attempt continues into
step 2. `wait` records the plugin wait; `reject` uses the existing
verbatim-message path.

Creating the thread before a host exists:

1. `createThreadEnvironmentArgsSchema` (`packages/server-contract/src/api/shared.ts`)
   gets a fourth member, `{ type: "plugin-target", pluginId, targetId,
   configuration: JsonValue }`, beside `reuse`, `host`, `project-default`.
   `threads.spawn`, `bb thread spawn`, `NewThreadRequest`, automations and
   workflows carry this union, so they all accept it. `host` stays accepted
   on input: stored automation requests and `project-default` resolution
   keep working unchanged.
2. `threadProvisionEnvironmentIntentSchema` (`thread-provisioning-context.ts`)
   gets the matching member. `intentHostId` reads `configuration.hostId`
   for a `hostScoped` target and returns null otherwise — one rule, so the
   concurrency limiter keeps counting a cold worktree start against its
   pool exactly as today and sees no host for a sandbox until `ready`.
3. Creation skips `ensureHostSessionReadyForWork` and the model catalog when
   the intent has no host (`resolveSystemProviderModels` lists models
   through a host's provider CLI, `hostId: string`). The execution tuple
   comes from the request's explicit `model` or the project's remembered
   defaults (`resolveCatalogExecutionDefaults` already returns early for
   both); 400 `model_required` with neither. A `hostScoped` target keeps the
   host, so worktree's catalog path is untouched.

Picker: `EnvironmentPicker` lists targets from `/system/environment-targets`
in place of the per-host "New worktree" rows (a `hostScoped` target still
gets one row per host — the row's value becomes `target:worktree/worktree`
with `{ hostId }` pre-filled and the target's control completing it); `environment-picker-value.ts` grows
`target:<pluginId>/<targetId>` with configuration held beside the value in
`useThreadCreationOptions`; `new-thread-environment-seed.ts` round-trips
it. `resolveRootComposeThreadEnvironment` and the fork flow, which submit
`host/managed-worktree` today, switch to the target so there is one
producer. No daemon message changes → no `HOST_DAEMON_PROTOCOL_VERSION`
bump.

## 5. Cancellation

Today Stop is a no-op on a `pending` thread (`stopThreadForCurrentState`
finds no live runtime, no provisioning context, and `pending` is not a
pre-start status). A waiting first message ends by Delete on its card, or by
archiving/deleting the thread; the plugin sees the last two as events but
cannot see a Delete. So: one new post-commit event, `message.cancelled:
{ entry }`, fired when a queued row is removed before dispatch (the delete
route and the orphan sweep). Making Stop on a `pending` thread delete its
rows is a follow-up.

## 6. Tests

- worktree through the target: New Thread → `target:worktree/worktree` +
  branch → `provision` waits, the host entry creates the worktree and runs
  the setup script, `ready` → thread `starting` on an unmanaged
  environment at that path; `bb thread spawn --new-environment worktree`
  produces the same request; fork and root-compose defaults produce it;
  the concurrency limiter still sees the host on the cold start.
- `plugins/worktree` harness: `reject` on bad configuration; the settings'
  paths reach the host call; teardown runs only when the last live thread
  on the environment archives (`experimental_createHostEntryHarness` for
  the host side).
- plugin target: spawn → `pending`, `environmentId` null, `provision` asked
  once with `configuration`, row `waitingOn.kind === "plugin"`; no
  `message.dispatch` hook ran. `ready` → placement written, next
  `message.dispatch` sees the host; `wait`+`sendAt` → due sweep re-asks; Send
  now / `experimental_recheck` re-ask; `reject` → message errors with the
  text; plugin not running → "not available" wait; `provision` throws →
  fail-closed; restart → re-asked.
- configuration: `onChange(null)` blocks submit with the reason; absent
  registration submits `defaultConfiguration`; seed round-trip;
  `--target-config` parse.
- `message.cancelled` fires on Delete and on orphan-sweep removal.
- docker-sandbox harness: the §1 test — provision phases, reject on bad
  configuration, resume-wait on a disconnected host and proceed on a
  connected one, pause only when the host is idle past the timeout and
  absent from `listRunning` and the queue, teardown on all three events.
  A manual smoke on Docker Desktop is documented in its README.

## 7. Surfaces in the same PR

`docs/api_to_audit.md` (four entries); `docs/worktrees.md` and
`docs/configuration.md` point at the plugin's settings; `packages/plugin-api-map/src/surfaces.ts`
("Environment targets" card under headless); `bb-plugin-authoring`
references; `bb-guide-threads.md` + `bb-cli` skill for `--target` /
`--target-config`; `scripts/bump-plugin-sdk.mjs --patch`.

## 8. Landing

Two PRs, sequential, both today:

1. Core + `plugins/worktree`: union member + intent + creation + the
   registry + `provision` invocation + `experimental_recheck` +
   `/system/environment-targets` + `hostScoped` picker rows + configuration
   slot + `experimental_BranchPicker` + `message.cancelled` + testing-kit
   fields + the worktree plugin (server, host entry, app) with its
   settings. Green when every existing worktree test passes through the
   target path.
2. `plugins/docker-sandbox` with provisioning, pause/resume, teardown, its
   harness test and README.

## 9. Not in this plan

Attach/create SDK methods, idempotency keys, composer locks, submit guards,
draft handoff (gist items 1, 3–6). Local checkout and existing-worktree as
targets (they do not provision). `availability` on targets: a plugin
declares its target when configured and answers `reject` otherwise. A
"thread viewed" event for resume-on-open.

## Implementation notes (2026-09-01, PR 1)

Built as planned, with these deliberate deviations to keep the branch safe:

- The picker's per-host "New worktree" rows switch to the `worktree/worktree`
  target only when that target is registered; unregistered (plugin disabled)
  they behave exactly as before. Root compose's default-environment
  resolution, fork seeds, and `bb thread spawn --new-environment worktree`
  still produce `host/managed-worktree` args, which remain accepted input.
  Making the target the only producer — and then deleting core's managed
  worktree provisioning — is the follow-up.
- The worktree plugin provisions to
  `<hostDataDir>/plugins/worktree/worktrees/<threadId>/<repo>` on branch
  `bb/<threadId>` and records an ordinary unmanaged environment, so
  reprovision/retire do not exist for plugin-created worktrees yet.
  `createWorktree` is idempotent on the existing path+branch, which is what
  makes restart recovery a simple re-kick.
- `message.cancelled` fires from the queued-message delete route (the user's
  Delete); rows consumed by dispatch or removed with their thread do not fire
  it.
- The API landed as `bb.experimental_environments` (property prefixed, per
  the AGENTS.md experimental rule) rather than the plan's
  `bb.environments.experimental_*` spelling.
- `plugins/docker-sandbox` is PR 2, unchanged.

## Implementation notes (2026-09-01, PR 2 — the cutover)

Branch `bb/worktree-cutover`, stacked on PR 1. All worktree code now lives
in the plugin:

- **The shim**: `rewriteManagedWorktreeEnvironment` at the create boundary
  and `rewriteLegacyManagedStartIntent` at the dispatch checkpoint. Every
  producer — picker, root-compose default, parent inheritance, forks,
  `--new-environment worktree`, stored automations, and pre-cutover pending
  threads — lands on the worktree target. A disabled worktree plugin means
  no worktrees (same rule as provider plugins); the wait card names it.
- **Generic primitives**: `GET /environments` + `DELETE /environments/:id`
  (new `destroy.recorded` lifecycle transition, live-thread SQL guard,
  personal refused), `sdk.environments.list/delete`, `bb environment
  list/delete`.
- **The plugin owns lifecycle**: readable `bb/<title-slug>` branch names
  with collision retry; row finalization after teardown; adoption of
  core-created managed rows (kv record OR `managed &&
  workspaceProvisionType === "managed-worktree"`; user checkouts and
  personal rows never touched); a 5-minute retire grace with a per-minute
  sweep that also adopts orphaned rows continuously; `thread.deleted`
  tears down immediately.
- **Deleted from core** (~5,100 lines): managed reprovision
  ("Restoring environment" and the queued replay), the whole
  retire/destroy pipeline and its sweeps, the managed provisioning arm and
  prepared-environment machinery, branch-slug inference and metadata
  transcripts, the daemon's `environment.destroy` command and the
  managed-worktree arm of `environment.provision`.
  `HOST_DAEMON_PROTOCOL_VERSION` 176 → 177.
- **Contract relaxation**: a queued row's `content` may be empty — a fork
  clone waiting on its environment starts a turn with no message of its
  own; user-facing routes still refuse to queue or edit a message down to
  nothing.
- **Host-entry build rule** (found by CI, fixed on PR 1): host entries may
  bundle `@bb/*` workspace packages that resolve for the plugin — the same
  rule server entries always had; unresolvable ones keep the guidance
  error. This is what lets the plugin's host entry share
  `@bb/host-workspace` with the daemon instead of duplicating it.
- **Known deltas**, deliberate: branch names come from the title/fallback
  slug at provision time (no post-title rename; core's inference machinery
  is gone); worktree creates sit `pending` with a wait card instead of
  `starting` with streamed provisioning steps; rows wedged in `error` are
  no longer auto-restored on send (`throwEnvironmentNotReady` instead) —
  re-asking a target for a dead environment is the follow-up if wanted.

## Implementation notes (2026-09-01, launch log)

The cutover's "coarser progress" delta is closed by the launch log: core
records every change of a `wait` decision's `reason` as a step, `wait` and
`ready` carry an optional multi-line `log` for output deltas, and the capped
per-launch log (steps survive, oldest output drops first) rides the pending
start context. When the thread starts, the log becomes the opening entries
of its workspace-setup timeline block — prepended to the provisioning run's
first event, or written as its own completed provisioning event for the one
admission shape with no run (reuse of a ready environment). The worktree
plugin streams `createWorktree`/setup-script progress off the host entry
into `ready.log`, so setup output is back in the timeline, after the fact
rather than live.
