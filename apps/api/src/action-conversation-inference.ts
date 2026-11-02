import * as c from "@agent-teams/account-gateway/contracts";
import { GatewayError } from "@agent-teams/account-gateway/http";
import {
  createLlmClient,
  type ConsumerControlPort,
  type ExecutionConnector,
  type LlmTask,
  type LlmResult,
} from "@agent-teams/account-gateway/llm";
import {
  ConversationError,
  assertConversationLive,
  type TextInferencePort,
  type RequestControls,
} from "@reviewrouter/features-conversations";

/** Bodyless settlement facts of the one original SDK attempt, including failed output. */
export type ConversationGatewayObservation = {
  readonly model: string | null;
  readonly usage: LlmResult<unknown>["usage"];
  readonly effect: import("@agent-teams/account-gateway/llm").LlmEffect;
  readonly cleanup: LlmResult<unknown>["cleanup"];
};

/** One selected-account task. The SDK owns request encoding, reduction, readback and close. */
export function createConversationGatewayInference(input: {
  readonly control: ConsumerControlPort;
  readonly connectExecution: ExecutionConnector;
  readonly prepare: c.Prepare;
  readonly model: string;
  readonly reasoningEffort?: "medium";
  readonly expectedAuthorizationEpoch?: number;
  readonly checkAuthority: (controls: RequestControls) => Promise<boolean>;
  readonly admitDispatch?: (controls: RequestControls) => Promise<boolean>;
  readonly onObserved?: (
    value: ConversationGatewayObservation,
  ) => Promise<void>;
}): TextInferencePort {
  const prepare = c.prepare.parse(input.prepare);
  const model = input.model;
  if (prepare.accountRefs.length !== 1)
    throw new ConversationError("forbidden");
  let attempted = false;
  return Object.freeze({
    async generate(request, outerControls, beforeDispatch) {
      if (attempted) throw new ConversationError("conflict");
      const deadlineAt = new Date(
        Math.min(
          outerControls.deadlineAt.getTime(),
          Date.parse(prepare.deadline),
        ),
      );
      const remaining = deadlineAt.getTime() - Date.now();
      if (remaining <= 0) throw new ConversationError("unavailable");
      const signal = outerControls.signal
        ? AbortSignal.any([
            outerControls.signal,
            AbortSignal.timeout(remaining),
          ])
        : AbortSignal.timeout(remaining);
      const controls = { deadlineAt, signal };
      assertConversationLive(controls);
      if (!(await input.checkAuthority(controls)))
        throw new ConversationError("forbidden");
      attempted = true; // Neither an ambiguous grant nor lost output buys another attempt.
      const task: LlmTask = {
        taskId: prepare.invocationRef,
        attempt: 1,
        profileId: prepare.profileId,
        model,
        accountRefs: [...prepare.accountRefs],
        policy: {
          subjectRef: prepare.subjectRef,
          policyRevision: prepare.policyRevision,
          bindingRevision: prepare.bindingRevision,
        },
        instructions: request.instructions,
        input: request.messages.map((message) => ({
          role: message.role,
          text: message.content,
        })),
        output: request.outputSchema
          ? { mode: "json_schema", schema: request.outputSchema.schema }
          : { mode: "text" },
        ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {}),
        maxOutputTokens: prepare.limits.tokens,
        deadline: deadlineAt,
        limits: { outputBytes: Math.min(262_144, prepare.limits.outputBytes) },
      };
      const llm = createLlmClient({
        controlTimeoutMs: 2000,
        control: {
          async runAccess(intent, options) {
            // SDK computes the exact encoded byte length; the frozen host ceiling remains authoritative.
            if (
              intent.limits.requestBytes >
              Math.min(131_072, prepare.limits.requestBytes)
            )
              throw new GatewayError("invalid_input", "not_dispatched");
            return input.control.runAccess(intent, options);
          },
        },
        connectExecution(grant) {
          const execution = input.connectExecution(grant);
          return {
            ...execution,
            async request(executionRef, request, options) {
              try {
                assertConversationLive(controls);
                if (
                  (input.expectedAuthorizationEpoch !== undefined &&
                    request.admission.authorizationEpoch !==
                      input.expectedAuthorizationEpoch) ||
                  !(await input.checkAuthority(controls)) ||
                  (beforeDispatch && !(await beforeDispatch(controls))) ||
                  (input.admitDispatch &&
                    !(await input.admitDispatch(controls)))
                )
                  throw new Error();
                assertConversationLive(controls);
              } catch {
                throw new GatewayError("safe_error", "not_dispatched");
              }
              return execution.request(executionRef, request, options);
            },
          };
        },
      });
      try {
        const result = await llm.generate(task, { signal });
        await input.onObserved?.({
          model: result.ok ? result.receipt.observedModel : null,
          usage: result.usage,
          effect: result.ok ? "completed" : result.effect,
          cleanup: result.cleanup,
        });
        if (
          !result.ok ||
          result.cleanup !== "closed" ||
          result.receipt.observedModel !== model ||
          !result.text ||
          Buffer.byteLength(result.text) > 16_384
        )
          throw new ConversationError("unavailable");
        assertConversationLive(controls);
        const usage = result.usage;
        return {
          text: result.text,
          actualModel: result.receipt.observedModel,
          usage:
            usage.inputTokens !== null &&
            usage.outputTokens !== null &&
            Number.isSafeInteger(usage.inputTokens) &&
            usage.inputTokens >= 0 &&
            Number.isSafeInteger(usage.outputTokens) &&
            usage.outputTokens >= 0
              ? {
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                }
              : null,
          effect: "completed" as const,
        };
      } catch {
        throw new ConversationError("unavailable");
      }
    },
  } satisfies TextInferencePort);
}
