import type { Writable } from "node:stream";
import {
  ProviderDriverLifecycle,
  encodeProviderDriverFrame,
  providerDriverEventSchema,
  type ProviderDriverEvent,
} from "@bb/provider-driver-contract";
import type {
  ProviderDriverEventEmitter,
  ProviderDriverEventInput,
} from "./define-provider-driver.js";

const MAX_QUEUED_PROVIDER_DRIVER_FRAMES = 2_048;
const MAX_QUEUED_PROVIDER_DRIVER_FRAME_BYTES = 32 * 1024 * 1024;
const MAX_BARRIERED_PROVIDER_DRIVER_EVENTS = 1_024;

interface QueuedFrame {
  readonly bytes: Uint8Array;
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** A bounded, ordered writer shared by responses, events, and host requests. */
export class ProviderDriverMessageWriter {
  private readonly onError: (error: Error) => void;
  private readonly queue: QueuedFrame[] = [];
  private readonly writable: Writable;
  private closed = false;
  private queuedBytes = 0;
  private writing = false;

  constructor(args: { onError: (error: Error) => void; writable: Writable }) {
    this.onError = args.onError;
    this.writable = args.writable;
    this.writable.on("error", this.handleStreamError);
  }

  send(message: unknown): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("Provider driver output is closed"));
    }

    let bytes: Uint8Array;
    try {
      bytes = encodeProviderDriverFrame(message);
    } catch (error) {
      return Promise.reject(toError(error));
    }
    if (
      this.queue.length >= MAX_QUEUED_PROVIDER_DRIVER_FRAMES ||
      this.queuedBytes + bytes.length > MAX_QUEUED_PROVIDER_DRIVER_FRAME_BYTES
    ) {
      const error = new Error("Provider driver output queue limit exceeded");
      this.fail(error);
      return Promise.reject(error);
    }

    return new Promise<void>((resolve, reject) => {
      this.queue.push({ bytes, reject, resolve });
      this.queuedBytes += bytes.length;
      this.pump();
    });
  }

  async end(): Promise<void> {
    if (this.closed) return;
    while (this.writing || this.queue.length > 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.closed = true;
    this.writable.off("error", this.handleStreamError);
    await new Promise<void>((resolve) => this.writable.end(resolve));
  }

  fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.writable.off("error", this.handleStreamError);
    for (const frame of this.queue.splice(0)) {
      frame.reject(error);
    }
    this.queuedBytes = 0;
    // The server reports the failure through its fatal-error channel. Destroy
    // without an emitted stream error so a detached protocol fd cannot create
    // an uncaught exception in the driver process.
    this.writable.destroy();
  }

  private readonly handleStreamError = (error: Error): void => {
    this.fail(error);
    this.onError(error);
  };

  private pump(): void {
    if (this.closed || this.writing) return;
    const frame = this.queue.shift();
    if (!frame) return;
    this.writing = true;
    this.writable.write(frame.bytes, (error) => {
      this.writing = false;
      this.queuedBytes -= frame.bytes.length;
      if (error) {
        frame.reject(error);
        this.fail(error);
        this.onError(error);
        return;
      }
      frame.resolve();
      this.pump();
    });
  }
}

interface EventBarrier {
  readonly accepted: Promise<boolean>;
  readonly events: ProviderDriverEvent[];
  readonly settle: (accepted: boolean) => void;
}

/** Assigns event sequences and holds events behind command-acceptance barriers. */
export class ProviderDriverEventWriter implements ProviderDriverEventEmitter {
  private readonly barriers = new Map<string, EventBarrier>();
  private readonly lifecycle: ProviderDriverLifecycle;
  private readonly onError: (error: Error) => void;
  private readonly writer: ProviderDriverMessageWriter;
  private barrieredEventCount = 0;
  private nextSequence = 1;

  constructor(args: {
    lifecycle: ProviderDriverLifecycle;
    onError: (error: Error) => void;
    writer: ProviderDriverMessageWriter;
  }) {
    this.lifecycle = args.lifecycle;
    this.onError = args.onError;
    this.writer = args.writer;
  }

  emit(event: ProviderDriverEventInput): void {
    try {
      const validated = providerDriverEventSchema.parse({
        ...event,
        sequence: this.nextSequence,
      });
      const barrier = this.barriers.get(validated.attachmentId);
      if (barrier) {
        if (this.barrieredEventCount >= MAX_BARRIERED_PROVIDER_DRIVER_EVENTS) {
          throw new Error("Provider driver acceptance event buffer is full");
        }
        barrier.events.push(validated);
        this.barrieredEventCount += 1;
        return;
      }
      this.dispatch(validated);
    } catch (error) {
      this.onError(toError(error));
    }
  }

  beginAcceptanceBarrier(attachmentId: string): void {
    if (this.barriers.has(attachmentId)) {
      this.onError(
        new Error(
          `Provider driver attachment ${attachmentId} already has an acceptance barrier`,
        ),
      );
      return;
    }
    let settle = (_accepted: boolean): void => {};
    const accepted = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    this.barriers.set(attachmentId, { accepted, events: [], settle });
  }

  waitForAcceptance(attachmentId: string): Promise<boolean> | null {
    return this.barriers.get(attachmentId)?.accepted ?? null;
  }

  close(): void {
    for (const barrier of this.barriers.values()) {
      barrier.settle(false);
    }
    this.barriers.clear();
    this.barrieredEventCount = 0;
  }

  releaseAcceptanceBarrier(args: {
    attachmentId: string;
    emitBufferedEvents: boolean;
  }): void {
    const barrier = this.barriers.get(args.attachmentId);
    if (!barrier) {
      this.onError(
        new Error(
          `Provider driver attachment ${args.attachmentId} has no acceptance barrier`,
        ),
      );
      return;
    }
    this.barriers.delete(args.attachmentId);
    this.barrieredEventCount -= barrier.events.length;
    barrier.settle(args.emitBufferedEvents);
    if (!args.emitBufferedEvents && barrier.events.length > 0) {
      this.onError(
        new Error(
          `Provider driver emitted ${barrier.events.length} events before rejecting attachment ${args.attachmentId}`,
        ),
      );
      return;
    }
    if (!args.emitBufferedEvents) return;
    for (const event of barrier.events) {
      this.dispatch(event);
    }
  }

  abandonAcceptanceBarrier(attachmentId: string): void {
    const barrier = this.barriers.get(attachmentId);
    if (!barrier) return;
    this.barriers.delete(attachmentId);
    this.barrieredEventCount -= barrier.events.length;
    barrier.settle(false);
    if (barrier.events.length > 0) {
      this.onError(
        new Error(
          `Provider driver emitted ${barrier.events.length} events before command failure on attachment ${attachmentId}`,
        ),
      );
    }
  }

  private dispatch(template: ProviderDriverEvent): void {
    try {
      const event = providerDriverEventSchema.parse({
        ...template,
        sequence: this.nextSequence,
      });
      this.lifecycle.recordEvent(event);
      this.nextSequence += 1;
      void this.writer
        .send({ jsonrpc: "2.0", method: "driver.event", params: event })
        .catch((error: unknown) => this.onError(toError(error)));
    } catch (error) {
      this.onError(toError(error));
    }
  }
}
