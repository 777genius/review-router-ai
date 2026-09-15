import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeAndPutSecret: vi.fn(),
  mapError: vi.fn(() => ({
    status: 400,
    error: "codex_rotating_setup_ledger_invalid",
  })),
}));

vi.mock("../../../../src/server/codex-rotating-setup-ledger", () => ({
  codexRotatingSetupLedger: {
    authorizeAndPutSecret: mocks.authorizeAndPutSecret,
  },
  codexRotatingSetupLedgerHttpError: mocks.mapError,
}));

import { POST } from "./route";

describe("Codex rotating setup dispatch transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not cache malformed JSON responses", async () => {
    const response = await POST(
      new Request(
        "https://reviewrouter.site/api/codex-rotating/setup-dispatch",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not-json",
        },
      ),
    );

    expect(mocks.authorizeAndPutSecret).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("dispatches the encrypted payload through the serialized setup writer", async () => {
    mocks.authorizeAndPutSecret.mockResolvedValueOnce({
      status: "confirmed",
      responseCode: 204,
    });
    const body = {
      claimId: "codex_claim_11111111-1111-4111-8111-111111111111",
      idempotencyKey: "dispatch:test",
      encryptedValue: "ZW5jcnlwdGVk",
      keyId: "github-key-1",
    };

    const response = await POST(
      new Request(
        "https://reviewrouter.site/api/codex-rotating/setup-dispatch",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    );

    expect(response.status).toBe(201);
    expect(mocks.authorizeAndPutSecret).toHaveBeenCalledWith(body);
    expect(await response.json()).toMatchObject({
      status: "confirmed",
      responseCode: 204,
    });
  });
});
