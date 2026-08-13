import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const PROTOCOL_VERSION = 3;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export function encodeProviderDriverFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export function createProviderDriverFrameDecoder(onMessage) {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32BE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) {
        throw new Error(`Invalid provider driver frame length ${length}`);
      }
      if (buffered.length < length + 4) return;
      const payload = buffered.subarray(4, length + 4);
      buffered = buffered.subarray(length + 4);
      onMessage(JSON.parse(payload.toString("utf8")));
    }
  };
}

export async function driverArtifactDigest(driverPath) {
  return createHash("sha256")
    .update(await readFile(driverPath))
    .digest("hex");
}

export function createProviderDriverSmokePeer({ childProcess, label, output }) {
  const writable = childProcess.stdio[3];
  const readable = childProcess.stdio[4];
  if (!writable || !readable) {
    throw new Error(`${label} did not expose protocol fds 3/4`);
  }
  let nextRequestId = 1;
  const pending = new Map();
  const notifications = [];
  const requests = [];
  const decode = createProviderDriverFrameDecoder((message) => {
    if (message && message.method === "driver.event") {
      notifications.push(message.params);
      return;
    }
    if (message && message.id !== undefined && message.method) {
      requests.push(message);
      return;
    }
    const waiter = message && pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(
        new Error(
          `${message.error.message}: ${JSON.stringify(message.error.data)}`,
        ),
      );
    } else {
      waiter.resolve(message.result);
    }
  });
  readable.on("data", (chunk) => {
    try {
      decode(chunk);
    } catch (error) {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    }
  });

  function write(message) {
    writable.write(encodeProviderDriverFrame(message));
  }

  function request(method, params, timeoutMs = 10_000) {
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            `${label} timed out waiting for ${method}; exit=${childProcess.exitCode ?? childProcess.signalCode ?? "running"}\nstderr:\n${output.stderr}\nstdout:\n${output.stdout}`,
          ),
        );
      }, timeoutMs);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timeout);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timeout);
          reject(error);
        },
      });
      write({ jsonrpc: "2.0", id, method, params });
    });
  }

  async function waitFor({ predicate, timeoutMs = 10_000 }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = notifications.find(predicate);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`${label} timed out waiting for driver event`);
  }

  async function handleHostRequests(handler) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const message = requests.shift();
      if (!message) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        continue;
      }
      write({ jsonrpc: "2.0", id: message.id, result: await handler(message) });
      return message;
    }
    throw new Error(`${label} timed out waiting for host request`);
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    request,
    waitFor,
    handleHostRequests,
    close() {
      writable.end();
    },
    notifications,
  };
}
