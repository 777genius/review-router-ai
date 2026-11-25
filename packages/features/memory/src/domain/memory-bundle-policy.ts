/** Product bounds; the complete provider owns retrieval and preserves native ranking. */
export type MemoryBundlePolicy = {
  readonly maxItems: number;
  readonly maxCharacters: number;
  readonly includeUserPrefs: boolean;
};

export const defaultMemoryBundlePolicy: MemoryBundlePolicy = {
  maxItems: 12,
  maxCharacters: 6_000,
  includeUserPrefs: true,
};
