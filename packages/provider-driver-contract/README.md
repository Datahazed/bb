# `@bb/provider-driver-contract`

Runtime-validated contract for the local connection between the BB host daemon and an isolated agent-provider driver process.

This package defines the provider-driver protocol and its pure lifecycle validator. `@bb/provider-driver-sdk` implements the driver side, while `ProcessProviderDriverConnection` and `ProviderDriverSupervisor` implement the host side. Pi, Claude Code, Codex, and ACP all use this canonical path.

## Boundary

```text
Host daemon                         Provider driver child
-------------------------------     ------------------------------
workspace and process safety        provider SDK/CLI integration
canonical session/turn state   <->  provider-native session state
tool/interaction routing            provider event translation
artifact/process supervision         provider persistence and models
```

The driver must translate provider-native behavior before crossing this boundary. Raw SDK events are not canonical lifecycle facts.

## Transport

The transport uses dedicated process pipes (host → driver on child fd 3 and driver → host on child fd 4), forming a duplex channel. Frames are:

1. four-byte unsigned big-endian payload length;
2. that many bytes of UTF-8 JSON;
3. a JSON-RPC 2.0 request, response, or notification inside the payload.

Stdout and stderr are bounded diagnostics only. They are never parsed as protocol traffic. `ProviderDriverFrameDecoder` rejects a declared frame larger than `PROVIDER_DRIVER_MAX_FRAME_BYTES` before buffering or parsing the declared payload. `ProcessProviderDriverConnection` owns request correlation, timeouts, schema validation, and lifecycle enforcement; `ProviderDriverSupervisor` owns process launch, diagnostics, termination, and process-key deduplication.

## Immutable driver artifacts

Artifact format 2 is a gzip tar containing only `driver.ts`,
`driver.meta.json`, and an optional `driver.ts.map`. The entrypoint contains
bundled JavaScript but keeps the `.ts` suffix so extension-capable runtimes can
select their embedded TypeScript module shims without host `node_modules`.
Metadata binds the plugin, plugin version, driver id, Node 22 runtime,
entrypoint, and exact provider-driver
protocol version. The server stores archives by SHA-256; daemons download them
over the authenticated internal transport, verify the digest before extraction,
reject extra paths, links, traversal, duplicates, and size overflows, then
publish a read-only extracted directory. Active driver processes lease their
generation so cache collection cannot remove it.

Mutable provider sessions and configuration never live inside artifact
directories.

## Normative lifecycle rules

### Initialization

- `driver.initialize` is the first request.
- The selected protocol version must be one offered by the daemon.
- The returned plugin, driver, and provider identities must match the expected launch identity.
- An identity or protocol mismatch terminates the child before session work.

### Sessions

- The daemon supplies an opaque `attachmentId` and BB thread ID.
- `session.open` returns one authoritative `providerSessionId`.
- Drivers never reveal session identity later through an event.
- Mutable provider sessions live outside immutable artifact directories.
- Detaching or discarding an idle attachment removes it from connection lifecycle state.
- `operationId` identifies one mutation. Repeating it with identical input returns the same result; reusing it with different semantics is a protocol violation.

### Turns

- The daemon mints a canonical turn ID before a new turn is submitted.
- `turn.submit` returning `accepted` means the driver owns the input and must either settle the turn or be observed exiting.
- An accepted start returns the requested turn ID with disposition `started`.
- An accepted steer targets the expected active turn and returns disposition `steered` or `queued`.
- Replaying the operation/client request IDs must not duplicate user input.
- `@bb/provider-driver-sdk` buffers provider events produced during submission until the acceptance response has been written and deduplicates successful operations for the process generation.

### Events

- Protocol version 6 standardizes each `skillSources[].rootPath` as the root of a staged skill package whose skill folders live under `skills/`, removes provider-shaped skill paths from the host runtime, and carries plan-mode selection as a generic execution feature. The package has no provider-native metadata; each driver prepares any native wrapper it needs. Version 5 marks the release where all non-Codex built-ins use the canonical driver protocol, including ACP. Version 4 added Claude Code's long-lived background-task lifecycle, model-fallback facts, detailed error categories, and HTTP status codes. Version 3 introduced rich canonical item payloads and explicit dynamic-tool status labels; core-owned user messages remain excluded.
- Token usage and compaction are turn-scoped facts; context-window usage is a session-scoped fact. Drivers do not invent a turn scope for session-only state.
- Events use a sequence that is contiguous and monotonically increasing across one process connection, starting at 1.
- Every event names a daemon-issued attachment. Turn/item events also name a daemon-issued canonical turn.
- An event for an unknown attachment, an unaccepted turn, a completed item, or a settled turn is a protocol violation.
- `turn.settled` is the only top-level terminal turn fact. Exactly one is legal per accepted turn.
- Rate limiting and authentication/provider failures are classifications on a failed settlement. Nonterminal provider retry activity uses `turn.retrying`.
- Tool and interaction requests must target the accepted active turn on their attachment.
- Provider-native diagnostics may be logged, but core lifecycle policy must not infer state from them.

### Exit

The host validator knows which accepted turns have not settled. If the process exits, it returns those attachments to generic daemon/server crash reconciliation. There is no provider-specific detach-event reconstruction in the canonical contract.

## Method families

Daemon to driver:

```text
driver.initialize
driver.inspect
driver.shutdown
session.open
session.detach
session.discard
session.rename
session.set_archived
session.compact
session.clear_goal
turn.submit
turn.cancel
```

Driver to daemon:

```text
host.tool.call
host.interaction.request
driver.event
```

Optional session operations return a typed `unsupported` outcome. The host must not parse provider error text to discover capability support.

## Scope still being designed

The initial canonical item event vocabulary intentionally covers lifecycle and streaming primitives rather than every existing provider-specific timeline payload. Before a production provider cutover, its PR-0 behavior matrix must prove that the event union represents every retained behavior. Additions must remain typed; do not introduce an arbitrary raw-provider-event escape hatch.
