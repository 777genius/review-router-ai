import { Duplex } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderApiKeySecretPutOutcomeUnknownError,
  ProviderApiKeySecretPutPreDispatchError,
} from "@reviewrouter/features-provider-setup";
import { putProviderApiKeySecretExactlyOnce } from "./provider-api-key-github-gateway";

type ProtocolFault = "redirect" | "response_incomplete" | "transport_unknown";

describe("provider API key GitHub secret one-shot transport", () => {
  it.each([
    { baseUrl: "not-a-url", timeoutMs: 250, token: "token" },
    { baseUrl: "http://example.com", timeoutMs: 250, token: "token" },
    { baseUrl: "http://127.0.0.1", timeoutMs: 0, token: "token" },
    {
      baseUrl: "http://127.0.0.1",
      timeoutMs: 250,
      token: "invalid\nheader",
    },
  ])("classifies deterministic failures before dispatch", async (input) => {
    const createConnection = vi.fn(() => {
      throw new Error("transport_must_not_be_constructed");
    });

    await expect(
      putProviderApiKeySecretExactlyOnce(
        {
          baseUrl: input.baseUrl,
          owner: "acme",
          repo: "one",
          secretName: "OPENROUTER_API_KEY",
          encryptedValue: "encrypted-fixture",
          keyId: "key-fixture",
          token: input.token,
          timeoutMs: input.timeoutMs,
        },
        { createConnection },
      ),
    ).rejects.toBeInstanceOf(ProviderApiKeySecretPutPreDispatchError);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it("classifies connection failure before byte flush as pre-dispatch", async () => {
    const wire = new PreDispatchConnectingWire();
    const createConnection = vi.fn(() => wire);

    await expect(
      putProviderApiKeySecretExactlyOnce(
        {
          baseUrl: "http://127.0.0.1",
          owner: "acme",
          repo: "one",
          secretName: "OPENROUTER_API_KEY",
          encryptedValue: "encrypted-fixture",
          keyId: "key-fixture",
          token: "protocol-fixture-token",
          timeoutMs: 250,
        },
        { createConnection },
      ),
    ).rejects.toMatchObject({ outcome: "pre_dispatch_failure" });
    expect(createConnection).toHaveBeenCalledTimes(1);
    expect(wire.requestBytesFlushed).toBe(false);
  });

  it.each([
    ["response_incomplete", "response_incomplete"],
    ["transport_unknown", "transport_unknown"],
  ] as const)(
    "classifies %s after request bytes may have left",
    async (fault, reason) => {
      const wire = new ProtocolWire(fault);
      const createConnection = vi.fn(() => wire);

      await expect(
        putProviderApiKeySecretExactlyOnce(
          {
            baseUrl: "http://127.0.0.1",
            owner: "acme",
            repo: "one",
            secretName: "OPENROUTER_API_KEY",
            encryptedValue: "encrypted-fixture",
            keyId: "key-fixture",
            token: "protocol-fixture-token",
            timeoutMs: 250,
          },
          { createConnection },
        ),
      ).rejects.toMatchObject({
        outcome: "transport_unknown",
        reason,
      });
      expect(createConnection).toHaveBeenCalledTimes(1);
      expect(wire.requestLines()).toEqual([
        "PUT /repos/acme/one/actions/secrets/OPENROUTER_API_KEY HTTP/1.1",
      ]);
    },
  );

  it("returns a redirect status without following or replaying the PUT", async () => {
    const wire = new ProtocolWire("redirect");
    const createConnection = vi.fn(() => wire);

    await expect(
      putProviderApiKeySecretExactlyOnce(
        {
          baseUrl: "http://127.0.0.1",
          owner: "acme",
          repo: "one",
          secretName: "OPENROUTER_API_KEY",
          encryptedValue: "encrypted-fixture",
          keyId: "key-fixture",
          token: "protocol-fixture-token",
          timeoutMs: 250,
        },
        { createConnection },
      ),
    ).resolves.toEqual({ status: 307 });
    expect(createConnection).toHaveBeenCalledTimes(1);
    expect(wire.requestLines()).toEqual([
      "PUT /repos/acme/one/actions/secrets/OPENROUTER_API_KEY HTTP/1.1",
    ]);
  });
});

class PreDispatchConnectingWire extends Duplex {
  connecting = true;
  encrypted = false;
  requestBytesFlushed = false;

  constructor() {
    super();
    queueMicrotask(() => {
      this.destroy(new Error("connection_failed"));
    });
  }

  override _read(): void {}

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    void chunk;
    void encoding;
    void callback;
  }

  setNoDelay(): this {
    return this;
  }

  setKeepAlive(): this {
    return this;
  }
}

class ProtocolWire extends Duplex {
  private written = Buffer.alloc(0);
  private responseDispatched = false;

  constructor(private readonly fault: ProtocolFault) {
    super();
  }

  requestLines(): readonly string[] {
    return this.written
      .toString("latin1")
      .split("\r\n")
      .filter((line) => line.startsWith("PUT "));
  }

  override _read(): void {}

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.written = Buffer.concat([
      this.written,
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding),
    ]);
    callback();
    if (this.fault === "transport_unknown") {
      this.destroy(new Error("connection_closed"));
      return;
    }
    this.dispatchResponseWhenRequestComplete();
  }

  setNoDelay(): this {
    return this;
  }

  setKeepAlive(): this {
    return this;
  }

  private dispatchResponseWhenRequestComplete(): void {
    if (this.responseDispatched) return;
    const source = this.written.toString("latin1");
    const headerEnd = source.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const contentLength = Number(
      /^content-length:\s*(\d+)$/imu.exec(source.slice(0, headerEnd))?.[1] ??
        "0",
    );
    if (this.written.byteLength < headerEnd + 4 + contentLength) return;
    this.responseDispatched = true;
    if (this.fault === "response_incomplete") {
      this.push(
        "HTTP/1.1 201 Created\r\nContent-Length: 10\r\nConnection: close\r\n\r\nabc",
      );
    } else {
      this.push(
        "HTTP/1.1 307 Temporary Redirect\r\nLocation: /must-not-be-requested\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
    }
    this.push(null);
  }
}
