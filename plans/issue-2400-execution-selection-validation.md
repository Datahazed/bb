# Issue 2400: execution-selection validation

## Observed flow

`bb thread spawn` and `sdk.threads.spawn` both POST `/api/v1/threads`. The
server resolves project defaults and the requested environment/machine, asks
that host's existing `provider.list_models` catalog (using the provider's
host/workspace cache scope), then provisions the environment and starts the
thread. Before this change, an explicit or remembered model skipped the catalog
step, so validation happened only inside the provider after the environment,
thread, and first turn already existed.

Tasks presets and Automations store execution tuples in plugin databases.
Their use paths call `sdk.threads.spawn`, while Workflows validate literals at
source validation and validate resolved agent calls again against the origin
environment catalog.

## Initial implementation plan

1. Add failing server-route tests proving invalid model/reasoning inputs create
   no environment, thread, turn, or provider turn command.
2. Put one catalog-aware validator at the server boundary, routed by the exact
   environment host or prospective machine/workspace, and call it from thread
   create before provisioning plus explicit send paths before persistence.
3. Expose the same validation as an experimental SDK method so server plugins
   can validate stored tuples without copying provider policy.
4. Validate Tasks preset and Automation create/update before database writes;
   rely on thread spawn to revalidate dispatch/run after catalog changes.
5. Audit forks, queues/deferred sends, project defaults, workflows, aliases,
   custom models, selected-only models, permission ceilings, and remote hosts.
6. Update CLI help, guides, plugin skills/API audit docs, then run targeted and
   affected-package Turbo checks plus a live CLI reproduction.

## Evidence-driven adjustments

- The current command is `bb tasks preset`, not the issue's older
  `bb dispatch preset` spelling, so the fix targets the Tasks RPC/CLI surface.
- `customModels` is the deliberate allowlist for provider-accepted unlisted
  IDs; arbitrary catalog misses are not universally valid.
- `selectedOnlyModels` remains eligible for inherited/stored selections, while
  explicit spawn/workflow literals use active catalog rows.
- A non-empty `supportedReasoningEfforts` list is authoritative. An empty list
  is unknown support, not “supports no reasoning”; Workflows needed the same
  correction at both validation phases.
- Forks already enter the shared thread-create service. Immediate sends and
  queues with a resolved host validate before a turn is requested; a queue
  admitted before its new environment has a host target is revalidated when it
  drains. Deferred messages needed an admission preflight because their rows
  were otherwise visible before validation.
- Thread execution overrides already load the target environment catalog and
  enforce non-empty per-model reasoning contracts, so no replacement route was
  needed there.
- Live CLI QA found that partial Tasks preset updates carry omitted options as
  explicit `undefined` values. The preflight merge was adjusted to preserve the
  stored provider/model/machine fields, with a regression test for that exact
  request shape, so invalid updates now return the typed catalog error rather
  than a generic required-field error.

## Wire decision

No host-daemon protocol change is required. The server uses the existing
`provider.list_models` host command/result unchanged; the new contract is an
HTTP/SDK server endpoint for plugins. Therefore `HOST_DAEMON_PROTOCOL_VERSION`
is not incremented.
