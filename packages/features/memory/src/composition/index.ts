// Server-only composition. Host processes retain ownership of the borrowed DB.
import { assemblyFor, type CapabilityContract } from "@get-modular/assembly";
import { compileComposition, defineModule, required } from "@get-modular/core";
import type { PrismaClient } from "@prisma/client";
import {
  MemoryIndexOperationError,
  type MemorySearchIndexPort,
} from "../application/ports/memory-search-index-port";
import {
  parseMemorySearchConfig,
  type InfinityMemorySearchConfig,
  type MemorySearchConfigEnv,
} from "../infrastructure/config/memory-search-config";
import { InfinityMemorySearchIndex } from "../infrastructure/infinity/infinity-memory-search-index";
import type { MemoryProjectionReceiptStore } from "../infrastructure/projection/memory-projection-receipt-store";
import { PrismaMemoryProjectionReceiptStore } from "../infrastructure/prisma/prisma-memory-projection-receipt-store";
import {
  enqueueMemoryProjectionBackfill,
  type MemoryProjectionBackfillInput,
  type MemoryProjectionBackfillResult,
} from "../infrastructure/prisma/prisma-memory-projection-backfill";
import { PrismaMemorySearchIndex } from "../infrastructure/prisma/prisma-memory-search-index";

export type { MemoryProjectionBackfillInput, MemoryProjectionBackfillResult };
export { safeMemorySearchConfigurationErrorCode } from "../infrastructure/config/memory-search-config";

export type MemoryProjectionMaintenanceResult = {
  readonly processed: number;
  readonly deleted: number;
  readonly pending: number;
};

export type MemorySearchRuntime = {
  readonly searchIndex: MemorySearchIndexPort;
  backfill(
    input?: MemoryProjectionBackfillInput,
  ): Promise<MemoryProjectionBackfillResult>;
  maintenance(input?: {
    readonly limit?: number;
  }): Promise<MemoryProjectionMaintenanceResult>;
  drain(input?: {
    readonly limit?: number;
  }): Promise<MemoryProjectionMaintenanceResult>;
};

const compatibility = {
  family: "exact",
  familyVersion: 1,
  token: "reviewrouter/memory-search-v1",
} as const;
const owner = { authority: "reviewrouter", path: ["memory"] } as const;

const hostModule = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "reviewrouter/memory-search-dependencies",
  implementationId: "reviewrouter/memory-search-dependencies/host",
  owner,
  provides: [
    { capabilityId: "reviewrouter/memory-prisma", compatibility },
    { capabilityId: "reviewrouter/memory-projection-receipts", compatibility },
    { capabilityId: "reviewrouter/memory-infinity-config", compatibility },
  ],
  slots: [],
});

const prismaModule = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "reviewrouter/memory-search-runtime",
  implementationId: "reviewrouter/memory-search-runtime/prisma",
  owner,
  provides: [],
  slots: [
    {
      slotId: "prisma",
      capabilityId: "reviewrouter/memory-prisma",
      compatibility,
      cardinality: required(),
    },
    {
      slotId: "receipts",
      capabilityId: "reviewrouter/memory-projection-receipts",
      compatibility,
      cardinality: required(),
    },
  ],
});

const infinityModule = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "reviewrouter/memory-search-runtime",
  implementationId: "reviewrouter/memory-search-runtime/infinity",
  owner,
  provides: [],
  slots: [
    {
      slotId: "prisma",
      capabilityId: "reviewrouter/memory-prisma",
      compatibility,
      cardinality: required(),
    },
    {
      slotId: "config",
      capabilityId: "reviewrouter/memory-infinity-config",
      compatibility,
      cardinality: required(),
    },
    {
      slotId: "receipts",
      capabilityId: "reviewrouter/memory-projection-receipts",
      compatibility,
      cardinality: required(),
    },
  ],
});

