import { PassThrough, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { connectHostedProviderResponseStream } from "./prisma-hosted-codex-relay";

describe("hosted provider response stream lifecycle", () => {
  // Before the fix, the upstream Readable had no error observer, so a client
  // abort after fetch could raise an uncaught exception and kill the API.
  it("forwards an upstream abort into the observed completion pipeline", async () => {
    const source = new PassThrough();
    const completion = new PassThrough();
    const body = connectHostedProviderResponseStream(source, completion);
    const draining = pipeline(
      body,
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
    );

    expect(() =>
      source.emit("error", new Error("relay_client_disconnected")),
    ).not.toThrow();
    await expect(draining).rejects.toThrow("relay_client_disconnected");
    expect(source.destroyed).toBe(true);
    expect(completion.destroyed).toBe(true);
  });

  // The fetch body can fail before the HTTP route has attached pipeline().
  it("observes an upstream error before the downstream consumer attaches", async () => {
    const source = new PassThrough();
    const completion = new PassThrough();
    const body = connectHostedProviderResponseStream(source, completion);
    const closed = new Promise<void>((resolve) => body.once("close", resolve));

    expect(() =>
      source.emit("error", new Error("relay_client_disconnected")),
    ).not.toThrow();
    await closed;
    expect(body.destroyed).toBe(true);
  });

  it("preserves an ordinary streaming response", async () => {
    const source = new PassThrough();
    const completion = new PassThrough();
    const body = connectHostedProviderResponseStream(source, completion);
    const chunks: string[] = [];
    body.on("data", (chunk) => chunks.push(String(chunk)));
    const ended = new Promise<void>((resolve) => body.once("end", resolve));

    source.end("data: ok\n\n");
    await ended;
    expect(chunks.join("")).toBe("data: ok\n\n");
  });
});
