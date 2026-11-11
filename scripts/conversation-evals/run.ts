import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { currentConversationSourceStamp } from "../check-conversation-source-stamp.ts";
import type { PrismaClient } from "@prisma/client";
import {
  loadCorpus,
  corpusEventId,
  corpusEventMessages,
  type CorpusThread,
  type CorpusName,
} from "./corpus.js";
import {
  assertEvaluationNativeScope,
  evaluationMissingKeys,
  gatewayOneTurnCandidateMechanism,
  readCandidateModels,
} from "./configuration.js";

import { gatewayCandidateCleanupSettled } from "./gateway-receipt.js";
import {
  evaluationBoundaryDiagnostic,
  type EvaluationPhase,
} from "./boundary-diagnostic.js";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : (args[index + 1] ?? fallback);
};
const corpusName = option("--corpus", "legacy-v1") as CorpusName;
const corpus = await loadCorpus(corpusName);
const scenarioIndex = args.indexOf("--scenario");
const diagnosticScenario =
  scenarioIndex < 0 ? undefined : args[scenarioIndex + 1];
if (scenarioIndex >= 0) {
  if (
    args.filter((argument) => argument === "--scenario").length !== 1 ||
    !diagnosticScenario ||
    diagnosticScenario.startsWith("--")
  )
    throw new Error("eval_scenario_required");
  if (args.includes("--validate") || option("--split", "tuning") !== "tuning")
    throw new Error("eval_scenario_tuning_only");
  if (
    !corpus.threads.some(
      (thread) =>
        thread.split === "tuning" && thread.scenario === diagnosticScenario,
    )
  )
    throw new Error("eval_scenario_unknown");
}
if (args.includes("--validate")) {
  console.log(
    JSON.stringify(
      {
        status: "VALID",
        revision: corpus.revision,
        threads: corpus.threads.length,
        tuning: corpus.threads.filter((thread) => thread.split === "tuning")
          .length,
        holdout: corpus.threads.filter((thread) => thread.split === "holdout")
          .length,
        humanEvents: corpus.threads.reduce((n, t) => n + t.events.length, 0),
        eligibleFacts: corpus.facts.length,
        linkedPairs: corpus.threads.filter(
          (thread) => thread.linked && thread.phase === "A",
        ).length,
      },
      null,
      2,
    ),
  );
} else {
  const split = option("--split", "tuning");
  if (!["tuning", "holdout"].includes(split))
    throw new Error("eval_split_invalid");
  const variantOption = option("--variant", "full-product");
  const variants =
    variantOption === "all"
      ? ["parser-baseline", "native-selection-only", "full-product"]
      : [variantOption];
  if (
    variants.some(
      (v) =>
        !["parser-baseline", "native-selection-only", "full-product"].includes(
          v,
        ),
    )
  )
    throw new Error("eval_variant_invalid");
  const runId = randomUUID();
  const output = resolve(
    option(
      "--out",
      `tmp/conversational-memory-implementation/conversation-eval-${runId}.json`,
    ),
  );
  const report: {
    version: string;
    runId: string;
    corpusRevision: string;
    corpusName: CorpusName;
    split: string;
    holdoutCheckpoint: string | null;
    status: string;
    diagnosticScenario?: string;
    qualificationEligible?: false;
    reason?: "diagnostic_subset_not_qualification";
    profile: Record<string, unknown>;
    variants: Record<string, unknown>[];
  } = {
    version: "conversation-quality-results.v1",
    runId,
    corpusRevision: corpus.revision,
    corpusName,
    split,
    holdoutCheckpoint:
      process.env.CONVERSATION_EVAL_HOLDOUT_CHECKPOINT_ID ?? null,
    status: "UNAVAILABLE",
    ...(diagnosticScenario
      ? {
          diagnosticScenario,
          qualificationEligible: false as const,
          reason: "diagnostic_subset_not_qualification" as const,
        }
      : {}),
    profile: {
      nativeQualificationDigest: process.env
        .REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_QUALIFICATION
        ? createHash("sha256")
            .update(
              process.env.REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_QUALIFICATION,
            )
            .digest("hex")
        : null,
      missionDigest: process.env.REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_MISSION
        ? createHash("sha256")
            .update(process.env.REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_MISSION)
            .digest("hex")
        : null,
      gatewayQualificationDigest: process.env
        .REVIEW_ROUTER_CONVERSATION_QUALIFICATION
        ? createHash("sha256")
            .update(process.env.REVIEW_ROUTER_CONVERSATION_QUALIFICATION)
            .digest("hex")
        : null,
      connectionClass: "selected-review-account-gateway",
      productionActivated: false,
      extractionMechanism: variants.includes("full-product")
        ? gatewayOneTurnCandidateMechanism
        : "historical-native-preview",
      candidateModelBoundsDigest: process.env
        .CONVERSATION_EVAL_MODEL_BOUNDS_JSON
        ? createHash("sha256")
            .update(process.env.CONVERSATION_EVAL_MODEL_BOUNDS_JSON)
            .digest("hex")
        : null,
    },
    variants: [],
  };
  const nativeQualification =
    process.env.REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_QUALIFICATION;
  if (nativeQualification) {
    try {
      const value = JSON.parse(nativeQualification) as Record<string, unknown>;
      report.profile.nativeExpectedImageDigest = value.imageDigest;
      report.profile.nativeModel = value.model;
      report.profile.nativeInputProfile = value.privacyProfile;
      report.profile.nativeStrictPreviewVersion = value.strictPreviewVersion;
      report.profile.nativeQualificationProofId = value.proofId;
    } catch {
      /* Invalid configuration remains unavailable at the owning adapter. */
    }
  }
  report.profile.storageProfile =
    process.env.REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE ?? null;
  // Use the same checked installed SDK identity as the deployment stamp.
  const sourceProfile = (
    await currentConversationSourceStamp(
      fileURLToPath(new URL("../..", import.meta.url)),
    )
  ).sourceProfile;
  Object.assign(report.profile, sourceProfile);
  let prisma: PrismaClient | undefined;
  let phase: EvaluationPhase = "configuration";
  try {
    if (split === "holdout" && !report.holdoutCheckpoint)
      throw new Error("eval_holdout_checkpoint_required");
    const threads = corpus.threads.filter(
      (thread) =>
        thread.split === split &&
        (!diagnosticScenario || thread.scenario === diagnosticScenario),
    );
    for (const variant of variants) {
      phase = "configuration";
      if (variant === "parser-baseline") {
        if (!process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR) {
          report.variants.push({
            variant,
            status: "UNAVAILABLE",
            reason: "pinned_action_source_missing",
          });
          continue;
        }
        phase = "parser_import";
        const { parseMemoryInteraction } = (await import(
          pathToFileURL(
            resolve(
              process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR,
              "src/github/memory-interaction.ts",
            ),
          ).href
        )) as {
          parseMemoryInteraction(body: string): {
            instructions: { type: string; candidateBody?: string }[];
          };
        };
        phase = "parser_execution";
        const observations = threads.flatMap((thread) =>
          thread.events.map((event) => ({
            eventId: corpusEventId(thread, event),
            sourceRevision: corpusEventMessages(thread, event).find(
              (message) => message.id === event.messageId,
            )!.updatedAt,
            selectedStatements: parseMemoryInteraction(
              corpusEventMessages(thread, event).find(
                (message) => message.id === event.messageId,
              )!.body,
            )
              .instructions.filter(
                (instruction) => instruction.type === "candidate",
              )
              .map((instruction) => instruction.candidateBody),
            memoryInput: false,
            modelCalls: 0,
            durableEffects: 0,
          })),
        );
        report.variants.push({ variant, status: "OBSERVED", observations });
        continue;
      }
      const database = process.env.CONVERSATION_EVAL_DATABASE_URL;
      const missing = evaluationMissingKeys(variant, process.env);
      if (
        process.env.CONVERSATION_EVAL_LIVE !== "1" ||
        process.env.CONVERSATION_EVAL_DISPOSABLE !== "1" ||
        !database ||
        missing.length
      ) {
        report.variants.push({
          variant,
          status: "UNAVAILABLE",
          reason: "qualified_live_configuration_missing",
          missingKeys: missing,
        });
        continue;
      }
      const url = new URL(database);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !url.pathname.endsWith("_test") ||
        url.search !== "" ||
        url.hash !== ""
      )
        throw new Error("eval_requires_disposable_loopback_database");
      assertEvaluationNativeScope(process.env);
      const candidateModels =
        variant === "full-product"
          ? readCandidateModels(process.env.CONVERSATION_EVAL_MODEL_BOUNDS_JSON)
          : undefined;
      phase = "runtime_import";
      const { PrismaClient } = await import("@prisma/client");
      const { PrismaPg } = await import("@prisma/adapter-pg");
      const { createEvaluationFixture } = await import("./fixture.js");
      phase = "database_client";
      prisma ??= new PrismaClient({
        adapter: new PrismaPg({ connectionString: database, max: 4 }),
      });
      const grouped = new Map<string, CorpusThread[]>();
      for (const thread of threads)
        grouped.set(thread.scenario, [
          ...(grouped.get(thread.scenario) ?? []),
          thread,
        ]);
      const scenarios: Record<string, unknown>[] = [];
      const variantResult = { variant, status: "UNAVAILABLE", scenarios };
      report.variants.push(variantResult);
      let gatewayCleanupUnsettled = false;
      // A full-product event may make one extraction and one reply call.
      // Keep :free evaluation bursts below OpenRouter's documented 20 RPM;
      // pacing precedes product deadlines and does not retry any attempt.
      const eventIntervalMs = candidateModels?.some(
        (model) =>
          model.profileId === "openrouter-openai-responses-apikey-v1" &&
          model.model.endsWith(":free"),
      )
        ? 7000
        : 0;
      let nextEventAt = 0;
      for (const [scenario, scenarioThreads] of grouped) {
        phase = "fixture_creation";
        const fixture = await createEvaluationFixture({
          prisma,
          env: process.env,
          runId: `${runId}:${variant}`,
          scenario,
          corpusName,
          repositoryKeys: [
            ...new Set(
              scenarioThreads.map((thread) => thread.repositoryKey ?? "main"),
            ),
          ],
          template: {
            workspaceId: process.env.CONVERSATION_EVAL_TEMPLATE_WORKSPACE_ID!,
            repositoryId: process.env.CONVERSATION_EVAL_TEMPLATE_REPOSITORY_ID!,
          },
          variant:
            variant === "native-selection-only"
              ? "native-selection-only"
              : "full-product",
          ...(candidateModels ? { candidateModels } : {}),
        });
        phase = "cold_start";
        const coldStart = await fixture.coldStart();
        const observations: unknown[] = [];
        scenarios.push({
          scenario,
          namespace: fixture.namespace,
          scope: fixture.scope,
          scopes: fixture.scopes,
          processingScope: fixture.processingScope,
          coldStart,
          observations,
        });
        for (const thread of scenarioThreads) {
          for (const event of thread.events) {
            const waitMs = Math.max(0, nextEventAt - Date.now());
            if (waitMs) await new Promise((done) => setTimeout(done, waitMs));
            nextEventAt = Date.now() + eventIntervalMs;
            phase = "event_execution";
            if (variant === "native-selection-only")
              observations.push({
                eventId: corpusEventId(thread, event),
                selection: await fixture.nativeOnly(thread, event),
                durableEffects: 0,
                productAnswer: null,
              });
            else {
              const witness = await fixture.run(thread, event);
              observations.push(witness);
              if (!gatewayCandidateCleanupSettled(witness)) {
                gatewayCleanupUnsettled = true;
                break;
              }
            }
          }
          if (gatewayCleanupUnsettled) break;
          if (thread.afterMutation && variant === "full-product") {
            phase = "mutation";
            const mutation = await fixture.mutate(thread.afterMutation.kind);
            const mutationObservation: {
              mutation: typeof mutation;
              followup?: unknown;
            } = { mutation };
            observations.push(mutationObservation);
            const repeated = structuredClone(thread);
            const id = `${thread.id}-after-mutation-${runId}`;
            const time = new Date().toISOString();
            repeated.messages.push({
              id,
              actor: "maintainer",
              actorKind: "human",
              role: "maintainer",
              body: thread.afterMutation.repeatQuestion,
              createdAt: time,
              updatedAt: time,
              replyTo: repeated.messages[0]!.id,
            });
            phase = "mutation_followup";
            const followup = await fixture.run(repeated, {
              messageId: id,
              action: "created",
              eligibleFactIds: [],
              requiredFactIds: [],
              expectedReply: thread.afterMutation.expectedReply,
              forbiddenEffects: [],
              criticalSlices: [],
            });
            mutationObservation.followup = followup;
            if (
              followup.deliveredBodyDigests.some((hash) =>
                mutation.revokedBodyDigests.includes(hash),
              )
            )
              throw new Error("eval_revoked_memory_delivered_after_mutation");
            if (!gatewayCandidateCleanupSettled(followup)) {
              gatewayCleanupUnsettled = true;
              break;
            }
          }
        }
        // Preserve the actual witness and stop; a new paid attempt cannot settle cleanup debt.
        if (gatewayCleanupUnsettled) break;
      }
      phase = "result_assembly";
      const incomplete =
        gatewayCleanupUnsettled ||
        scenarios.some((scenario) =>
          (scenario.observations as Record<string, unknown>[]).some(
            (observation) => {
              const actual = (observation.followup ?? observation) as Record<
                string,
                unknown
              >;
              return (
                [
                  "unavailable",
                  "output_unavailable",
                  "unknown",
                  "context_incomplete",
                  "stale",
                ].includes(String(actual.status)) ||
                (typeof actual.selection === "object" &&
                  actual.selection !== null &&
                  !["complete", "not_applicable"].includes(
                    String((actual.selection as { status?: string }).status),
                  ))
              );
            },
          ),
        );
      variantResult.status = incomplete
        ? "UNAVAILABLE"
        : "AWAITING_HUMAN_RUBRIC";
    }
    report.status =
      diagnosticScenario !== undefined ||
      report.variants.some((result) => result.status === "UNAVAILABLE")
        ? "UNAVAILABLE"
        : "AWAITING_HUMAN_RUBRIC";
  } catch (error) {
    report.status = "UNAVAILABLE";
    report.variants.push({
      status: "UNAVAILABLE",
      reason:
        error instanceof Error && /^[a-zA-Z0-9_:-]{1,160}$/.test(error.message)
          ? error.message
          : "evaluation_boundary_failed",
      diagnostic: evaluationBoundaryDiagnostic(phase, error),
    });
  } finally {
    await prisma?.$disconnect();
    await mkdir(resolve(output, ".."), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(
    JSON.stringify(
      {
        status: report.status,
        ...(diagnosticScenario
          ? {
              diagnosticScenario,
              qualificationEligible: false,
              reason: "diagnostic_subset_not_qualification",
            }
          : {}),
        runId,
        output,
        variants: report.variants.map((result) => ({
          variant: result.variant,
          status: result.status,
        })),
      },
      null,
      2,
    ),
  );
  process.exitCode = report.status === "UNAVAILABLE" ? 2 : 3;
}
