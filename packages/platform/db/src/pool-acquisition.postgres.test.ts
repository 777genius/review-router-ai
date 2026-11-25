import { describe, expect, it } from "vitest";
import { createPrismaClient, isDatabaseAcquisitionTimeout } from "./index";

const adminUrl = process.env.RELIABILITY_TEST_POSTGRES_ADMIN_URL;
describe.skipIf(!adminUrl)(
  "database pool acquisition on real PostgreSQL",
  () => {
    it("bounds saturated acquisition without ending the current transaction", async () => {
      const url = new URL(adminUrl!);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        throw new Error("disposable_loopback_database_required");
      const prisma = createPrismaClient({
        databaseUrl: url.toString(),
        poolMax: 1,
        poolConnectionTimeoutMs: 100,
        transactionTimeoutMs: 5000,
      });
      let ready!: () => void;
      let release!: () => void;
      const acquired = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const owner = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        ready();
        await held;
        return tx.$queryRaw`SELECT 2 AS value`;
      });
      try {
        await acquired;
        const started = performance.now();
        const error: unknown = await prisma.$queryRaw`SELECT 3`.catch(
          (cause: unknown) => cause,
        );
        expect(isDatabaseAcquisitionTimeout(error)).toBe(true);
        expect(performance.now() - started).toBeLessThan(1500);
        const transactionError: unknown = await prisma
          .$transaction((tx) => tx.$queryRaw`SELECT 5`, { maxWait: 50 })
          .catch((cause: unknown) => cause);
        expect(isDatabaseAcquisitionTimeout(transactionError)).toBe(true);
        release();
        await expect(owner).resolves.toEqual([{ value: 2 }]);
        await expect(prisma.$queryRaw`SELECT 4 AS value`).resolves.toEqual([
          { value: 4 },
        ]);
      } finally {
        release();
        await owner.catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);
