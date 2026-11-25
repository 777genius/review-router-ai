import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  mapError: vi.fn(() => ({ status: 400, error: "invalid_request" })),
}));

vi.mock("../../../../src/server/codex-rotating-setup-ledger", () => ({
  codexRotatingSetupLedger: { prepare: mocks.prepare },
  codexRotatingSetupLedgerHttpError: mocks.mapError,
}));

import { POST } from "./route";

describe("Codex rotating setup prepare transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects oversized streamed input without invoking setup admission", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(550_001));
      },
      cancel: cancelled,
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body,
      duplex: "half",
    };
    const response = await POST(
      new Request(
        "https://reviewrouter.org/api/codex-rotating/setup-prepare",
        init,
      ),
    );
    expect(response.status).toBe(413);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("preserves the setup payload envelope budget", async () => {
    const payload = { encryptedValue: "a".repeat(1_000_000), keyId: "key" };
    mocks.prepare.mockResolvedValueOnce({
      status: "prepared",
      claimId: "claim",
    });
    const response = await POST(
      new Request("https://reviewrouter.org/api/codex-rotating/setup-prepare", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("does not cache malformed JSON", async () => {
    const response = await POST(
      new Request("https://reviewrouter.org/api/codex-rotating/setup-prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );

    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.mapError).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_json" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
