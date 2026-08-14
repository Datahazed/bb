# @bb/agent-runtime

Manages isolated provider-driver processes (Codex, Claude Code, Pi, and ACP) and exposes a clean session interface. Handles process supervision, framed RPC, canonical lifecycle validation, event projection, tool and interaction routing, crash detection, and shutdown.

Consumers say "start a thread, run a turn, give me events" — they never touch provider processes or wire formats.

## Public API

```typescript
import { createAgentRuntime, listAvailableProviders } from "@bb/agent-runtime";

// Discovery
const providers = listAvailableProviders();   // [{ id: "codex", ... }, { id: "claude-code", ... }, { id: "pi", ... }]

// Runtime — supports multiple providers and threads simultaneously
const runtime = createAgentRuntime({
  workspacePath: "/path/to/workspace",
  env: { OPENAI_API_KEY: "..." },       // passed to all provider processes
  bridgeBundleDir: "/path/to/provider-bundles", // optional; used when provider processes are packaged outside src/dist
  onEvent: (event) => {
    // Every event has event.threadId (bb ID) and event.providerThreadId (provider's internal ID)
    // See ProviderThreadEvent in @bb/domain for the full type
  },
  onToolCall: async (req) => { /* ToolCallRequest → ToolCallResponse */ },
  onStderr: (line) => { /* provider stderr */ },
  onProcessExit: (info) => { /* crash detection */ },
});

// Start a thread, run turns, get events via callbacks
const { providerThreadId } = await runtime.startThread({
  environmentId: "env-1",
  threadId: "t1",
  projectId: "p1",
  providerId: "codex",
  options: { permissionMode: "full", instructions: "Be concise." },
  dynamicTools: [{ name: "my_tool", description: "...", inputSchema: { ... } }],
});

await runtime.runTurn({
  threadId: "t1",
  input: [{ type: "text", text: "Hello" }],
});

// Multiple threads on the same runtime, even across providers
await runtime.startThread({
  environmentId: "env-1",
  threadId: "t2",
  projectId: "p1",
  providerId: "claude-code",
});

// Resume across process lifetimes
await runtime.resumeThread({
  environmentId: "env-1",
  threadId: "t3",
  providerThreadId, // from previous session
  providerId: "codex",
});

await runtime.shutdown();
```

### Event types

