import { createProviderModelCatalog } from "@reviewrouter/features-review-providers/composition";
import { publicCatalogPolicy } from "@reviewrouter/features-review-providers";
import { PublicModelPriceSnapshotReader } from "@reviewrouter/features-provider-usage/composition";
import type { UsagePriceSnapshotReader } from "@reviewrouter/features-provider-usage";

// One anonymous public catalog/cache per API process. No account binding or credential enters it.
let reader: Promise<UsagePriceSnapshotReader> | undefined;
export function providerUsagePriceSnapshots(): Promise<UsagePriceSnapshotReader> {
  return (reader ??= createProviderModelCatalog({
    fetchImpl: fetch,
    now: Date.now,
    policy: publicCatalogPolicy,
  }).then((catalog) => new PublicModelPriceSnapshotReader(catalog)));
}
