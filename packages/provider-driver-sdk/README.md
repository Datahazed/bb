# `@bb/provider-driver-sdk`

Driver-side runtime for BB's canonical isolated provider protocol.

The SDK owns:

- framed JSON-RPC parsing and bounded writes on dedicated process fds 3/4;
- initialization and identity negotiation;
- operation-ID replay without duplicate provider input;
- canonical event sequencing, validation, and pre-acceptance buffering;
- host tool and interaction request correlation;
- lifecycle validation and fatal protocol containment.

A driver supplies provider-specific behavior:

```ts
import {
  defineProviderDriver,
  serveProviderDriverProcess,
} from "@bb/provider-driver-sdk";

const driver = defineProviderDriver({
  identity: { pluginId: "example", driverId: "example", providerId: "example" },
  processCapabilities: { multiplexSessions: true },
  inspect: async () => ({
    /* canonical inspection */
  }),
  openSession: async (params) => ({
    providerSessionId: params.bbThreadId,
    sessionFormatVersion: null,
  }),
  detachSession: async () => ({ providerCheckpointId: null }),
  discardSession: async () => {},
  submitTurn: async (params) => ({
    outcome: "accepted",
    disposition: "started",
    turnId: params.mode === "start" ? params.turnId : params.expectedTurnId,
    providerTurnId: null,
  }),
  cancelTurn: async () => ({ outcome: "cancellation_requested" }),
});

serveProviderDriverProcess(driver);
```

Provider work that can synchronously emit events must be registered before
`submitTurn` returns. The SDK buffers those events until the acceptance response
has been written. Host tool and interaction calls require an already accepted
active turn and therefore must run after acceptance.
