import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AccountMetadataAuthorization,
  AccountMetadataObservation,
} from "../ports/account-metadata.js";
import { readAccountMetadata } from "./read-account-metadata.js";

const allowed = (
  accountRef: string,
  ownerRef = "owner",
): AccountMetadataAuthorization => ({
  status: "allowed",
  ownerRef,
  accountRef,
  expectedAuthorizationEpoch: 7,
  displayToken: `fence-${ownerRef}-${accountRef}`,
});
const observation = (accountRef: string): AccountMetadataObservation => ({
  accountRef,
  authorizationEpoch: 7,
  metadataRevision: 4,
  info: {
    status: "available",
    fields: {
      email: {
        status: "known",
        value: `${accountRef}@example.test`,
        source: "provider_api",
        observedAt: "2026-11-19T09:00:00Z",
        freshness: "current",
      },
      accountLabel: { status: "unknown" },
      subscription: { status: "unknown" },
      credentialExpiresAt: { status: "unknown" },
      trainingUsage: { status: "unsupported" },
    },
  },
});
afterEach(() => vi.useRealTimers());
describe("authorized account metadata page", () => {
  it("groups refs by owner without reading a borrower account or changing native freshness", async () => {
    const scopes = new Map<string, AccountMetadataAuthorization>([
      ["a", allowed("a")],
      ["same-source-binding", allowed("a")],
      ["b", allowed("b", "other")],
      ["borrowed", { status: "restricted" }],
    ]);
    const calls: Array<[string, readonly string[]]> = [];
    const result = await readAccountMetadata(
      { connectionIds: [...scopes.keys()], authorize: async () => scopes },
      {
        read: async (owner, refs) => {
          calls.push([owner, refs]);
          return refs.map(observation);
        },
      },
    );
    expect(calls).toEqual([
      ["owner", ["a"]],
      ["other", ["b"]],
    ]);
    expect(result.get("a")).toMatchObject({
      status: "available",
      fields: {
        email: { value: "a@example.test", observedAt: "2026-11-19T09:00:00Z" },
      },
    });
    expect(result.get("same-source-binding")).toEqual(result.get("a"));
    expect(result.get("borrowed")).toEqual({
      status: "restricted",
      displayToken: "restricted",
    });
  });

  it("removes an early row revoked while the last read was pending", async () => {
    const before = new Map([
      ["a", allowed("a")],
      ["b", allowed("b", "other")],
    ]);
    let current = before;
    const result = await readAccountMetadata(
      { connectionIds: ["a", "b"], authorize: async () => current },
      {
        read: async (_owner, refs) => {
          if (refs[0] === "b") {
            await Promise.resolve();
            current = new Map([["b", allowed("b", "other")]]);
          }
          return refs.map(observation);
        },
      },
    );
    expect(result.get("a")).toEqual({
      status: "restricted",
      displayToken: "restricted",
    });
    expect(result.get("b")?.status).toBe("available");
    expect(JSON.stringify([...result.values()])).not.toContain(
      "a@example.test",
    );
  });

  it.each(["owner", "epoch", "token"])(
    "rejects a changed %s after the source read",
    async (changed) => {
      let calls = 0;
      const original = allowed("a");
      if (original.status !== "allowed") throw new Error("fixture");
      const result = await readAccountMetadata(
        {
          connectionIds: ["a"],
          authorize: async () =>
            new Map([
              [
                "a",
                ++calls === 1
                  ? original
                  : {
                      ...original,
                      ...(changed === "owner" ? { ownerRef: "different" } : {}),
                      ...(changed === "epoch"
                        ? { expectedAuthorizationEpoch: 8 }
                        : {}),
                      ...(changed === "token"
                        ? { displayToken: "different-binding" }
                        : {}),
                    },
              ],
            ]),
        },
        { read: async () => [observation("a")] },
      );
      expect(result.get("a")?.status).toBe("restricted");
    },
  );

  it.each(["foreign", "duplicate", "epoch"])(
    "does not project %s source results",
    async (kind) => {
      const value = observation(kind === "foreign" ? "foreign" : "a");
      const result = await readAccountMetadata(
        {
          connectionIds: ["a"],
          authorize: async () => new Map([["a", allowed("a")]]),
        },
        {
          read: async () =>
            kind === "duplicate"
              ? [value, value]
              : [{ ...value, authorizationEpoch: kind === "epoch" ? 8 : 7 }],
        },
      );
      expect(result.get("a")?.status).toBe("unavailable");
    },
  );

  it("splits a full page into bounded batches and never starts provider refresh", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `account-${i}`);
    const batches: number[] = [];
    const result = await readAccountMetadata(
      {
        connectionIds: ids,
        authorize: async () => new Map(ids.map((id) => [id, allowed(id)])),
      },
      {
        read: async (_owner, refs) => {
          batches.push(refs.length);
          return refs.map(observation);
        },
      },
    );
    expect(batches).toEqual([50, 50, 50, 50]);
    expect(
      [...result.values()].filter((value) => value.status === "available"),
    ).toHaveLength(200);
  });

  it("aborts stalled source reads while preserving the final authorization budget", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let authorizations = 0;
    const pending = readAccountMetadata(
      {
        connectionIds: ["a"],
        authorize: async () => {
          authorizations++;
          return new Map([["a", allowed("a")]]);
        },
      },
      {
        read: async (_owner, _refs, received) => {
          signal = received;
          await new Promise<void>((resolve) =>
            received.addEventListener("abort", () => resolve(), { once: true }),
          );
          return [observation("a")];
        },
      },
    );
    await vi.advanceTimersByTimeAsync(2500);
    const result = await pending;
    expect(signal?.aborted).toBe(true);
    expect(authorizations).toBe(2);
    expect(result.get("a")?.status).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("shares the parent page's remaining remote budget and still performs the final authority fence", async () => {
  vi.useFakeTimers();
  const authorize = vi.fn(async () => new Map([["a", allowed("a")]]));
  let signal: AbortSignal | undefined;
  let release!: () => void;
  const pending = readAccountMetadata(
    { connectionIds: ["a"], authorize, deadlineAt: Date.now() + 400 },
    {
      read: async (_owner, _refs, received) => {
        signal = received;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return [observation("a")];
      },
    },
  );
  await vi.advanceTimersByTimeAsync(400);
  const result = await pending;
  expect(result.get("a")?.status).toBe("unavailable");
  expect(signal?.aborted).toBe(true);
  expect(authorize).toHaveBeenCalledTimes(2);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(result.get("a")?.status).toBe("unavailable");
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps local authorization outside the parent optional remote deadline and does not start expired work", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const authorize = vi.fn(async () => {
    await held;
    return new Map([["a", allowed("a")]]);
  });
  const read = vi.fn(async () => [observation("a")]);
  let done = false;
  const pending = readAccountMetadata(
    { connectionIds: ["a"], authorize, deadlineAt: Date.now() + 400 },
    { read },
  ).then((result) => {
    done = true;
    return result;
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(done).toBe(false);
  expect(read).not.toHaveBeenCalled();
  release();
  expect((await pending).get("a")?.status).toBe("unavailable");
  expect(read).not.toHaveBeenCalled();
  expect(authorize).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
