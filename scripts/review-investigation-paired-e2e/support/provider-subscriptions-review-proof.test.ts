import { describe, expect, it } from "vitest";
import { createJoinedReviewProof } from "./provider-subscriptions-review-proof";

const requested = { reasoningEffort: "medium", maxOutputTokens: 8192 } as const;
const opaque = "opaque-native-sealed-continuation";
const first = {
  reasoning: { effort: "medium" },
  input: [{ role: "user", content: "review" }],
};
const wire =
  "event: response.completed\ndata: " +
  JSON.stringify({
    type: "response.completed",
    response: { output: [{ type: "reasoning", encrypted_content: opaque }] },
  }) +
  "\n\n";

describe("joined explicit reasoning proof", () => {
  it("preserves the default 100-token no-reasoning policy", () => {
    const proof = createJoinedReviewProof(undefined, 512);
    expect(proof.maxOutputTokens).toBe(100);
    expect(proof.modelConfigLines).toEqual([]);
    proof.assertRequest({ input: "review" }, 1);
    proof.assertRequest({ input: "review", reasoning: null }, 2);
    proof.assertForwarded({ reasoning: null }, {});
    expect(() =>
      proof.assertRequest({ reasoning: { effort: "xhigh" } }, 1),
    ).toThrow();
    expect(() =>
      proof.assertForwarded({}, { reasoning: { effort: "medium" } }),
    ).toThrow();
    expect(proof.receipt()).toEqual({ reasoningOmitted: true });
  });

  it("requires an observed native token to return through the CLI and relay unchanged", () => {
    const proof = createJoinedReviewProof(requested, 16384);
    expect(proof.modelConfigLines).toEqual([
      "model_supports_reasoning_summaries = true",
      'model_reasoning_summary = "none"',
    ]);
    proof.assertRequest(first, 1);
    proof.observeResponse(wire, 1);
    const second = {
      reasoning: { effort: "medium" },
      input: [
        { type: "reasoning", encrypted_content: opaque },
        {
          type: "function_call_output",
          call_id: "read",
          output: "fixture read",
        },
      ],
    };
    proof.assertRequest(second, 2);
    proof.assertForwarded(second, { ...second, max_output_tokens: 8192 });
    expect(() =>
      proof.assertForwarded(second, {
        ...second,
        input: [],
        max_output_tokens: 8192,
      }),
    ).toThrow();
    expect(() =>
      proof.assertForwarded(second, { ...second, max_output_tokens: 100 }),
    ).toThrow();
    const receipt = proof.receipt();
    expect(receipt).toEqual({
      reasoningOmitted: false,
      reasoningEffort: "medium",
      reasoningRequests: 2,
      reasoningContinuations: 1,
    });
    expect(JSON.stringify(receipt)).not.toContain(opaque);
  });

  it("rejects missing or substituted continuation and missing native proof", () => {
    for (const input of [
      [],
      [{ type: "reasoning", encrypted_content: "substituted" }],
    ]) {
      const proof = createJoinedReviewProof(requested, 16384);
      proof.assertRequest(first, 1);
      proof.observeResponse(wire, 1);
      expect(() =>
        proof.assertRequest({ reasoning: { effort: "medium" }, input }, 2),
      ).toThrow();
    }
    const absent = createJoinedReviewProof(requested, 16384);
    expect(() =>
      absent.observeResponse(
        'data: {"type":"response.completed","response":{"output":[]}}\n\n',
        1,
      ),
    ).toThrow();
    expect(() =>
      absent.assertRequest({ reasoning: { effort: "medium" }, input: [] }, 2),
    ).toThrow();
  });

  it("rejects effort drift and a cap outside the qualified run budget", () => {
    expect(() => createJoinedReviewProof(requested, 8191)).toThrow();
    const proof = createJoinedReviewProof(requested, 16384);
    expect(() => proof.assertRequest({ reasoning: null }, 1)).toThrow();
    expect(() =>
      proof.assertRequest({ reasoning: { effort: "high" } }, 1),
    ).toThrow();
  });
});
