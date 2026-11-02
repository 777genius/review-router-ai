import type { TextInferencePort } from "../../packages/features/conversations/src/application/ports/text-inference-port.js";

/** Synthetic fixture report only; observes the reduced SDK result without changing dispatch. */
export function observeEvaluationModelDecision(
  inference: TextInferencePort,
  observe: (trace: { text: string; bytes: number; truncated: boolean }) => void,
): TextInferencePort {
  return {
    async generate(request, controls, beforeDispatch) {
      const result = await inference.generate(
        request,
        controls,
        beforeDispatch,
      );
      const bytes = Buffer.from(result.text);
      // Streaming decode drops an incomplete final UTF-8 character at the byte ceiling.
      const text = new TextDecoder().decode(bytes.subarray(0, 16_384), {
        stream: true,
      });
      observe({
        text,
        bytes: Buffer.byteLength(text),
        truncated: bytes.length > 16_384,
      });
      return result;
    },
  };
}
