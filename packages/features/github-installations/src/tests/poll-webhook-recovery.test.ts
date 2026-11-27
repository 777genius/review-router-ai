import { describe, expect, it, vi } from "vitest";
import { pollWebhookRecovery } from "../application/use-cases/poll-webhook-recovery";
const identity = {
  appIdentityHash: "d".repeat(64),
  deliveryGuid: "synthetic",
  githubDeliveryId: 42n,
  eventName: "push",
  action: null,
  installationId: null,
  payloadHash: "a".repeat(64),
};
const options = { maxPolls: 2, maxPages: 2, delayMs: 0 };
function fixture() {
  return {
    client: {
      appIdentityHash: identity.appIdentityHash,
      scanAttempts: vi.fn().mockResolvedValue({
        state: "observed",
        pages: 1,
        matchingAttempts: 1,
      }),
    },
    custody: { confirm: vi.fn().mockResolvedValue(false) },
  };
}
describe("bounded webhook recovery polling", () => {
  it("does not mistake observed GitHub attempts for receiver completion", async () => {
    const f = fixture();
    expect(await pollWebhookRecovery(identity, f, options)).toEqual({
      state: "pending",
      polls: 2,
      observedAttempts: 1,
    });
  });
  it("stops as soon as exact receiver completion is confirmed", async () => {
    const f = fixture();
    f.custody.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await pollWebhookRecovery(identity, f, options)).toEqual({
      state: "confirmed",
      polls: 1,
      observedAttempts: 1,
    });
    expect(f.client.scanAttempts).toHaveBeenCalledOnce();
  });
  it("stops on rate limit and does not issue repeated requests", async () => {
    const f = fixture();
    f.client.scanAttempts.mockResolvedValue({
      state: "rate_limited",
      pages: 0,
      matchingAttempts: 0,
    });
    expect((await pollWebhookRecovery(identity, f, options)).state).toBe(
      "rate_limited",
    );
    expect(f.client.scanAttempts).toHaveBeenCalledOnce();
  });
  it("does not start a scan when cancellation arrives during confirmation", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.custody.confirm.mockImplementation(async () => {
      controller.abort();
      return false;
    });
    expect(
      await pollWebhookRecovery(identity, f, {
        ...options,
        signal: controller.signal,
      }),
    ).toEqual({ state: "cancelled", polls: 0, observedAttempts: 0 });
    expect(f.client.scanAttempts).not.toHaveBeenCalled();
  });
  it("reports cancellation during the final scan without another confirmation", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.client.scanAttempts.mockImplementation(async () => {
      controller.abort();
      return { state: "observed", pages: 1, matchingAttempts: 1 };
    });
    expect(
      await pollWebhookRecovery(identity, f, {
        ...options,
        maxPolls: 1,
        signal: controller.signal,
      }),
    ).toEqual({ state: "cancelled", polls: 1, observedAttempts: 1 });
    expect(f.custody.confirm).toHaveBeenCalledOnce();
    expect(f.client.scanAttempts).toHaveBeenCalledWith(
      identity,
      options.maxPages,
      controller.signal,
    );
  });
  it.each(["confirmation", "scan"] as const)(
    "reports cancellation when %s rejects after abort",
    async (operation) => {
      const f = fixture();
      const controller = new AbortController();
      const rejectingOperation =
        operation === "confirmation"
          ? f.custody.confirm
          : f.client.scanAttempts;
      rejectingOperation.mockImplementation(async () => {
        controller.abort();
        throw new Error("synthetic aborted operation");
      });
      expect(
        await pollWebhookRecovery(identity, f, {
          ...options,
          signal: controller.signal,
        }),
      ).toEqual({ state: "cancelled", polls: 0, observedAttempts: 0 });
      expect(f.custody.confirm).toHaveBeenCalledOnce();
      expect(f.client.scanAttempts).toHaveBeenCalledTimes(
        operation === "confirmation" ? 0 : 1,
      );
    },
  );
  it("preserves proven completion when cancellation arrives during confirmation", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.custody.confirm.mockImplementation(async () => {
      controller.abort();
      return true;
    });
    expect(
      await pollWebhookRecovery(identity, f, {
        ...options,
        signal: controller.signal,
      }),
    ).toEqual({ state: "confirmed", polls: 0, observedAttempts: 0 });
    expect(f.client.scanAttempts).not.toHaveBeenCalled();
  });
  it("fails closed on wrong App, unavailable evidence and cancellation", async () => {
    const f = fixture();
    await expect(
      pollWebhookRecovery(
        { ...identity, appIdentityHash: "e".repeat(64) },
        f,
        options,
      ),
    ).rejects.toThrow("webhook_recovery_poll_invalid");
    f.custody.confirm.mockRejectedValue(new Error("synthetic"));
    expect((await pollWebhookRecovery(identity, f, options)).state).toBe(
      "incomplete",
    );
    const signal = AbortSignal.abort();
    expect(
      (await pollWebhookRecovery(identity, fixture(), { ...options, signal }))
        .state,
    ).toBe("cancelled");
  });
});
