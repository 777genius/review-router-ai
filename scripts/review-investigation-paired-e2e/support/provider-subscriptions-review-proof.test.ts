import { describe, expect, it } from "vitest";
import {
  createJoinedReviewProof,
  inspectJoinedToolOutput,
  requireJoinedToolCompletion,
} from "./provider-subscriptions-review-proof";

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

describe("joined controlled command completion", () => {
  const checkout = "/private/joined-fixture/owned-checkout";
  const privateDetail = "private-command-diagnostic";
  const completed = `Wall time: 0.01 seconds\nProcess exited with code 0\nFinal output:\n${checkout}\n`;
  const noFailure = {
    functionOutputs: 1,
    workspaceObserved: true,
    exitZeroObserved: true,
    unknownToolObserved: false,
    invalidArgumentsObserved: false,
    sandboxFailureObserved: false,
    runningSessionObserved: false,
    execCommandFailureObserved: false,
    createProcessFailureObserved: false,
    resourceExhaustionObserved: false,
    approvalFailureObserved: false,
    nonzeroExitObserved: false,
  };

  it("accepts one completed controlled pwd without publishing its output", () => {
    for (const output of [
      completed,
      completed.replace("Process exited with code 0", "Exit code: 0"),
      completed.replaceAll("\n", "\r\n"),
    ]) {
      const shape = inspectJoinedToolOutput([output], checkout);
      expect(shape).toEqual(noFailure);
      expect(() => requireJoinedToolCompletion(shape)).not.toThrow();
      expect(JSON.stringify(shape)).not.toContain(checkout);
      expect(JSON.stringify(shape)).not.toContain("Final output");
    }
  });

  it.each([
    ["missing output", []],
    ["empty output", [""]],
    ["nonempty pre-spawn error", [privateDetail]],
    ["workspace without a terminal exit", [`Final output:\n${checkout}\n`]],
    ["exit without workspace", ["Process exited with code 0\n"]],
    ["another workspace", [completed.replace(checkout, checkout + "-other")]],
    [
      "path embedded in an error",
      [completed.replace(checkout, `error: ${checkout}`)],
    ],
    [
      "exit embedded in an error",
      [completed.replace("Process exited", "error: Process exited")],
    ],
    ["split proof across outputs", [checkout, "Process exited with code 0"]],
    ["duplicate command replies", [completed, completed]],
  ] as const)("rejects %s before provider continuation", (_name, outputs) => {
    const shape = inspectJoinedToolOutput(outputs, checkout);
    expect(() => requireJoinedToolCompletion(shape)).toThrow();
  });

  it.each([
    ["runningSessionObserved", "Process running with session ID 12345"],
    ["execCommandFailureObserved", "exec_command failed: " + privateDetail],
    [
      "execCommandFailureObserved",
      "unified exec is unavailable in this session",
    ],
    [
      "execCommandFailureObserved",
      "unknown turn environment id: " + privateDetail,
    ],
    [
      "createProcessFailureObserved",
      "CreateProcess { message: " + privateDetail + " }",
    ],
    [
      "resourceExhaustionObserved",
      "Resource temporarily unavailable (os error 11)",
    ],
    ["resourceExhaustionObserved", "Cannot allocate memory (ENOMEM)"],
    ["resourceExhaustionObserved", "Too many open files (EMFILE)"],
    ["approvalFailureObserved", "approval required: " + privateDetail],
    ["approvalFailureObserved", "command rejected by user"],
    ["nonzeroExitObserved", "Process exited with code 1"],
    ["nonzeroExitObserved", "Exit code: -1"],
    ["unknownToolObserved", "unknown tool: " + privateDetail],
    [
      "invalidArgumentsObserved",
      "failed to parse tool arguments: " + privateDetail,
    ],
    [
      "invalidArgumentsObserved",
      "failed to parse function arguments: " + privateDetail,
    ],
    ["sandboxFailureObserved", "sandbox unavailable: " + privateDetail],
  ] as const)(
    "reports only fixed %s and rejects contradictory completion",
    (field, detail) => {
      const shape = inspectJoinedToolOutput(
        [completed + detail + "\n"],
        checkout,
      );
      expect(shape[field]).toBe(true);
      let failure: unknown;
      try {
        requireJoinedToolCompletion(shape);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(JSON.stringify(shape)).not.toContain(checkout);
      expect(JSON.stringify(shape)).not.toContain(privateDetail);
      expect(String(failure)).not.toContain(checkout);
      expect(String(failure)).not.toContain(privateDetail);
    },
  );
});

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
