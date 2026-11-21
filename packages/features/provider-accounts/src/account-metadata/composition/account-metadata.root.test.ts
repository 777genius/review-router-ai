import { assemblyFor, entriesOf } from "@get-modular/assembly";
import {
  checkWiring,
  smoke,
  type WiringOracle,
} from "@get-modular/conformance";
import { expect, it, vi } from "vitest";
import {
  accountMetadataModules,
  composeAccountMetadata,
  createAccountMetadata,
} from "./account-metadata.root.js";
import { metadataReaderInput } from "./account-metadata.inputs.js";
import {
  MetadataReader,
  type MetadataCapabilities,
} from "./account-metadata.contracts.js";

const oracle: WiringOracle = {
  providers: {
    "reviewrouter/account-metadata-reader":
      "reviewrouter/account-metadata-reader/host",
    "reviewrouter/account-metadata": "reviewrouter/account-metadata/default",
  },
  roots: ["reviewrouter/account-metadata/default"],
};
it("uses the real composed API and borrowed reader without construction effects", async () => {
  const read = vi.fn(async () => []);
  const reader = { read };
  const declarations = [
    ...entriesOf(accountMetadataModules).map((entry) => entry.declaration),
    metadataReaderInput.declaration,
  ];
  const prepared =
    await composeAccountMetadata(assemblyFor<MetadataCapabilities>());
  expect(prepared.status).toBe("prepared");
  if (prepared.status !== "prepared")
    throw new Error("fixture preparation failed");
  checkWiring(prepared.composition, [oracle], { declarations });
  expect(() =>
    checkWiring(
      prepared.composition,
      [
        {
          ...oracle,
          providers: {
            ...oracle.providers,
            "reviewrouter/account-metadata-reader": "wrong/reader",
          },
        },
      ],
      { declarations },
    ),
  ).toThrow();
  expect(() =>
    checkWiring(prepared.composition, [{ ...oracle, roots: ["wrong/root"] }], {
      declarations,
    }),
  ).toThrow();
  const steps = await smoke({
    api: assemblyFor<MetadataCapabilities>(),
    compose: composeAccountMetadata,
    inputs: { reader: { [MetadataReader.id]: reader } },
  });
  expect(
    steps.some(
      (step) => step.inject === "none" && step.outcome === "succeeded",
    ),
  ).toBe(true);
  expect(
    steps.every((step) => step.problem === undefined && step.report.complete),
  ).toBe(true);
  const feature = await createAccountMetadata({ reader });
  expect(read).not.toHaveBeenCalled();
  const authorize = vi.fn(async () => new Map());
  expect(
    await feature.readMetadata({ connectionIds: ["a"], authorize }),
  ).toEqual(
    new Map([["a", { status: "restricted", displayToken: "restricted" }]]),
  );
  expect(authorize).toHaveBeenCalledTimes(2);
  expect(read).not.toHaveBeenCalled();
});

it.each([undefined, {}, { read: true }])(
  "rejects an invalid host reader",
  async (reader) => {
    await expect(createAccountMetadata({ reader } as never)).rejects.toThrow(
      "account_metadata_binding_invalid",
    );
  },
);
