import { compileComposition, required } from "@get-modular/core";
import {
  assemblyFor,
  declareModule,
  defineContract,
  implement,
  type CapabilitiesOf,
} from "@get-modular/assembly";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ReviewStatisticsReader } from "../application/ports";
import {
  createReviewStatisticsFeature,
  reviewStatisticsContracts,
} from "./index";

const owner = { authority: "reviewrouter", path: ["statistics"] } as const;
const reader = reviewStatisticsContracts.Reader;
const consumer = declareModule({
  moduleId: "reviewrouter/statistics-test",
  implementationId: "reviewrouter/statistics-test/reader",
  owner,
  provides: [],
  slots: [reader.slot("reader", required())],
});
type ReaderCapabilities = CapabilitiesOf<typeof reader>;

describe("statistics checked composition", () => {
  it("constructs without opening, querying, activating or disposing the borrowed database", async () => {
    const transaction = vi.fn();
    const prisma = new Proxy(
      { $transaction: transaction },
      {
        get(target, key) {
          if (key === "$transaction") return target.$transaction;
          throw new Error(`unexpected_database_access:${String(key)}`);
        },
      },
    ) as unknown as PrismaClient;
    const feature = await createReviewStatisticsFeature({ prisma });
    expect(feature.reader.readReport).toBeTypeOf("function");
    expect(feature.reader.readIssues).toBeTypeOf("function");
    expect(feature.projector.project).toBeTypeOf("function");
    expect(feature.outboxWriter.write).toBeTypeOf("function");
    expect(feature.activateCapture).toBeTypeOf("function");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects an invalid borrowed database before running a factory", async () => {
    await expect(
      createReviewStatisticsFeature({ prisma: {} as PrismaClient }),
    ).rejects.toThrow("statistics_database_binding_invalid");
  });

  it("rejects a missing required capability before factory I/O", async () => {
    const factory = vi.fn(async () => ({ instance: {}, capabilities: {} }));
    const root = implement<ReaderCapabilities>()(consumer, factory);
    const preparation = await assemblyFor<ReaderCapabilities>().prepare({
      profileId: "reviewrouter/statistics-test",
      modules: [root],
      roots: { reader: root },
      bindings: [],
    });
    expect(preparation.status).toBe("failed");
    if (preparation.status === "failed")
      expect(preparation.error.code).toBe(
        "assembly.prepare.unresolved-binding",
      );
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects an incompatible reader contract revision in the real Core plan", async () => {
    const incompatibleReader = defineContract<ReviewStatisticsReader>()({
      id: reader.id,
      revision: 2,
    });
    const provider = declareModule({
      moduleId: "reviewrouter/statistics-test-provider",
      implementationId: "reviewrouter/statistics-test-provider/v2",
      owner,
      provides: [incompatibleReader.provide()],
      slots: [],
    });
    const composition = await compileComposition({
      declarations: [provider, consumer],
      profile: {
        kind: "get-modular.composition-profile",
        schemaVersion: 1,
        profileId: "reviewrouter/statistics-test",
        roots: [consumer.moduleId],
        selections: [provider, consumer].map((x) => ({
          moduleId: x.moduleId,
          implementationId: x.implementationId,
        })),
        bindings: [
          {
            consumerImplementationId: consumer.implementationId,
            slotId: "reader",
            providerImplementationIds: [provider.implementationId],
          },
        ],
      },
    });
    expect(composition.ok).toBe(false);
  });
});

// Native qualification must reject a contract that omits the reader capability.
// This function is never called; @ts-expect-error must fail if typing weakens.
void (() => {
  // @ts-expect-error The declaration uses the statistics reader contract.
  implement<Record<never, never>>()(consumer, async () => ({
    instance: {},
    capabilities: {},
  }));
});
