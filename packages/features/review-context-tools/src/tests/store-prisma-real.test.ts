import { randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContextConnection } from "../domain/context-tools.js";
import { PrismaContextConnectionStore } from "../infrastructure/prisma-context-connection-store.js";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;

databaseTests("Prisma context connection scoped CAS", () => {
  let prisma: PrismaClient;
  const workspaceId = `context-test-${randomUUID()}`;
  const otherWorkspaceId = `${workspaceId}-other`;
  beforeAll(() => {
    prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 5 });
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.reviewContextConnection.deleteMany({
        where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
      });
      await prisma.$disconnect();
    }
  });

  it("allows one racing writer per revision and reads the same scoped row inside a capture transaction", async () => {
    const store = new PrismaContextConnectionStore(prisma);
    const connection: ContextConnection = {
      workspaceId,
      version: 1,
      enabled: true,
      encryptedSecrets: "test-ciphertext",
      definition: {
        id: "docs",
        url: "https://mcp.example.com/api",
        headers: { Authorization: "Bearer ${{ secrets.DOCS_KEY }}" },
        tools: ["search"],
        credentials: { DOCS_KEY: { source: "dashboard-secret" } },
      },
    };
    expect(
      (
        await Promise.all([
          store.save(connection, null),
          store.save(connection, null),
        ])
      ).sort(),
    ).toEqual([false, true]);
    expect(
      await store.save({ ...connection, workspaceId: otherWorkspaceId }, null),
    ).toBe(true);
    const revisions = await Promise.all([
      store.save({ ...connection, version: 2, enabled: false }, 1),
      store.save(
        {
          ...connection,
          version: 2,
          encryptedSecrets: "rotated-test-ciphertext",
        },
        1,
      ),
    ]);
    expect(revisions.sort()).toEqual([false, true]);
    const winner = await store.find(workspaceId, "docs");
    expect(winner?.version).toBe(2);
    expect(await store.save({ ...connection, version: 2 }, 1)).toBe(false);
    expect(await store.find(workspaceId, "docs")).toEqual(winner);
    expect(await store.find(otherWorkspaceId, "docs")).toEqual({
      ...connection,
      workspaceId: otherWorkspaceId,
    });
    await prisma.$transaction(async (tx) => {
      const transactionStore = new PrismaContextConnectionStore(tx);
      expect(await transactionStore.find(workspaceId, "docs")).toEqual(winner);
      expect(await transactionStore.list(workspaceId)).toEqual([winner]);
    });
  });
});
