import { input } from "@get-modular/assembly";
import { metadataReaderDeclaration } from "./account-metadata-reader.declaration.js";
import type { MetadataCapabilities } from "./account-metadata.contracts.js";

export const metadataReaderInput = input<MetadataCapabilities>()(
  metadataReaderDeclaration,
);
