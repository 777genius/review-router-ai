import { declareModule } from "@get-modular/assembly";
import { MetadataReader } from "./account-metadata.contracts.js";

export const metadataReaderDeclaration = declareModule({
  moduleId: "reviewrouter/account-metadata-reader",
  implementationId: "reviewrouter/account-metadata-reader/host",
  owner: { authority: "reviewrouter", path: ["account-metadata"] },
  provides: [MetadataReader.provide()],
  slots: [],
});
