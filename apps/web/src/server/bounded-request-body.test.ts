import { describe, expect, it, vi } from "vitest";
import {
  readBoundedRequestJson,
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from "./bounded-request-body";

describe("bounded request body", () => {
  it("stops chunked input at the byte limit even when cancel never settles", async () => {
    let pulled = 0;
    const cancelled = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled++;
          controller.enqueue(new Uint8Array(1024));
        },
        cancel: cancelled,
      },
      { highWaterMark: 0 },
    );
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body,
      duplex: "half",
    };
    await expect(
      readBoundedRequestText(
        new Request("https://reviewrouter.test", init),
        2048,
      ),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(pulled).toBe(3);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("rejects a declared oversized body before pulling and cancels its stream", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      { pull, cancel },
      { highWaterMark: 0 },
    );
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body,
      duplex: "half",
      headers: { "content-length": "4096" },
    };
    await expect(
      readBoundedRequestText(
        new Request("https://reviewrouter.test", init),
        2048,
      ),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("accepts exact UTF-8 byte budgets and rejects malformed encoding/JSON", async () => {
    const json = JSON.stringify({ text: "é" });
    await expect(
      readBoundedRequestJson(
        new Request("https://reviewrouter.test", {
          method: "POST",
          body: json,
        }),
        Buffer.byteLength(json),
      ),
    ).resolves.toEqual({ text: "é" });
    await expect(
      readBoundedRequestJson(
        new Request("https://reviewrouter.test", {
          method: "POST",
          body: new Uint8Array([0xff]),
        }),
        10,
      ),
    ).rejects.toThrow();
    await expect(
      readBoundedRequestJson(
        new Request("https://reviewrouter.test", { method: "POST", body: "{" }),
        10,
      ),
    ).rejects.toThrow();
  });
});
