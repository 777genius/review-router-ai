import { afterEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { AccountView } from "./account-gateway-accounts";
import { createAccountLimitsService } from "./account-limits-service";
const source = {
  id: "source",
  ownerUserId: "user",
  ownerWorkspaceId: null,
  gatewayAccountRef: "native",
  profileRef: "codex",
  state: "active",
  authorizationEpochMirror: 4n,
  pendingSourceOperationId: null,
  role: null,
  bindingId: null,
  bindingRevision: null,
};
function account(connectionId: string): AccountView {
  return {
    connectionId,
    label: "TEST account",
    profileId: "codex",
    profileLabel: "Codex",
    state: "active",
    gatewayRevision: 1,
    mirrorRevision: 1,
    binding: null,
  };
}
function fixture() {
  const read = vi.fn().mockResolvedValue({
    status: "snapshot",
    physicalGeneration: "private-generation",
    principalVersion: "private-principal",
    revision: 2,
    scope: "account",
    windows: [
      {
        id: "primary",
        family: "codex",
        durationSeconds: 18000,
        usedPercent: 37.5,
        observedAt: "2026-10-22T10:00:00Z",
        resetAt: "2026-10-22T12:00:00Z",
        basis: "duration",
      },
    ],
  });
  const db = vi.fn().mockResolvedValue([source]);
  const authorize = vi.fn().mockResolvedValue({ userId: "user" });
  const ownerRef = vi.fn(() => "owner");
  const service = createAccountLimitsService({
    prisma: { $queryRaw: db } as unknown as PrismaClient,
    reader: { read },
    secret: "test-only-secret",
    authorize,
    ownerRef,
    now: () => new Date("2026-10-22T10:01:00Z"),
  });
  return { service, read, db, authorize, ownerRef };
}
afterEach(() => vi.useRealTimers());
it("derives canonical owner/profile/epoch and returns only safe numeric projection", async () => {
  const { service, read } = fixture();
  const result = await service.read("source");
  expect(read).toHaveBeenCalledWith({
    ownerRef: "owner",
    accountRef: "native",
    profileId: "codex",
    expectedAuthorizationEpoch: 4,
  });
  expect(result).toMatchObject({
    status: "ok",
    value: {
      status: "snapshot",
      windows: [{ usedPercent: 37.5, remainingPercent: 62.5 }],
    },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private-generation|private-principal|native/,
  );
});
it.each([
  { ownerUserId: null, ownerWorkspaceId: "operator", role: "admin" },
  { ownerUserId: "donor", ownerWorkspaceId: null, role: "admin" },
  { ownerUserId: null, ownerWorkspaceId: "org", role: "member" },
])(
  "recipient/admin/member never invokes native quota reader",
  async (ownership) => {
    const { service, read, db, authorize } = fixture();
    authorize.mockResolvedValue({ userId: "user", workspaceId: "org" });
    db.mockResolvedValue([{ ...source, ...ownership }]);
    expect(await service.read("binding")).toMatchObject({
      status: "ok",
      value: { status: "restricted" },
    });
    expect(read).not.toHaveBeenCalled();
  },
);
it("organization owner/admin may read their own suspended source", async () => {
  const { service, read, db, authorize } = fixture();
  authorize.mockResolvedValue({ userId: "user", workspaceId: "org" });
  db.mockResolvedValue([
    {
      ...source,
      ownerUserId: null,
      ownerWorkspaceId: "org",
      role: "admin",
      state: "suspended",
    },
  ]);
  expect(await service.read("source")).toMatchObject({
    status: "ok",
    value: { status: "snapshot" },
  });
  expect(read).toHaveBeenCalledOnce();
});
it.each(["source", "binding"])(
  "personal owners keep their limits in an authorized workspace page through the %s ID",
  async (connectionId) => {
    const { service, read, db, authorize, ownerRef } = fixture();
    authorize.mockResolvedValue({ userId: "user", workspaceId: "org" });
    db.mockResolvedValue([
      { ...source, role: "admin", bindingId: "binding", bindingRevision: 1 },
    ]);
    expect(await service.page([account(connectionId)])).toMatchObject([
      {
        connectionId,
        limits: {
          status: "snapshot",
          windows: [{ remainingPercent: 62.5 }],
        },
      },
    ]);
    expect(read).toHaveBeenCalledOnce();
    expect(ownerRef).toHaveBeenCalledWith({ kind: "user", userId: "user" });
  },
);
it.each([
  "state",
  "profileRef",
  "authorizationEpochMirror",
  "ownerUserId",
  "pendingSourceOperationId",
] as const)("rejects %s changes during native read", async (field) => {
  const { service, read, db } = fixture();
  read.mockImplementation(async () => {
    db.mockResolvedValue([
      {
        ...source,
        [field]: field === "authorizationEpochMirror" ? 5n : "changed",
      },
    ]);
    return { status: "unknown" };
  });
  expect(await service.read("source")).toEqual({ status: "denied" });
});
it.each(["role", "bindingRevision"] as const)(
  "revalidates organization %s after awaited read",
  async (field) => {
    const { service, read, db, authorize } = fixture();
    const organization = {
      ...source,
      ownerUserId: null,
      ownerWorkspaceId: "org",
      role: "admin",
      bindingRevision: 1,
    };
    authorize.mockResolvedValue({ userId: "user", workspaceId: "org" });
    db.mockResolvedValue([organization]);
    read.mockImplementation(async () => {
      db.mockResolvedValue([
        { ...organization, [field]: field === "role" ? "member" : 2 },
      ]);
      return { status: "unknown" };
    });
    expect(await service.read("source")).toEqual({ status: "denied" });
  },
);
it("deleted/cross-tenant IDs and lost membership never return quota", async () => {
  const { service, read, db } = fixture();
  db.mockResolvedValue([]);
  expect(await service.read("foreign")).toEqual({ status: "denied" });
  expect(read).not.toHaveBeenCalled();
  db.mockResolvedValue([source]);
  read.mockImplementation(async () => {
    db.mockResolvedValue([]);
    return { status: "unknown" };
  });
  expect(await service.read("source")).toEqual({ status: "denied" });
});
it.each([
  { pendingSourceOperationId: "reconnect" },
  { state: "disabled" },
  { state: "pending" },
  { authorizationEpochMirror: null },
])(
  "does not inherit cached quota across unavailable lifetime",
  async (changes) => {
    const { service, read, db } = fixture();
    db.mockResolvedValue([{ ...source, ...changes }]);
    expect(await service.read("source")).toMatchObject({
      status: "ok",
      value: {
        status:
          changes.authorizationEpochMirror === null ? "unavailable" : "unknown",
      },
    });
    expect(read).not.toHaveBeenCalled();
  },
);
it("isolates partial deadline and limits concurrency to four without starting more work after deadline", async () => {
  vi.useFakeTimers();
  const { service, read } = fixture();
  read.mockImplementation(() => new Promise(() => {}));
  const page = service.page(
    Array.from({ length: 25 }, (_, id) => account(`s${id}`)),
  );
  await vi.advanceTimersByTimeAsync(3000);
  expect(await page).toHaveLength(25);
  expect(read).toHaveBeenCalledTimes(4);
  expect(
    (await page).every((row) => row.limits?.status === "unavailable"),
  ).toBe(true);
});

it.each(["generation change", "database failure"] as const)(
  "revalidates a completed numeric row after another account consumes the page deadline (%s)",
  async (change) => {
    vi.useFakeTimers();
    const { service, read, db } = fixture();
    const original = await read();
    read
      .mockImplementationOnce(async () => original)
      .mockImplementation(() => new Promise(() => {}));
    const page = service.page([account("source"), account("stalled")]);
    await vi.advanceTimersByTimeAsync(10);
    if (change === "database failure") db.mockRejectedValue(new Error("down"));
    else db.mockResolvedValue([{ ...source, authorizationEpochMirror: 5n }]);
    await vi.advanceTimersByTimeAsync(2990);
    expect(await page).toMatchObject([
      { limits: { status: "unavailable" } },
      { limits: { status: "unavailable" } },
    ]);
  },
);
