# `@bb/provider-driver-contract`

Runtime-validated contract for the local connection between the BB host daemon and an isolated agent-provider driver process.

This package currently defines the target protocol and its pure lifecycle validator. No production provider uses it yet. Existing providers continue through `ProviderAdapter` until they are migrated individually.

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

The planned transport is a dedicated duplex process pipe. Frames are:

1. four-byte unsigned big-endian payload length;
2. that many bytes of UTF-8 JSON;
3. a JSON-RPC 2.0 request, response, or notification inside the payload.

Stdout and stderr are diagnostics only. They are never parsed as protocol traffic. A transport implementation must reject a declared frame larger than `PROVIDER_DRIVER_MAX_FRAME_BYTES` before allocating or parsing the complete payload.

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
- `operationId` identifies one mutation. Repeating it with identical input returns the same result; reusing it with different semantics is a protocol violation.

### Turns

- The daemon mints a canonical turn ID before a new turn is submitted.
- `turn.submit` returning `accepted` means the driver owns the input and must either settle the turn or be observed exiting.
- An accepted start returns the requested turn ID with disposition `started`.
- An accepted steer targets the expected active turn and returns disposition `steered` or `queued`.
- Replaying the operation/client request IDs must not duplicate user input.
- A driver SDK must buffer provider events produced during submission until the acceptance response has been written.

### Events

- Events use a sequence that is contiguous and monotonically increasing across one process connection, starting at 1.
- Every event names a daemon-issued attachment. Turn/item events also name a daemon-issued canonical turn.
- An event for an unknown attachment, an unaccepted turn, a completed item, or a settled turn is a protocol violation.
- `turn.settled` is the only top-level terminal turn fact. Exactly one is legal per accepted turn.
- Rate limiting and authentication/provider failures are classifications on a failed settlement. Nonterminal provider retry activity uses `turn.retrying`.
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
