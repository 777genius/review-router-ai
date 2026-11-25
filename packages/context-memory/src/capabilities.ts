/** Independent capabilities: absence is unsupported, never prompt emulation. */
export type MemoryCapabilities = {
  readonly sourcePreview: boolean;
  readonly exactStatementStorage: boolean;
  readonly currentSourceRead: boolean;
  readonly recall: boolean;
  readonly reflect: boolean;
  readonly physicalForget: boolean;
};
export const sourcePreviewCapabilities: MemoryCapabilities = {
  sourcePreview: true,
  exactStatementStorage: false,
  currentSourceRead: false,
  recall: false,
  reflect: false,
  physicalForget: false,
};

export const nativeStoreCapabilities: MemoryCapabilities = {
  sourcePreview: false,
  exactStatementStorage: true,
  currentSourceRead: true,
  recall: true,
  reflect: false,
  physicalForget: false,
};
