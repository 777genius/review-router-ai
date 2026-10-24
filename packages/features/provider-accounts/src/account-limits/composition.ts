import { compileComposition, defineModule, required } from "@get-modular/core";
import {
  assemblyFor,
  implement,
  type CapabilityContract,
} from "@get-modular/assembly";
import type { AccountLimitsReader } from "./application/ports/account-limits-reader";
import { readAccountLimits } from "./application/use-cases/read-account-limits";

const compatibility = {
  family: "exact",
  familyVersion: 1,
  token: "reviewrouter/account-limits-v1",
} as const;
const adapter = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "reviewrouter/account-limits-reader",
  implementationId: "reviewrouter/account-limits-reader/host",
  owner: { authority: "reviewrouter", path: ["accounts"] },
  provides: [
    { capabilityId: "reviewrouter/account-limits-reader", compatibility },
  ],
  slots: [],
});
const feature = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "reviewrouter/account-limits",
  implementationId: "reviewrouter/account-limits/default",
  owner: { authority: "reviewrouter", path: ["accounts"] },
  provides: [],
  slots: [
    {
      slotId: "reader",
      capabilityId: "reviewrouter/account-limits-reader",
      compatibility,
      cardinality: required(),
    },
  ],
});
type Capabilities = {
  "reviewrouter/account-limits-reader": CapabilityContract<
    AccountLimitsReader,
    "reviewrouter/account-limits-v1"
  >;
};

/** Borrows the host's read-only adapter; no separate runtime, persistence or polling. */
export async function createAccountLimits(dependencies: {
  reader: AccountLimitsReader;
}) {
  if (!dependencies.reader || typeof dependencies.reader.read !== "function")
    throw new Error("account_limits_binding_invalid");
  const assembly = assemblyFor<Capabilities>();
  const source = implement<Capabilities>()(adapter, async () => ({
    instance: dependencies.reader,
    capabilities: { "reviewrouter/account-limits-reader": dependencies.reader },
  }));
  const root = implement<Capabilities>()(feature, async (deps) => ({
    instance: {
      reader: deps.reader,
      read: (input: Omit<Parameters<typeof readAccountLimits>[0], "reader">) =>
        readAccountLimits({ ...input, reader: deps.reader }),
    },
    capabilities: {},
  }));
  const composition = await compileComposition({
    declarations: [adapter, feature],
    profile: {
      kind: "get-modular.composition-profile",
      schemaVersion: 1,
      profileId: "reviewrouter/account-limits",
      roots: [feature.moduleId],
      selections: [adapter, feature].map((declaration) => ({
        moduleId: declaration.moduleId,
        implementationId: declaration.implementationId,
      })),
      bindings: [
        {
          consumerImplementationId: feature.implementationId,
          slotId: "reader",
          providerImplementationIds: [adapter.implementationId],
        },
      ],
    },
  });
  if (!composition.ok) throw new Error("account_limits_composition_invalid");
  const preparation = await assembly.prepare({
    composition,
    modules: [source, root],
    roots: { limits: root },
  });
  if (preparation.status !== "prepared")
    throw new Error(preparation.error.code);
  const outcome = await preparation.prepared.run();
  if (outcome.status !== "succeeded")
    throw new Error("account_limits_composition_failed");
  return outcome.roots.limits;
}
