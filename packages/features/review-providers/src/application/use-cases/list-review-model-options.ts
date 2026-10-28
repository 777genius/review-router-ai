import {
  listStaticReviewModelOptions,
  type ReviewModelOption,
} from "../../domain/provider-models";
import { catalogSnapshotOptions } from "../../domain/provider-model-catalog";
import type { ProviderModelCatalogPort } from "../ports/provider-model-catalog-port";
export async function listReviewModelOptions(input?: {
  readonly modelCatalog?: ProviderModelCatalogPort;
  readonly signal?: AbortSignal;
}): Promise<readonly ReviewModelOption[]> {
  if (!input?.modelCatalog) return listStaticReviewModelOptions();
  const snapshots = await Promise.all(
    (["codex", "claude", "openrouter"] as const).map((providerKind) =>
      input.modelCatalog!.listModels({
        providerKind,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    ),
  );
  return [
    ...listStaticReviewModelOptions().filter(
      (option) =>
        option.provider === "codex-mimo" || option.provider === "kimi",
    ),
    ...snapshots.flatMap((snapshot) => catalogSnapshotOptions(snapshot)),
  ];
}
