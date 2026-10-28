import type { RequestControls } from "../../domain/conversation.js";

/** An application capability for one plain call. Account custody stays in the injected adapter. */
export interface TextInferencePort {
  generate(
    input: {
      readonly instructions: string;
      readonly messages: readonly {
        readonly role: "user" | "assistant";
        readonly content: string;
      }[];
      readonly outputSchema?: {
        readonly name: string;
        readonly schema: Readonly<Record<string, unknown>>;
      };
    },
    controls: RequestControls,
    /** Check the already frozen source immediately before the external request. */
    beforeDispatch?: (controls: RequestControls) => Promise<boolean>,
  ): Promise<{
    readonly text: string;
    readonly actualModel: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
    } | null;
    readonly effect: "completed";
  }>;
}
