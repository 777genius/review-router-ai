import { describe, expect, it, vi } from "vitest";
import { requestWebhookRedeliveryOnce } from "../application/use-cases/request-webhook-redelivery-once";
const identity = {
  appIdentityHash: "d".repeat(64),
  deliveryGuid: "synthetic",
  githubDeliveryId: 42n,
  eventName: "push",
  action: null,
  installationId: null,
  payloadHash: "a".repeat(64),
};
function fixture() {
  return {
    authority: { authorize: vi.fn().mockResolvedValue(true) },
    client: {
      appIdentityHash: identity.appIdentityHash,
      redeliver: vi.fn().mockResolvedValue({ status: 202 }),
    },
    custody: {
      reserve: vi.fn().mockResolvedValue(true),
      accepted: vi.fn().mockResolvedValue(true),
    },
  };
}
describe("single webhook redelivery attempt", () => {
  it("rejects wrong App before reservation or network", async () => {
    const f = fixture();
    f.client.appIdentityHash = "e".repeat(64);
    await expect(requestWebhookRedeliveryOnce(identity, f)).rejects.toThrow(
      "webhook_redelivery_app_identity_mismatch",
    );
    expect(f.custody.reserve).not.toHaveBeenCalled();
    expect(f.client.redeliver).not.toHaveBeenCalled();
  });
  it("does not reserve or post when authoritative eligibility is absent", async () => {
    const f = fixture();
    f.authority.authorize.mockResolvedValue(false);
    expect(await requestWebhookRedeliveryOnce(identity, f)).toBe(
      "not_authorized",
    );
    expect(f.custody.reserve).not.toHaveBeenCalled();
    expect(f.client.redeliver).not.toHaveBeenCalled();
  });
  it("never posts after a denied or uncertain durable reservation", async () => {
    const denied = fixture();
    denied.custody.reserve.mockResolvedValue(false);
    expect(await requestWebhookRedeliveryOnce(identity, denied)).toBe(
      "not_reserved",
    );
    expect(denied.client.redeliver).not.toHaveBeenCalled();
    const lost = fixture();
    lost.custody.reserve.mockRejectedValue(
      new Error("synthetic lost response"),
    );
    expect(await requestWebhookRedeliveryOnce(identity, lost)).toBe("unknown");
    expect(lost.client.redeliver).not.toHaveBeenCalled();
  });
  it("performs one POST and treats 202 as unconfirmed", async () => {
    const f = fixture();
    expect(await requestWebhookRedeliveryOnce(identity, f)).toBe(
      "accepted_unconfirmed",
    );
    expect(f.client.redeliver).toHaveBeenCalledExactlyOnceWith(42n);
    expect(f.custody.accepted).toHaveBeenCalledWith(
      identity,
      f.custody.reserve.mock.calls[0]![1],
    );
  });
  it("leaves unknown after lost POST, non-202, or failed acceptance recording", async () => {
    const lost = fixture();
    lost.client.redeliver.mockRejectedValue(
      new Error("synthetic lost response"),
    );
    expect(await requestWebhookRedeliveryOnce(identity, lost)).toBe("unknown");
    expect(lost.client.redeliver).toHaveBeenCalledOnce();
    expect(lost.custody.accepted).not.toHaveBeenCalled();
    const failure = fixture();
    failure.client.redeliver.mockResolvedValue({ status: 422 });
    expect(await requestWebhookRedeliveryOnce(identity, failure)).toBe(
      "unknown",
    );
    expect(failure.custody.accepted).not.toHaveBeenCalled();
    const persist = fixture();
    persist.custody.accepted.mockRejectedValue(
      new Error("synthetic lost write"),
    );
    expect(await requestWebhookRedeliveryOnce(identity, persist)).toBe(
      "unknown",
    );
    expect(persist.client.redeliver).toHaveBeenCalledOnce();
  });
});
