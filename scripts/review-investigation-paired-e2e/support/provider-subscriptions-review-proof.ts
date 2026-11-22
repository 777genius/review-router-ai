import assert from "node:assert/strict";

/** Fixed facts from the controlled `pwd` reply. Raw output stays in memory. */
export function inspectJoinedToolOutput(
  outputs: readonly string[],
  checkout: string,
) {
  return {
    functionOutputs: outputs.length,
    workspaceObserved: outputs.some((output) =>
      output.split(/\r?\n/u).includes(checkout),
    ),
    exitZeroObserved: outputs.some((output) =>
      /^(?:Process exited with code|Exit code:) 0[\t ]*$/mu.test(output),
    ),
    unknownToolObserved: outputs.some((output) =>
      /(?:unknown|unsupported|unrecognized) tool/iu.test(output),
    ),
    invalidArgumentsObserved: outputs.some((output) =>
      /(?:invalid|failed to parse) (?:(?:tool|function) )?arguments/iu.test(
        output,
      ),
    ),
    sandboxFailureObserved: outputs.some((output) =>
      /sandbox.*(?:failed|denied|unavailable)/iu.test(output),
    ),
    runningSessionObserved: outputs.some((output) =>
      /Process running with session ID\b/iu.test(output),
    ),
    execCommandFailureObserved: outputs.some((output) =>
      /(?:exec_command failed|unified exec is unavailable in this session|unknown turn environment id)\b/iu.test(
        output,
      ),
    ),
    createProcessFailureObserved: outputs.some((output) =>
      /\bCreateProcess\b/u.test(output),
    ),
    resourceExhaustionObserved: outputs.some((output) =>
      /\b(?:Resource temporarily unavailable|Cannot allocate memory|Too many open files|No space left on device|Resource exhausted|EAGAIN|ENOMEM|EMFILE|ENFILE|ENOSPC)\b/iu.test(
        output,
      ),
    ),
    approvalFailureObserved: outputs.some((output) =>
      /\b(?:approval (?:required|denied|rejected|refused|failed|unavailable)|requires? approval|not approved|rejected by user)\b/iu.test(
        output,
      ),
    ),
    nonzeroExitObserved: outputs.some((output) =>
      /^(?:Process exited with code|Exit code:) -?[1-9]\d*[\t ]*$/mu.test(
        output,
      ),
    ),
  };
}

export function requireJoinedToolCompletion(
  shape: ReturnType<typeof inspectJoinedToolOutput>,
): void {
  assert.equal(
    shape.functionOutputs,
    1,
    "joined review must return exactly one controlled command output",
  );
  assert.ok(
    shape.workspaceObserved &&
      shape.exitZeroObserved &&
      !shape.unknownToolObserved &&
      !shape.invalidArgumentsObserved &&
      !shape.sandboxFailureObserved &&
      !shape.runningSessionObserved &&
      !shape.execCommandFailureObserved &&
      !shape.createProcessFailureObserved &&
      !shape.resourceExhaustionObserved &&
      !shape.approvalFailureObserved &&
      !shape.nonzeroExitObserved,
    "controlled pwd must complete successfully before provider continuation",
  );
}

/** An explicit native capability case, separate from the default CLI policy. */
export type JoinedReasoningReviewProof = Readonly<{
  reasoningEffort: "medium";
  maxOutputTokens: 8192;
}>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Observe the canonical Responses boundary without interpreting provider data.
 * Opaque continuation bytes stay in memory and never enter the receipt. */
export function createJoinedReviewProof(
  requested: JoinedReasoningReviewProof | undefined,
  qualifiedTokens: number,
) {
  if (requested) {
    assert.deepEqual(requested, {
      reasoningEffort: "medium",
      maxOutputTokens: 8192,
    });
    assert.ok(requested.maxOutputTokens <= qualifiedTokens);
  }
  const continuations = new Set<string>();
  let reasoningRequests = 0;
  let reasoningContinuations = 0;
  return {
    reasoningEffort: requested?.reasoningEffort,
    maxOutputTokens: requested?.maxOutputTokens ?? 100,
    // The explicit native capability enables the pinned CLI's own reasoning
    // encoder for this custom model. Omit summaries from its actual request;
    // the assertions below still require the CLI to emit the effort itself.
    modelConfigLines: requested
      ? [
          "model_supports_reasoning_summaries = true",
          'model_reasoning_summary = "none"',
        ]
      : [],
    assertRequest(raw: Readonly<Record<string, unknown>>, ordinal: number) {
      if (!requested) {
        assert.ok(
          raw.reasoning === undefined || raw.reasoning === null,
          "unsupported reasoning must not inherit ambient xhigh",
        );
        return;
      }
      assert.equal(record(raw.reasoning)?.effort, requested.reasoningEffort);
      reasoningRequests++;
      if (ordinal > 1) {
        assert.ok(
          continuations.size > 0,
          "native continuation must be observed first",
        );
        assert.ok(Array.isArray(raw.input));
        for (const opaque of continuations) {
          assert.ok(
            raw.input.some((item: unknown) => {
              const value = record(item);
              return (
                value?.type === "reasoning" &&
                value.encrypted_content === opaque
              );
            }),
            "the actual CLI must replay the exact opaque native continuation",
          );
          reasoningContinuations++;
        }
      }
    },
    assertForwarded(
      raw: Readonly<Record<string, unknown>>,
      forwarded: Readonly<Record<string, unknown>>,
    ) {
      if (!requested) {
        assert.ok(!("reasoning" in forwarded));
        return;
      }
      assert.deepEqual(forwarded.reasoning, raw.reasoning);
      assert.deepEqual(forwarded.input, raw.input);
      assert.equal(forwarded.max_output_tokens, requested.maxOutputTokens);
    },
    observeResponse(wire: string, ordinal: number) {
      if (!requested || ordinal !== 1) return;
      for (const line of wire.split(/\r?\n/u)) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        const event = record(JSON.parse(line.slice(6)) as unknown);
        const response = record(event?.response);
        const items =
          event?.type === "response.output_item.done"
            ? [event.item]
            : event?.type === "response.completed" &&
                Array.isArray(response?.output)
              ? response.output
              : [];
        for (const item of items) {
          const value = record(item);
          if (
            value?.type === "reasoning" &&
            typeof value.encrypted_content === "string" &&
            value.encrypted_content.length > 0
          )
            continuations.add(value.encrypted_content);
        }
      }
      assert.ok(
        continuations.size > 0,
        "native stream must carry an opaque continuation",
      );
    },
    receipt() {
      if (!requested) return { reasoningOmitted: true };
      assert.equal(reasoningRequests, 2);
      assert.ok(reasoningContinuations > 0);
      return {
        reasoningOmitted: false,
        reasoningEffort: requested.reasoningEffort,
        reasoningRequests,
        reasoningContinuations,
      };
    },
  };
}
