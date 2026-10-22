import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  client: vi.fn(),
  gatewayReader: vi.fn(),
  compose: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@agent-teams/account-gateway/http", () => ({
  createAccountLimitsClient: h.client,
}));
vi.mock("@reviewrouter/features-provider-accounts/composition", () => ({
  createAccountLimits: h.compose,
  createGatewayAccountLimitsReader: h.gatewayReader,
}));
import { accountLimitsReader } from "./account-limits-composition";
const settings = {
  role: "management" as const,
  origin: "https://test.invalid",
  token: "TEST-only-token",
};
const target = {
  ownerRef: "owner",
  accountRef: "account",
  profileId: "codex",
  expectedAuthorizationEpoch: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  h.client.mockReturnValue({});
  h.gatewayReader.mockReturnValue({ read: h.read });
  h.compose.mockImplementation(async ({ reader }) => ({ reader }));
  h.read.mockResolvedValue({ status: "unknown" });
});
it("keeps configured cached-reader support behind the feature composition", async () => {
  const reader = await accountLimitsReader(settings);
  expect(await reader.read(target)).toEqual({ status: "unknown" });
  expect(h.read).toHaveBeenCalledWith(target);
  expect(h.client).toHaveBeenCalledWith({
    ...settings,
    timeoutMs: 3000,
    responseBytes: 262144,
  });
  expect(h.compose).toHaveBeenCalledWith({ reader: { read: h.read } });
});
it("keeps quota unavailable when SDK construction fails without failing inventory composition", async () => {
  h.client.mockImplementationOnce(() => {
    throw new Error("secret constructor diagnostic");
  });
  const reader = await accountLimitsReader(settings);
  expect(await reader.read(target)).toEqual({
    status: "unavailable",
    reason: "source_unavailable",
  });
  expect(h.gatewayReader).not.toHaveBeenCalled();
  expect(h.compose).not.toHaveBeenCalled();
  expect(h.read).not.toHaveBeenCalled();
});
it("keeps quota unavailable when feature composition fails without exposing diagnostics", async () => {
  h.compose.mockRejectedValueOnce(new Error("secret assembly diagnostic"));
  const reader = await accountLimitsReader(settings);
  expect(await reader.read(target)).toEqual({
    status: "unavailable",
    reason: "source_unavailable",
  });
  expect(h.read).not.toHaveBeenCalled();
});
