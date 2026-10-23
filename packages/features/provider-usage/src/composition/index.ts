// Server composition surface. Host owns and shuts down its borrowed DB/source resources.
import { compileComposition, defineModule, required } from "@get-modular/core";
import {
  assemblyFor,
  implement,
  type CapabilityContract,
} from "@get-modular/assembly";
import type {
  UsageReportReader,
  UsagePriceSnapshotReader,
  UsageSourceReader,
  UsageStore,
} from "../application/ports";
import { IngestUsage } from "../application/ingest-usage";
export {
  PrismaUsageStore,
  PrismaUsageReportReader,
} from "../infrastructure/prisma-usage-store";
export type ProviderUsage = {
  ingestUsage: IngestUsage;
  reports: UsageReportReader;
  source: UsageSourceReader | null;
  prices: UsagePriceSnapshotReader | null;
  shutdown(): Promise<void>;
};
const compatibility = {
  family: "exact",
  familyVersion: 1,
  token: "reviewrouter/usage-v1",
} as const;
const adapters = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "reviewrouter/usage-adapters",
  implementationId: "reviewrouter/usage-adapters/host",
  owner: { authority: "reviewrouter", path: ["usage"] },
  provides: [
    { capabilityId: "reviewrouter/usage-store", compatibility },
    { capabilityId: "reviewrouter/usage-reports", compatibility },
    { capabilityId: "reviewrouter/usage-source", compatibility },
    { capabilityId: "reviewrouter/usage-prices", compatibility },
  ],
  slots: [],
});
const feature = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "reviewrouter/provider-usage",
  implementationId: "reviewrouter/provider-usage/default",
  owner: { authority: "reviewrouter", path: ["usage"] },
  provides: [],
  slots: [
    {
      slotId: "store",
      capabilityId: "reviewrouter/usage-store",
      compatibility,
      cardinality: required(),
    },
    {
      slotId: "reports",
      capabilityId: "reviewrouter/usage-reports",
      compatibility,
      cardinality: required(),
    },
    {
      slotId: "prices",
      capabilityId: "reviewrouter/usage-prices",
      compatibility,
      cardinality: required(),
    },
    {
      slotId: "source",
      capabilityId: "reviewrouter/usage-source",
      compatibility,
      cardinality: required(),
    },
  ],
});
type Capabilities = {
  "reviewrouter/usage-prices": CapabilityContract<
    UsagePriceSnapshotReader | null,
    "reviewrouter/usage-v1"
  >;
  "reviewrouter/usage-store": CapabilityContract<
    UsageStore,
    "reviewrouter/usage-v1"
  >;
  "reviewrouter/usage-reports": CapabilityContract<
    UsageReportReader,
    "reviewrouter/usage-v1"
  >;
  "reviewrouter/usage-source": CapabilityContract<
    UsageSourceReader | null,
    "reviewrouter/usage-v1"
  >;
};
export async function createProviderUsage(dependencies: {
  store: UsageStore;
  reports: UsageReportReader;
  source?: UsageSourceReader;
  prices?: UsagePriceSnapshotReader;
}): Promise<ProviderUsage> {
  if (
    !dependencies.store ||
    typeof dependencies.store.ingest !== "function" ||
    !dependencies.reports ||
    typeof dependencies.reports.read !== "function" ||
    typeof dependencies.reports.report !== "function" ||
    (dependencies.prices !== undefined &&
      typeof dependencies.prices.read !== "function") ||
    (dependencies.source !== undefined &&
      typeof dependencies.source.listUsage !== "function")
  )
    throw new Error("usage_composition_binding_invalid");
  const assembly = assemblyFor<Capabilities>();
  const adapterHandle = implement<Capabilities>()(adapters, async () => ({
    instance: dependencies,
    capabilities: {
      "reviewrouter/usage-store": dependencies.store,
      "reviewrouter/usage-reports": dependencies.reports,
      "reviewrouter/usage-source": dependencies.source ?? null,
      "reviewrouter/usage-prices": dependencies.prices ?? null,
    },
  }));
  const root = implement<Capabilities>()(feature, async (deps) => ({
    instance: {
      ingestUsage: new IngestUsage(deps.store),
      reports: deps.reports,
      source: deps.source,
      prices: deps.prices,
      shutdown: async () => {},
    },
    capabilities: {},
  }));
  const composition = await compileComposition({
    declarations: [adapters, feature],
    profile: {
      kind: "get-modular.composition-profile",
      schemaVersion: 1,
      profileId: "reviewrouter/usage",
      roots: [feature.moduleId],
      selections: [adapters, feature].map((d) => ({
        moduleId: d.moduleId,
        implementationId: d.implementationId,
      })),
      bindings: feature.slots.map((s) => ({
        consumerImplementationId: feature.implementationId,
        slotId: s.slotId,
        providerImplementationIds: [adapters.implementationId],
      })),
    },
  });
  if (!composition.ok) throw new Error("usage_composition_invalid");
  const preparation = await assembly.prepare({
    composition,
    modules: [adapterHandle, root],
    roots: { usage: root },
  });
  if (preparation.status !== "prepared")
    throw new Error(preparation.error.code);
  const outcome = await preparation.prepared.run();
  if (outcome.status !== "succeeded")
    throw new Error("usage_composition_failed");
  return outcome.roots.usage;
}
export {
  PrismaUsageReconciliation,
  type UsageCheckpointLease,
} from "../infrastructure/prisma-usage-reconciliation";
export { PrismaUsageAttributionReader } from "../infrastructure/prisma-usage-store";

export { PrismaOperatorUsageReportReader } from "../infrastructure/prisma-operator-usage-report-reader";
export { PublicModelPriceSnapshotReader } from "../infrastructure/public-model-price-snapshot";
export { PrismaUsageSourceRedrive } from "../infrastructure/prisma-usage-source-redrive";
