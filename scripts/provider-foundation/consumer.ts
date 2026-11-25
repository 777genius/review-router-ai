import assert from "node:assert/strict";
import { assemblyFor, type CapabilityContract } from "@get-modular/assembly";
import { compileComposition, defineModule, required } from "@get-modular/core";

// A consumer fixture, not an empty production feature. The host owns cleanup.
type Store = { read(): number; close(): void };
type Query = { execute(): number };
type Capabilities = {
  "qualification/store": CapabilityContract<Store, "qualification/store-v1">;
  "qualification/query": CapabilityContract<Query, "qualification/query-v1">;
};
const storeCompatibility = {
  family: "exact",
  familyVersion: 1,
  token: "qualification/store-v1",
} as const;
const queryCompatibility = {
  family: "exact",
  familyVersion: 1,
  token: "qualification/query-v1",
} as const;
const owner = { authority: "reviewrouter", path: ["qualification"] } as const;
const store = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "qualification/store",
  implementationId: "qualification/store/default",
  owner,
  provides: [
    { capabilityId: "qualification/store", compatibility: storeCompatibility },
  ],
  slots: [],
});
const query = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "qualification/query",
  implementationId: "qualification/query/default",
  owner,
  provides: [
    { capabilityId: "qualification/query", compatibility: queryCompatibility },
  ],
  slots: [
    {
      slotId: "store",
      capabilityId: "qualification/store",
      compatibility: storeCompatibility,
      cardinality: required(),
    },
  ],
});
const declarations = [store, query];
const profile = {
  kind: "get-modular.composition-profile",
  schemaVersion: 1,
  profileId: "qualification/default",
  roots: [query.moduleId],
  selections: declarations.map(({ moduleId, implementationId }) => ({
    moduleId,
    implementationId,
  })),
  bindings: [
    {
      consumerImplementationId: query.implementationId,
      slotId: "store",
      providerImplementationIds: [store.implementationId],
    },
  ],
};
let effects = 0;
let closed = 0;
let unrelatedClosed = 0;
const unrelated = {
  close: () => {
    unrelatedClosed++;
  },
};
const assembly = assemblyFor<Capabilities>();
const storeFactory = assembly.bindFactory(store, async () => {
  effects++;
  const instance: Store = {
    read: () => 42,
    close: () => {
      closed++;
    },
  };
  return { instance, capabilities: { "qualification/store": instance } };
});
const queryFactory = assembly.bindFactory(query, async ({ store }) => {
  const instance: Query = { execute: () => store.read() };
  return { instance, capabilities: { "qualification/query": instance } };
});
const composition = await compileComposition({ declarations, profile });
assert(composition.ok, JSON.stringify(composition));
const missingFactory = await assembly.prepare({
  composition,
  factories: [queryFactory],
  roots: { query: queryFactory },
});
assert.equal(missingFactory.status, "failed");
assert.equal(effects, 0, "preparation must not perform I/O");
const missingBinding = await compileComposition({
  declarations,
  profile: { ...profile, bindings: [] },
});
assert(!missingBinding.ok);
assert(
  missingBinding.diagnostics.some(({ code }) => code === "binding.missing"),
);
const incompatible = await compileComposition({
  declarations: [
    {
      ...store,
      provides: [
        {
          capabilityId: "qualification/store",
          compatibility: {
            ...storeCompatibility,
            token: "qualification/store-v2",
          },
        },
      ],
    },
    query,
  ],
  profile,
});
assert(!incompatible.ok);
assert(
  incompatible.diagnostics.some(
    ({ code }) => code === "binding.compatibility-mismatch",
  ),
);
assert.equal(effects, 0);
const prepared = await assembly.prepare({
  composition,
  factories: [storeFactory, queryFactory],
  roots: { query: queryFactory },
});
assert.equal(prepared.status, "prepared");
assert(prepared.status === "prepared");
const result = await prepared.prepared.run();
assert.equal(result.status, "succeeded");
assert(result.status === "succeeded");
assert.equal(result.roots.query.execute(), 42);
// Assembly 0.2 exposes created instances; it does not invent lifecycle ownership.
for (const created of [...result.created].reverse()) {
  if (
    created.instance ===
    result.created.find(
      ({ implementationId }) => implementationId === store.implementationId,
    )?.instance
  ) {
    (created.instance as Store).close();
  }
}
assert.equal(effects, 1);
assert.equal(closed, 1);
assert.equal(unrelatedClosed, 0);
void unrelated;
console.log(
  "Packed Get Modular 0.2 consumer: typed construction, invalid wiring before I/O, owned cleanup passed.",
);
