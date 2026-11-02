import { required } from "@get-modular/core";
import {
  assemblyFor,
  declareModule,
  defineContract,
  group,
  implement,
  input,
  type Assembly,
  type CapabilitiesOf,
} from "@get-modular/assembly";
import { createReviewSkillsCatalogService } from "../application/create-review-skills-catalog-service.js";
import type { ReviewSkillsCatalogService } from "../application/catalog-contracts.js";

type Host = Parameters<typeof createReviewSkillsCatalogService>[0];
const HostContract = defineContract<Host>()({
  id: "reviewrouter/skill-catalog-host",
  revision: 1,
});
const CatalogContract = defineContract<ReviewSkillsCatalogService>()({
  id: "reviewrouter/skill-catalog",
  revision: 1,
});
export type CatalogCapabilities = CapabilitiesOf<
  typeof HostContract | typeof CatalogContract
>;
const owner = { authority: "reviewrouter", path: ["review-skills"] } as const;
export const catalogHostDeclaration = declareModule({
  moduleId: "reviewrouter/skill-catalog-host",
  implementationId: "reviewrouter/skill-catalog-host/host",
  owner,
  provides: [HostContract.provide()],
  slots: [],
});
export const catalogDeclaration = declareModule({
  moduleId: "reviewrouter/skill-catalog",
  implementationId: "reviewrouter/skill-catalog/default",
  owner,
  provides: [CatalogContract.provide()],
  slots: [HostContract.slot("host", required())],
});
const hostInput = input<CatalogCapabilities>()(catalogHostDeclaration);
const catalogModule = implement<CatalogCapabilities>()(
  catalogDeclaration,
  async ({ host }) => {
    const service = createReviewSkillsCatalogService(host);
    return {
      instance: service,
      capabilities: { "reviewrouter/skill-catalog": service },
    };
  },
);
const catalogGroup = group("skill-catalog", [catalogModule]);
export const composeReviewSkillsCatalog = (
  api: Assembly<CatalogCapabilities>,
) =>
  api.prepare({
    profileId: "reviewrouter/skill-catalog",
    modules: [catalogGroup],
    roots: { catalog: catalogModule },
    inputs: { host: hostInput },
  });
export async function initializeReviewSkillsCatalog(host: Host) {
  const prepared =
    await composeReviewSkillsCatalog(assemblyFor<CatalogCapabilities>());
  if (prepared.status === "failed") throw prepared.error;
  const outcome = await prepared.prepared.run({
    inputs: { host: { "reviewrouter/skill-catalog-host": host } },
  });
  if (outcome.status !== "succeeded")
    throw new Error("skill_catalog_composition_failed");
  return outcome.roots.catalog;
}
