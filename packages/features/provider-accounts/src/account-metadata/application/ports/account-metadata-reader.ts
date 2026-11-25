import type { AccountMetadataObservation } from "./account-metadata.js";

export type AccountMetadataReader = {
  /** Cached native facts only. No refresh, inference or account mutation. */
  readonly read: (
    ownerRef: string,
    accountRefs: readonly string[],
    signal: AbortSignal,
  ) => Promise<readonly AccountMetadataObservation[]>;
};
