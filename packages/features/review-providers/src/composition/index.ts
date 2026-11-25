// Server-only entrypoint: consumers must never import this surface into a browser.
import { compileComposition, defineModule, required } from "@get-modular/core";
import {
  assemblyFor,
  implement,
  type CapabilityContract,
} from "@get-modular/assembly";
import type { ProviderModelCatalogPort } from "../application/ports/provider-model-catalog-port";
import { OpenRouterModelCatalogAdapter } from "../infrastructure/openrouter/openrouter-model-catalog";
import {
  normalizePublicCatalog,
  publicCatalogPolicy,
} from "../infrastructure/catalog/public-model-catalog";

const compatibility = {
  family: "exact",
  familyVersion: 1,
  token: "reviewrouter/catalog-v1",
} as const;
const dependenciesModule = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "reviewrouter/catalog-dependencies",
  implementationId: "reviewrouter/catalog-dependencies/host",
  owner: { authority: "reviewrouter", path: ["catalog"] },
  provides: [
    { capabilityId: "reviewrouter/catalog-http", compatibility },
    { capabilityId: "reviewrouter/catalog-clock", compatibility },
    { capabilityId: "reviewrouter/catalog-policy", compatibility },
    { capabilityId: "reviewrouter/catalog-source", compatibility },
  ],
  slots: [],
});
const catalogModule = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "reviewrouter/provider-model-catalog",
  implementationId: "reviewrouter/provider-model-catalog/default",
  owner: { authority: "reviewrouter", path: ["catalog"] },
  provides: [],
  slots: [
    {
      slotId: "http",
      capabilityId: "reviewrouter/catalog-http",
      compatibility,
      cardinality: required(),
    },
    {
      slotId: "clock",
      capabilityId: "reviewrouter/catalog-clock",
      compatibility,
      cardinality: required(),
    },
    {
      slotId: "policy",
      capabilityId: "reviewrouter/catalog-policy",
      compatibility,
      cardinality: required(),
    },
    {
      slotId: "source",
      capabilityId: "reviewrouter/catalog-source",
      compatibility,
      cardinality: required(),
    },
  ],
});
type CatalogCapabilities = {
  "reviewrouter/catalog-http": CapabilityContract<
    typeof fetch,
    "reviewrouter/catalog-v1"
  >;
  "reviewrouter/catalog-clock": CapabilityContract<
    () => number,
    "reviewrouter/catalog-v1"
  >;
  "reviewrouter/catalog-source": CapabilityContract<
    typeof normalizePublicCatalog,
    "reviewrouter/catalog-v1"
  >;
  "reviewrouter/catalog-policy": CapabilityContract<
    typeof publicCatalogPolicy,
    "reviewrouter/catalog-v1"
  >;
};
export type ProviderModelCatalog = ProviderModelCatalogPort &
  Pick<OpenRouterModelCatalogAdapter, "getOpenRouterCatalog">;
export async function createProviderModelCatalog(dependencies: {
  readonly fetchImpl: typeof fetch;
  readonly now: () => number;
  readonly policy: typeof publicCatalogPolicy;
}): Promise<ProviderModelCatalog> {
  if (
    typeof dependencies.fetchImpl !== "function" ||
    typeof dependencies.now !== "function" ||
    !dependencies.policy ||
    Object.values(dependencies.policy).some(
      (value) => !Number.isFinite(value) || value <= 0,
    )
  )
    throw new Error("catalog_composition_binding_invalid");
  const assembly = assemblyFor<CatalogCapabilities>();
  const host = implement<CatalogCapabilities>()(
    dependenciesModule,
    async () => ({
      instance: dependencies,
      capabilities: {
        "reviewrouter/catalog-http": dependencies.fetchImpl,
        "reviewrouter/catalog-clock": dependencies.now,
        "reviewrouter/catalog-policy": dependencies.policy,
        "reviewrouter/catalog-source": normalizePublicCatalog,
      },
    }),
  );
  const root = implement<CatalogCapabilities>()(
    catalogModule,
    async (deps) => ({
      instance: new OpenRouterModelCatalogAdapter({
        fetchImpl: deps.http,
        now: deps.clock,
        policy: deps.policy,
        normalize: deps.source,
      }),
      capabilities: {},
    }),
  );
  const composition = await compileComposition({
    declarations: [dependenciesModule, catalogModule],
    profile: {
      kind: "get-modular.composition-profile",
      schemaVersion: 1,
      profileId: "reviewrouter/catalog",
      roots: [catalogModule.moduleId],
      selections: [dependenciesModule, catalogModule].map((module) => ({
        moduleId: module.moduleId,
        implementationId: module.implementationId,
      })),
      bindings: catalogModule.slots.map((slot) => ({
        consumerImplementationId: catalogModule.implementationId,
        slotId: slot.slotId,
        providerImplementationIds: [dependenciesModule.implementationId],
      })),
    },
  });
  if (!composition.ok) throw new Error("catalog_composition_invalid");
  const preparation = await assembly.prepare({
    composition,
    modules: [host, root],
    roots: { catalog: root },
  });
  if (preparation.status !== "prepared")
    throw new Error("catalog_composition_unprepared");
  const outcome = await preparation.prepared.run();
  if (outcome.status !== "succeeded")
    throw new Error("catalog_composition_failed");
  return outcome.roots.catalog;
}