type MemoryCapabilities = {
  "reviewrouter/memory-prisma": CapabilityContract<
    PrismaClient,
    "reviewrouter/memory-search-v1"
  >;
  "reviewrouter/memory-projection-receipts": CapabilityContract<
    MemoryProjectionReceiptStore,
    "reviewrouter/memory-search-v1"
  >;
  "reviewrouter/memory-infinity-config": CapabilityContract<
    InfinityMemorySearchConfig | null,
    "reviewrouter/memory-search-v1"
  >;
};

/** Construct once per API/worker host, using the same explicit selection. */
export async function createMemorySearchRuntime(input: {
  readonly prisma: PrismaClient;
  readonly env: MemorySearchConfigEnv;
}): Promise<MemorySearchRuntime> {
  const config = parseMemorySearchConfig(input.env);
  const receipts = new PrismaMemoryProjectionReceiptStore(input.prisma);
  const assembly = assemblyFor<MemoryCapabilities>();
  const host = assembly.bindFactory(hostModule, async () => ({
    instance: input.prisma,
    capabilities: {
      "reviewrouter/memory-prisma": input.prisma,
      "reviewrouter/memory-projection-receipts": receipts,
      "reviewrouter/memory-infinity-config":
        config.kind === "infinity" ? config : null,
    },
  }));
  const prisma = assembly.bindFactory(prismaModule, async (dependencies) => {
    await dependencies.receipts.assertCompatibleIndexIdentity("prisma");
    const instance: MemorySearchRuntime = {
      searchIndex: new PrismaMemorySearchIndex(dependencies.prisma),
      backfill: (options) =>
        enqueueMemoryProjectionBackfill(dependencies.prisma, "prisma", options),
      maintenance: emptyMaintenance,
      drain: emptyMaintenance,
    };
    return { instance, capabilities: {} };
  });
  const infinity = assembly.bindFactory(
    infinityModule,
    async (dependencies) => {
      if (!dependencies.config) {
        throw new MemoryIndexOperationError("memory_infinity_config_missing");
      }
      await dependencies.receipts.assertCompatibleIndexIdentity(
        dependencies.config.indexIdentity,
      );
      const searchIndex = new InfinityMemorySearchIndex({
        config: dependencies.config,
        receipts: dependencies.receipts,
      });
      const instance: MemorySearchRuntime = {
        searchIndex,
        backfill: (options) =>
          enqueueMemoryProjectionBackfill(
            dependencies.prisma,
            searchIndex.indexIdentity,
            options,
          ),
        maintenance: (options) => searchIndex.reconcilePending(options),
        drain: (options) => searchIndex.drain(options),
      };
      return { instance, capabilities: {} };
    },
  );
  const selectedModule =
    config.kind === "prisma" ? prismaModule : infinityModule;
  const selectedFactory = config.kind === "prisma" ? prisma : infinity;
  const composition = await compileComposition({
    declarations: [hostModule, selectedModule],
    profile: {
      kind: "get-modular.composition-profile",
      schemaVersion: 1,
      profileId: "reviewrouter/memory-search",
      roots: [selectedModule.moduleId],
      selections: [hostModule, selectedModule].map((declaration) => ({
        moduleId: declaration.moduleId,
        implementationId: declaration.implementationId,
      })),
      bindings: selectedModule.slots.map((slot) => ({
        consumerImplementationId: selectedModule.implementationId,
        slotId: slot.slotId,
        providerImplementationIds: [hostModule.implementationId],
      })),
    },
  });
  if (!composition.ok) throw new Error("memory_search_composition_invalid");
  const preparation = await assembly.prepare({
    composition,
    factories: [host, selectedFactory],
    roots: { memory: selectedFactory },
  });
  if (preparation.status !== "prepared") {
    throw new Error("memory_search_composition_unprepared");
  }
  const outcome = await preparation.prepared.run();
  if (outcome.status !== "succeeded") {
    if (
      outcome.status === "failed" &&
      outcome.cause instanceof MemoryIndexOperationError
    ) {
      throw outcome.cause;
    }
    throw new Error("memory_search_composition_failed");
  }
  return outcome.roots.memory;
}

async function emptyMaintenance(): Promise<MemoryProjectionMaintenanceResult> {
  return { processed: 0, deleted: 0, pending: 0 };
}
