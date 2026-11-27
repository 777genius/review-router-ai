// Server-only entrypoint: consumers must never import this surface into a browser.
import { required } from "@get-modular/core";
import {
  assemblyFor,
  declareModule,
  defineContract,
  group,
  implement,
  input,
  type CapabilitiesOf,
} from "@get-modular/assembly";
import type { ProviderModelCatalogPort } from "../application/ports/provider-model-catalog-port";
import { OpenRouterModelCatalogAdapter } from "../infrastructure/openrouter/openrouter-model-catalog";
import {
  normalizePublicCatalog,
  publicCatalogPolicy,
} from "../infrastructure/catalog/public-model-catalog";

export type ProviderModelCatalog = ProviderModelCatalogPort &
  Pick<OpenRouterModelCatalogAdapter, "getOpenRouterCatalog">;

// Use Get Modular's descriptor-based API and automatic required-slot bindings:
// the Host supplies borrowed capabilities; no hand-written Core profile is needed.
const CatalogHttp = defineContract<typeof fetch>()({
  id: "reviewrouter/catalog-http",
  revision: 1,
});
const CatalogClock = defineContract<() => number>()({
  id: "reviewrouter/catalog-clock",
  revision: 1,
});
const CatalogPolicy = defineContract<typeof publicCatalogPolicy>()({
  id: "reviewrouter/catalog-policy",
  revision: 1,
});
const CatalogSource = defineContract<typeof normalizePublicCatalog>()({
  id: "reviewrouter/catalog-source",
  revision: 1,
});
const Catalog = defineContract<ProviderModelCatalog>()({
  id: "reviewrouter/provider-model-catalog",
  revision: 1,
});
type CatalogCapabilities = CapabilitiesOf<
  | typeof CatalogHttp
  | typeof CatalogClock
  | typeof CatalogPolicy
  | typeof CatalogSource
  | typeof Catalog
>;
const owner = { authority: "reviewrouter", path: ["catalog"] } as const;
const dependenciesDeclaration = declareModule({
  moduleId: "reviewrouter/catalog-dependencies",
  implementationId: "reviewrouter/catalog-dependencies/host",
  owner,
  provides: [
    CatalogHttp.provide(),
    CatalogClock.provide(),
    CatalogPolicy.provide(),
    CatalogSource.provide(),
  ],
  slots: [],
});
const catalogDeclaration = declareModule({
  moduleId: "reviewrouter/provider-model-catalog",
  implementationId: "reviewrouter/provider-model-catalog/default",
  owner,
  provides: [Catalog.provide()],
  slots: [
    CatalogHttp.slot("http", required()),
    CatalogClock.slot("clock", required()),
    CatalogPolicy.slot("policy", required()),
    CatalogSource.slot("source", required()),
  ],
});
const dependenciesInput = input<CatalogCapabilities>()(dependenciesDeclaration);
const catalogModule = implement<CatalogCapabilities>()(
  catalogDeclaration,
  async ({ http, clock, policy, source }) => {
    const instance = new OpenRouterModelCatalogAdapter({
      fetchImpl: http,
      now: clock,
      policy,
      normalize: source,
    });
    return {
      instance,
      capabilities: { "reviewrouter/provider-model-catalog": instance },
    };
  },
);
const catalogGroup = group("provider-catalog", [catalogModule]);

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

  const preparation = await assemblyFor<CatalogCapabilities>().prepare({
    profileId: "reviewrouter/catalog",
    modules: [catalogGroup],
    roots: { catalog: catalogModule },
    inputs: { dependencies: dependenciesInput },
  });
  if (preparation.status !== "prepared")
    throw new Error("catalog_composition_unprepared");

  const outcome = await preparation.prepared.run({
    inputs: {
      dependencies: {
        "reviewrouter/catalog-http": dependencies.fetchImpl,
        "reviewrouter/catalog-clock": dependencies.now,
        "reviewrouter/catalog-policy": dependencies.policy,
        "reviewrouter/catalog-source": normalizePublicCatalog,
      },
    },
  });
  if (outcome.status !== "succeeded")
    throw new Error("catalog_composition_failed");
  return outcome.roots.catalog;
}
