import assert from "node:assert/strict";

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
