import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assemblyFor, entriesOf } from "@get-modular/assembly";
import {
  checkNamespaces,
  checkWiring,
  smoke,
  type WiringOracle,
} from "@get-modular/conformance";
import { describe, expect, it, vi } from "vitest";
import {
  composeReviewHistory,
  createReviewHistoryFeature,
  reviewHistoryModules,
} from "./review-history.root.js";
import { historyDatabaseInput } from "./review-history.inputs.js";
import {
  HistoryDatabase,
  type HistoryCapabilities,
} from "./review-history.contracts.js";

// Handwritten decisions independent of declarations, profile, and compiled plan.
const oracle: WiringOracle = {
  providers: {
    "reviewrouter/history-database": "reviewrouter/history-database/host",
    "reviewrouter/history-reader": "reviewrouter/review-history/default",
    "reviewrouter/history-projector": "reviewrouter/review-history/default",
    "reviewrouter/history-capture": "reviewrouter/review-history/default",
    "reviewrouter/history-activation": "reviewrouter/review-history/default",
  },
  roots: ["reviewrouter/review-history/default"],
};
describe("History real production composition", () => {
  it("checks exact wiring/namespaces and genuine failure/cancellation smoke without database I/O", async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: "postgresql://unused@127.0.0.1:1/history_no_io",
      }),
    });
    const transaction = vi.spyOn(prisma, "$transaction");
    const disconnect = vi.spyOn(prisma, "$disconnect");
    try {
      const declarations = [
        ...entriesOf(reviewHistoryModules).map((entry) => entry.declaration),
        historyDatabaseInput.declaration,
      ];
      checkNamespaces({ namespace: "reviewrouter", declarations });
      const preparation =
        await composeReviewHistory(assemblyFor<HistoryCapabilities>());
      expect(preparation.status).toBe("prepared");
      if (preparation.status !== "prepared")
        throw new Error("history_prepare_failed");
      checkWiring(preparation.composition, [oracle], { declarations });
      expect(() =>
        checkWiring(
          preparation.composition,
          [{ ...oracle, roots: ["reviewrouter/wrong/root"] }],
          { declarations },
        ),
      ).toThrow();
      const steps = await smoke({
        api: assemblyFor<HistoryCapabilities>(),
        compose: composeReviewHistory,
        inputs: { database: { [HistoryDatabase.id]: prisma } },
      });
      expect(
        steps.some(
          (step) => step.inject === "none" && step.outcome === "succeeded",
        ),
      ).toBe(true);
      expect(
        steps.every(
          (step) => step.problem === undefined && step.report.complete,
        ),
      ).toBe(true);
      const feature = await createReviewHistoryFeature({ prisma });
      expect(Object.hasOwn(feature.reader, "listPullRequests")).toBe(true);
      expect(Object.hasOwn(feature.writer, "captureIntent")).toBe(true);
      expect(transaction).not.toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();
    } finally {
      await prisma.$disconnect();
    }
  });
});
