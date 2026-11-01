import type { MemoryRequestControls } from "./memory-knowledge-provider-port";
/** Product-owned narrow seam; native DTOs and qualification settings stay in infrastructure. */
export interface MemorySourcePreviewPort {
  preview(
    input: {
      readonly scope: string;
      readonly source: {
        readonly id: string;
        readonly revision: string;
        readonly body: string;
      };
      readonly maxStatements: number;
      /** Complete, host-checked thread used to interpret the selected source. */
      readonly readOnlyContext?: string;
    },
    controls: MemoryRequestControls,
  ): Promise<
    | {
        readonly status: "complete";
        readonly source: { readonly id: string; readonly revision: string };
        readonly statements: readonly { readonly body: string }[];
      }
    | { readonly status: "unsupported" | "incomplete"; readonly reason: string }
  >;
}
