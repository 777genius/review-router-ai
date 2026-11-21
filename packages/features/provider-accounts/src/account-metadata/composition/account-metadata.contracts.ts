import { defineContract, type CapabilitiesOf } from "@get-modular/assembly";
import type { AccountMetadataFeature } from "../application/ports/account-metadata.js";
import type { AccountMetadataReader } from "../application/ports/account-metadata-reader.js";

export const MetadataReader = defineContract<AccountMetadataReader>()({
  id: "reviewrouter/account-metadata-reader",
  revision: 1,
});
export const MetadataReads = defineContract<AccountMetadataFeature>()({
  id: "reviewrouter/account-metadata",
  revision: 1,
});
export type MetadataCapabilities = CapabilitiesOf<
  typeof MetadataReader | typeof MetadataReads
>;
