import { implement } from "@get-modular/assembly";
import { readAccountMetadata } from "../application/use-cases/read-account-metadata.js";
import type { AccountMetadataFeature } from "../application/ports/account-metadata.js";
import { metadataDeclaration } from "./account-metadata.declaration.js";
import {
  MetadataReads,
  type MetadataCapabilities,
} from "./account-metadata.contracts.js";

export const metadataModule = implement<MetadataCapabilities>()(
  metadataDeclaration,
  async ({ reader }) => {
    const instance: AccountMetadataFeature = {
      readMetadata: (request) => readAccountMetadata(request, reader),
    };
    return { instance, capabilities: { [MetadataReads.id]: instance } };
  },
);
