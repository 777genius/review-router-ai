import { assemblyFor, type Assembly } from "@get-modular/assembly";
import type { AccountMetadataFeature } from "../application/ports/account-metadata.js";
import type { AccountMetadataReader } from "../application/ports/account-metadata-reader.js";
import { accountMetadataGroup } from "./account-metadata.group.js";
import { metadataModule } from "./account-metadata.module.js";
import { metadataReaderInput } from "./account-metadata.inputs.js";
import {
  MetadataReader,
  type MetadataCapabilities,
} from "./account-metadata.contracts.js";

export const accountMetadataModules = [accountMetadataGroup] as const;
export const composeAccountMetadata = (api: Assembly<MetadataCapabilities>) =>
  api.prepare({
    profileId: "reviewrouter/account-metadata",
    modules: accountMetadataModules,
    roots: { metadata: metadataModule },
    inputs: { reader: metadataReaderInput },
  });

/** The host borrows its reader; prepare/run perform no authorization or I/O. */
export async function createAccountMetadata(input: {
  readonly reader: AccountMetadataReader;
}): Promise<AccountMetadataFeature> {
  if (!input.reader || typeof input.reader.read !== "function")
    throw new Error("account_metadata_binding_invalid");
  const preparation =
    await composeAccountMetadata(assemblyFor<MetadataCapabilities>());
  if (preparation.status !== "prepared")
    throw new Error("account_metadata_composition_invalid");
  const result = await preparation.prepared.run({
    inputs: { reader: { [MetadataReader.id]: input.reader } },
  });
  if (result.status !== "succeeded")
    throw new Error("account_metadata_composition_failed");
  return result.roots.metadata;
}
