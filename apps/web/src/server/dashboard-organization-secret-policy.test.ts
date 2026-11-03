import { describe, expect, it, vi } from "vitest";
import {
  createOrganizationSecretPolicyLoader,
  type OrganizationSecretPolicyInput,
} from "./dashboard-organization-secret-policy";

const organization = {
  accountLogin: "Example",
  accountType: "Organization",
  githubInstallationId: 17n,
} as const satisfies OrganizationSecretPolicyInput;

describe("dashboard organization plan metadata boundary", () => {
  it("does not query GitHub for users or other non-organizations", async () => {
    const readPlan = vi.fn().mockResolvedValue({ name: "Team" });
    const load = createOrganizationSecretPolicyLoader({ readPlan });
    expect(await load({ ...organization, accountType: "User" })).toBeNull();
    expect(readPlan).not.toHaveBeenCalled();
  });

  it("coalesces concurrent requests and normalizes plan names", async () => {
    let finish!: (value: unknown) => void;
    const readPlan = vi.fn().mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          finish = resolve;
        }),
    );
    const load = createOrganizationSecretPolicyLoader({ readPlan });
    const first = load(organization);
    const second = load({ ...organization, accountLogin: "EXAMPLE" });
    await Promise.resolve();
    expect(readPlan).toHaveBeenCalledTimes(1);
    finish({ name: " Team " });
    const expected = {
      planName: "team",
      privateRepositoriesAvailable: true,
      status: "available",
    };
    expect(await first).toEqual(expected);
    expect(await second).toEqual(expected);
  });

  it("caches successful plan metadata for five minutes, then refreshes", async () => {
    let time = 1000;
    const readPlan = vi.fn().mockResolvedValue({ name: "free" });
    const load = createOrganizationSecretPolicyLoader({
      readPlan,
      now: () => time,
    });
    expect(await load(organization)).toEqual({
      planName: "free",
      privateRepositoriesAvailable: false,
      status: "available",
    });
    time += 299_999;
    await load(organization);
    expect(readPlan).toHaveBeenCalledTimes(1);
    time++;
    await load(organization);
    expect(readPlan).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])(
    "uses a shorter permission cache for GitHub %i, without granting access",
    async (status) => {
      let time = 0;
      const readPlan = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("denied"), { status }));
      const load = createOrganizationSecretPolicyLoader({
        readPlan,
        now: () => time,
      });
      expect(await load(organization)).toEqual({
        planName: null,
        privateRepositoriesAvailable: null,
        status: "permission_required",
      });
      time = 29_999;
      await load(organization);
      expect(readPlan).toHaveBeenCalledTimes(1);
      time = 30_000;
      await load(organization);
      expect(readPlan).toHaveBeenCalledTimes(2);
    },
  );

  it("retries malformed, unknown and non-permission failures after five seconds", async () => {
    let time = 0;
    const readPlan = vi
      .fn()
      .mockResolvedValueOnce({ name: " " })
      .mockRejectedValueOnce(
        Object.assign(new Error("unavailable"), { status: 500 }),
      )
      .mockResolvedValue({ name: "enterprise" });
    const load = createOrganizationSecretPolicyLoader({
      readPlan,
      now: () => time,
    });
    expect((await load(organization))?.status).toBe("unknown");
    time = 5_000;
    expect((await load(organization))?.status).toBe("unknown");
    time = 10_000;
    expect((await load(organization))?.planName).toBe("enterprise");
    expect(readPlan).toHaveBeenCalledTimes(3);
  });

  it("evicts the least recently used entry within the configured capacity", async () => {
    const readPlan = vi.fn().mockResolvedValue({ name: "team" });
    const load = createOrganizationSecretPolicyLoader({
      readPlan,
      capacity: 2,
    });
    const forId = (id: bigint) => ({
      ...organization,
      githubInstallationId: id,
    });
    await load(forId(1n));
    await load(forId(2n));
    await load(forId(1n));
    await load(forId(3n));
    await load(forId(2n));
    expect(readPlan).toHaveBeenCalledTimes(4);
  });

  it("does not let an evicted in-flight request overwrite a newer entry", async () => {
    let finishFirst!: (value: unknown) => void;
    let finishNewer!: (value: unknown) => void;
    let firstOrganizationReads = 0;
    const readPlan = vi.fn().mockImplementation(({ githubInstallationId }) => {
      if (githubInstallationId !== 1n) return Promise.resolve({ name: "free" });
      firstOrganizationReads++;
      return new Promise<unknown>((resolve) => {
        if (firstOrganizationReads === 1) finishFirst = resolve;
        else finishNewer = resolve;
      });
    });
    const load = createOrganizationSecretPolicyLoader({
      readPlan,
      capacity: 1,
    });
    const first = load({ ...organization, githubInstallationId: 1n });
    await Promise.resolve();
    await load({ ...organization, githubInstallationId: 2n });
    const newer = load({ ...organization, githubInstallationId: 1n });
    await Promise.resolve();
    finishNewer({ name: "enterprise" });
    expect((await newer)?.planName).toBe("enterprise");
    finishFirst({ name: "team" });
    expect((await first)?.planName).toBe("team");
    expect(
      (await load({ ...organization, githubInstallationId: 1n }))?.planName,
    ).toBe("enterprise");
    expect(readPlan).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid capacity rather than silently growing without bound", () => {
    const readPlan = vi.fn().mockResolvedValue({ name: "team" });
    expect(() =>
      createOrganizationSecretPolicyLoader({ readPlan, capacity: 0 }),
    ).toThrow("organization_secret_policy_cache_capacity_invalid");
  });
});
