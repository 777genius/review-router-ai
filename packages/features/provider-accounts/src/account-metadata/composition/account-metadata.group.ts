import { group } from "@get-modular/assembly";
import { metadataModule } from "./account-metadata.module.js";

export const accountMetadataGroup = group("account-metadata", [metadataModule]);
