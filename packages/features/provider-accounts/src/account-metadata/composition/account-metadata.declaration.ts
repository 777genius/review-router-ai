import { required } from "@get-modular/core";
import { declareModule } from "@get-modular/assembly";
import { MetadataReader, MetadataReads } from "./account-metadata.contracts.js";

export const metadataDeclaration = declareModule({
  moduleId: "reviewrouter/account-metadata",
  implementationId: "reviewrouter/account-metadata/default",
  owner: { authority: "reviewrouter", path: ["account-metadata"] },
  provides: [MetadataReads.provide()],
  slots: [MetadataReader.slot("reader", required())],
});
