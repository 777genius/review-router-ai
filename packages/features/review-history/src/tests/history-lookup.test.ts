import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createPrismaHistoryReader } from "../adapters/outbound/prisma-history-reader.js";
import {
  HistoryAccessError,
  HistoryValidationError,
} from "../domain/history.js";

const input = {
  actorId: "member",
  workspaceId: "workspace",
  pullRequests: [{ scmRepositoryIdentityId: "scm", pullRequestNumber: 7 }],
};
function fixture() {
  const query = vi.fn();
  query.mockResolvedValueOnce([{ allowed: true }]);
  query.mockResolvedValueOnce([{ id: "capture_v1" }]);
  const events: string[] = [];
  const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
    try {
      const result = await run({ $queryRaw: query });
      events.push("commit");
      return result;
    } catch (error) {
      events.push("rollback");
      throw error;
    }
  });
  return {
    query,
    events,
    transaction,
    reader: createPrismaHistoryReader({
      $transaction: transaction,
    } as unknown as PrismaClient),
  };
}
const storageError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("private storage diagnostic", {
    code,
    clientVersion: "7.8.0",
    ...(meta ? { meta } : {}),
  });
describe("History optional lookup failure boundary", () => {
  it("rolls back an admitted projection failure before returning unavailable", async () => {
    const f = fixture();
    f.query.mockRejectedValueOnce(storageError("P2010", { code: "57014" }));
    await expect(f.reader.resolvePullRequests(input)).resolves.toEqual({
      state: "unavailable",
    });
    expect(f.events).toEqual(["rollback"]);
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });
  it("recognizes the structured Prisma7 pg adapter SQLSTATE without parsing diagnostic messages", async () => {
    const f = fixture();
    f.query.mockRejectedValueOnce(
      storageError("P2010", {
        driverAdapterError: {
          cause: { kind: "postgres", code: "57014", originalCode: "57014" },
        },
      }),
    );
    await expect(f.reader.resolvePullRequests(input)).resolves.toEqual({
      state: "unavailable",
    });
    expect(f.events).toEqual(["rollback"]);
  });
  it.each([
    new Error("programming defect"),
    storageError("P2010", { code: "42P01" }),
    { code: "P2024" },
  ])("propagates unrecognized projection errors %s", async (error) => {
    const f = fixture();
    f.query.mockRejectedValueOnce(error);
    await expect(f.reader.resolvePullRequests(input)).rejects.toBe(error);
    expect(f.events).toEqual(["rollback"]);
  });
  it("never degrades an authorization read failure, even with an admitted code", async () => {
    const f = fixture(),
      error = storageError("P2024");
    f.query.mockReset().mockRejectedValueOnce(error);
    await expect(f.reader.resolvePullRequests(input)).rejects.toBe(error);
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it("authorizes empty and oversized inputs before any early result", async () => {
    for (const pullRequests of [
      [],
      Array.from({ length: 26 }, () => input.pullRequests[0]!),
    ]) {
      const f = fixture();
      f.query.mockReset().mockResolvedValueOnce([{ allowed: false }]);
      await expect(
        f.reader.resolvePullRequests({ ...input, pullRequests }),
      ).rejects.toBeInstanceOf(HistoryAccessError);
      expect(f.query).toHaveBeenCalledTimes(1);
    }
    const f = fixture();
    await expect(
      f.reader.resolvePullRequests({
        ...input,
        pullRequests: Array.from({ length: 26 }, () => input.pullRequests[0]!),
      }),
    ).rejects.toBeInstanceOf(HistoryValidationError);
    expect(f.query).toHaveBeenCalledTimes(1);
  });
});
