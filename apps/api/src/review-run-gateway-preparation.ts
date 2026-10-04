import * as c from "@agent-teams/account-gateway/contracts";
import {
  canonicalJson,
  parseReviewRunGatewayExecutionBinding,
  parseReviewRunRuntimeSnapshot,
  reviewRunGatewayOwnedIdentity,
  type ReviewRunAuthorizationQueryPort,
  type ReviewRunGatewayExecutionBinding,
  type ReviewRunGatewayExecutionBindingPort,
  type ReviewRunRuntimeSnapshotPort,
  type VerifiedScmRunIdentity,
} from "@reviewrouter/features-review-run-control";
import {
  createRunAccessClient,
  type RunAccessConfig,
} from "./account-gateway-run-access";

export type ReviewRunGatewayPreparationResult =
  | { readonly status: "denied" | "conflict" }
  | {
      readonly status: "prepared" | "restored";
      readonly binding: ReviewRunGatewayExecutionBinding;
    };

/** Backend-only composition for ONE already authorized owned run. The caller
 * supplies verified identity, never limits/profile/epoch/operation or credentials.
 * No transport/capability is returned through the safe selected-facts result. */
export function createReviewRunGatewayPreparation(input: {
  readonly authorizationId: string;
  readonly identity: VerifiedScmRunIdentity;
  readonly runAccess: RunAccessConfig;
  readonly authorizations: ReviewRunAuthorizationQueryPort;
  readonly snapshots: ReviewRunRuntimeSnapshotPort;
  readonly bindings: ReviewRunGatewayExecutionBindingPort;
}) {
  const authorizationId = input.authorizationId;
  const identity = reviewRunGatewayOwnedIdentity(input.identity);
  const authorizations = input.authorizations;
  const snapshots = input.snapshots;
  const bindings = input.bindings;
  const client = createRunAccessClient(input.runAccess);
  let initialAttempted = false;
  let inFlight = false;

  async function run(
    recovery: boolean,
  ): Promise<ReviewRunGatewayPreparationResult> {
    if (inFlight) return { status: "denied" };
    inFlight = true;
    try {
      const authorization =
        await authorizations.findReviewRunAuthorizationById(authorizationId);
      if (
        !authorization ||
        authorization.state !== "active" ||
        !Object.entries(identity).every(
          ([key, value]) => Reflect.get(authorization, key) === value,
        )
      )
        return { status: "denied" };
      const canonical = authorization.runtimeSnapshotCanonicalJson;
      const snapshot = parseReviewRunRuntimeSnapshot(canonical);
      const original = snapshot?.gateway;
      if (
        !canonical ||
        !snapshot ||
        !original?.limits ||
        authorization.maxExpiresAt.toISOString() !== snapshot.deadline
      )
        return { status: "denied" };
      // The SDK is the authoritative Prepare boundary. Parse/copy the COMPLETE
      // pinned intent before awaiting live authority; never read current policy.
      const intent = c.prepare.parse({
        operationId: original.operationId,
        invocationRef: original.invocationId,
        attemptRef: original.attemptId,
        accountRefs: [original.permittedAccountRef],
        subjectRef: original.policySubject,
        policyRevision: original.policyRevision,
        bindingRevision: original.bindingRevision,
        profileId: original.profileRef,
        limits: { ...original.limits },
        deadline: snapshot.deadline,
      });
      Object.freeze(intent.accountRefs);
      Object.freeze(intent.limits);
      Object.freeze(intent);
      const cutoff = Math.min(
        authorization.expiresAt.getTime(),
        Date.parse(intent.deadline),
      );
      const live = () => Date.now() < cutoff;
      if (!live()) return { status: "denied" };
      const owner = {
        authorizationId,
        identity,
        runtimeSnapshotCanonicalJson: canonical,
      };
      const saved = await bindings.read(owner);
      if (!live() || saved.status !== "live") return { status: "denied" };
      // Ordinary restore is a private SQL read. Reacquiring run access after a
      // lost HTTP/attachment requires the explicit same-operation entry point.
      if (saved.binding && !recovery)
        return { status: "restored", binding: saved.binding };
      if (!recovery && initialAttempted) return { status: "denied" };
      if (
        !(await snapshots.isLive({ snapshot, identity, now: new Date() })) ||
        !live()
      )
        return { status: "denied" };
      const remaining = cutoff - Date.now();
      if (remaining <= 0) return { status: "denied" };
      initialAttempted = true;
      // One no-retry HTTP call. Unknown/pending/lost responses throw the existing
      // sanitized GatewayError; this function never infers a replacement intent.
      const prepared = await client.prepare(intent, {
        signal: AbortSignal.timeout(Math.min(remaining, 2_147_483_647)),
      });
      if (!live()) return { status: "denied" };
      const operation = c.preparationOperation.parse(prepared.operation);
      if (
        operation.state !== "applied" ||
        operation.result?.kind !== "execution" ||
        operation.operationRef !== intent.operationId ||
        operation.result.state !== "active"
      )
        throw new Error("review_run_gateway_result_invalid");
      const selected = operation.result;
      const admission = c.admission.parse(prepared.admission);
      const expectedAdmission = c.admission.parse({
        invocationRef: intent.invocationRef,
        attemptRef: intent.attemptRef,
        accountRef: selected.accountRef,
        authorizationEpoch: selected.authorizationEpoch,
        subjectRef: intent.subjectRef,
        policyRevision: intent.policyRevision,
        bindingRevision: intent.bindingRevision,
        profileId: intent.profileId,
        limits: { ...intent.limits },
        expiresAt: intent.deadline,
      });
      if (
        selected.accountRef !== original.permittedAccountRef ||
        selected.deadline !== intent.deadline ||
        prepared.executionRef !== selected.executionRef ||
        canonicalJson(admission) !== canonicalJson(expectedAdmission)
      )
        throw new Error("review_run_gateway_result_invalid");
      const binding = parseReviewRunGatewayExecutionBinding(
        canonicalJson({
          bindingVersion: 1,
          operationId: intent.operationId,
          executionRef: selected.executionRef,
          accountRef: selected.accountRef,
          authorizationEpoch: selected.authorizationEpoch,
          deadline: intent.deadline,
        }),
      );
      if (
        saved.binding &&
        canonicalJson(saved.binding) !== canonicalJson(binding)
      )
        return { status: "conflict" };
      // ExecutionClient and the control credential remain inside backend closures;
      // only this safe projection enters SQL. Attachment loss is caller-recovered.
      const attached = await bindings.attach(owner, binding);
      if (!live()) return { status: "denied" };
      if (attached.status === "attached" || attached.status === "restored") {
        return {
          status: attached.status === "attached" ? "prepared" : "restored",
          binding: attached.binding,
        };
      }
      return { status: attached.status };
    } finally {
      inFlight = false;
    }
  }
  return Object.freeze({
    prepare: () => run(false),
    recoverSameOperation: () => run(true),
  });
}
