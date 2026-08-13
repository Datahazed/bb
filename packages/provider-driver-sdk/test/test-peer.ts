import { PassThrough } from "node:stream";
import {
  ProviderDriverFrameDecoder,
  encodeProviderDriverFrame,
  providerDriverRpcResponseSchema,
  type ProviderDriverRequest,
  type ProviderDriverRpcResponse,
} from "@bb/provider-driver-contract";
import { vi } from "vitest";

export class ProviderDriverTestPeer {
  readonly driverReadable = new PassThrough();
  readonly driverWritable = new PassThrough();
  readonly messages: unknown[] = [];
  private readonly decoder = new ProviderDriverFrameDecoder();

  constructor() {
    this.driverWritable.on("data", (chunk: Buffer) => {
      this.messages.push(...this.decoder.push(chunk));
    });
  }

  send(message: unknown): void {
    this.driverReadable.write(encodeProviderDriverFrame(message));
  }

  async request(
    request: ProviderDriverRequest,
  ): Promise<ProviderDriverRpcResponse> {
    this.send(request);
    let response: ProviderDriverRpcResponse | null = null;
    await vi.waitFor(() => {
      const index = this.messages.findIndex((message) => {
        const parsed = providerDriverRpcResponseSchema.safeParse(message);
        return parsed.success && parsed.data.id === request.id;
      });
      if (index === -1) {
        throw new Error(`No response for request ${String(request.id)}`);
      }
      const [message] = this.messages.splice(index, 1);
      response = providerDriverRpcResponseSchema.parse(message);
    });
    if (!response) {
      throw new Error(`No response for request ${String(request.id)}`);
    }
    return response;
  }

  async waitForMessageCount(count: number): Promise<void> {
    await vi.waitFor(() => {
      if (this.messages.length < count) {
        throw new Error(
          `Expected ${count} messages, received ${this.messages.length}`,
        );
      }
    });
  }
}