Events from provider processes are `ProviderThreadEvent` — they carry both `threadId` (bb ID) and `providerThreadId` (provider's internal ID). Events from the server/system layer are `SystemThreadEvent` — they only have `threadId`. Both are part of the `ThreadEvent` union from `@bb/domain`.

### Fail-fast behavior

The runtime fails fast when providers crash or are unavailable:

- **Binary not found** → `ensureProvider` rejects immediately
- **Crash during initialize** → `ensureProvider` rejects with stderr output
- **Crash during a turn** → pending `runTurn` promise rejects with "exited unexpectedly"
- **Crash between turns** → next `runTurn` call rejects immediately
- **Invalid session identity** → the canonical driver response is rejected at the protocol boundary

### Multi-thread / multi-provider

A single runtime can manage multiple threads across multiple providers simultaneously. Providers that support multiplexing share a process; Codex uses one isolated provider process per live thread. The runtime stamps every event with the correct bb `threadId` and `providerThreadId` regardless of how the provider internally identifies threads.

## Running Tests

```bash
# Unit tests (no credentials needed, uses a canonical fake driver)
pnpm exec turbo run test:unit --filter=@bb/agent-runtime

# Integration tests (requires real provider credentials)
pnpm exec turbo run test:integration --filter=@bb/agent-runtime --force

# All package tests
pnpm exec turbo run test --filter=@bb/agent-runtime --force
```

### Integration test requirements

Codex, Claude Code, and Pi must be authenticated in the current environment before running integration tests. Each provider manages its own credentials (auth files, env vars, etc.). The repeatable live OpenCode ACP check is opt-in:

```bash
BB_TEST_ACP_OPENCODE=1 pnpm exec turbo run test:integration \
  --filter=@bb/agent-runtime --force -- \
  --testNamePattern='^OpenCode live ACP provider' \
  src/integration.acp-opencode.test.ts
```

Set `BB_TEST_ACP_OPENCODE_COMMAND` if `opencode` is not on `PATH`.

### Working with integration tests

Integration tests hit real provider APIs and take 30-60 seconds. Some lessons learned:

**Don't assume provider behavior — test it directly.** Each provider (codex, claude-code, pi) has different concurrency, turn lifecycle, and session resume semantics. When a test fails or hangs, write a small standalone test that probes the provider directly (e.g., "does codex handle two concurrent turns on different threads?") instead of guessing and tweaking timeouts. The `vitest.config.ts` unit test config is handy for running quick one-off investigations since it includes `src/**/*.test.ts`.

**Save output to a file, then read it.** Tests are slow — if you pipe output through `grep` and it doesn't match, you've wasted a full test run. Instead:

```bash
pnpm --filter @bb/agent-runtime test:integration -- --reporter=verbose > /tmp/integ-out.txt 2>&1
# Then inspect:
grep -E "(✓|×|Test Files|Tests )" /tmp/integ-out.txt
```

**Tests run concurrently within each scenario file.** All 3 provider variants in a file run in parallel via `describe.concurrent`. Scenario files run serially because Pi and other real providers share local auth state and external provider limits; running every scenario file at once has caused real-provider flakes where a turn completes without the expected tool execution.

The root `test:integration --force` run also schedules `@bb/integration-tests#test:integration` after `@bb/agent-runtime#test:integration`. Those two package-level suites both exercise real providers and can share local subscription auth/session state, so only the cross-package real-provider suites are ordered. Concurrency inside each suite remains covered, including multi-provider runtime tests and `real/provider-concurrency.test.ts`.

**When a test hangs**, the provider driver or its provider-native child is likely not responding. Common causes:

- Provider protocol validation rejects a request
- Provider needs credentials that aren't in the environment
- Provider process crashed on startup (check captured stderr diagnostics)

### Test coverage

**Unit tests** — runtime lifecycle through a canonical fake driver, multi-thread event routing, multi-provider isolation, tool and interaction round-trips, framed-protocol errors, crash handling, concurrent `ensureProvider` deduplication, resume across runtimes, and canonical event translation.

**Integration tests** exercise the real Codex, Claude Code, and Pi implementations across model discovery, single and follow-up turns, steering, cancellation and recovery, developer instructions, bad-request recovery, dynamic tools, process resume, command output, workspace/environment isolation, and multi-provider concurrency. The opt-in OpenCode ACP test covers model discovery, tool routing, and context-preserving cross-process resume.

### Building

`@bb/agent-runtime` is source-only inside this workspace. The host daemon build
creates the provider-process bundles it needs for runtime startup.

## Architecture

```
Consumer (host-daemon, server)
  │
  └─ createAgentRuntime(options)
       │
       ├─ AgentRuntime                 Thread policy, event projection,
       │   ├─ ensureProvider()         tool routing, process selection
       │   ├─ startThread()           Deduplicates concurrent provider starts.
       │   ├─ runTurn()               Fails fast if provider has crashed.
       │   └─ shutdown()
       │
       ├─ ProviderDriverConnection     Semantic provider operations
       │
       ├─ ProviderDriverSupervisor     Canonical process launch/termination
       │   └─ ProcessProviderDriverConnection
       │       └─ CanonicalProcessProviderConnection
       │           ├─ attachment/operation/turn identity ownership
       │           ├─ canonical event → ThreadEvent projection
       │           ├─ dedicated framed protocol fds and lifecycle validation
       │           └─ bounded requests, timeouts, and diagnostics
       │               ↕ @bb/provider-driver-sdk in canonical children
       │
       └─ Provider Process             isolated provider child process
           ├─ codex               canonical driver → `codex app-server`
           ├─ claude-code         canonical driver → Claude Agent SDK
           ├─ acp-*               canonical driver → ACP-compatible agent
           └─ pi                  canonical driver → Pi coding agent SDK
```

`AgentRuntime` depends on `ProviderDriverConnection`, not provider-specific command-building callbacks. Pi, Claude Code, ACP, and Codex all run through canonical isolated driver processes. Declarative bundled launch specs select each immutable entrypoint and declare whether its process is environment- or thread-scoped; startup verifies that the driver's multiplexing capability matches that declaration. The daemon-side path uses `ProviderDriverSupervisor` and `ProcessProviderDriverConnection` with `@bb/provider-driver-contract`. `CanonicalProcessProviderConnection` adapts that strict peer to the current runtime seam without provider-specific translation: it mints attachment/operation/turn IDs, preserves response-before-event ordering, and projects bounded canonical events. Canonical children use `@bb/provider-driver-sdk` for framing, operation replay, acceptance buffering, event sequencing, and host callbacks. The Codex canonical child supervises its own `codex app-server` subprocess, translates that provider-native newline-delimited protocol, recovers archived sessions, and restarts account-bound app-server state behind the canonical boundary.

## Dependencies

- `@bb/domain` — shared types (ThreadEvent, ProviderThreadEvent, PromptInput, ToolCallRequest, etc.)
- `@bb/templates` — markdown templates for provider instructions
- `@anthropic-ai/claude-agent-sdk` — Claude Code
- `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` — Pi
- `zod` — schema validation at provider boundaries
