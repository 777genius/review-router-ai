import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import {
  loadCorpus,
  corpusEventId,
  corpusEventMessages,
  type CorpusThread,
  type CorpusName,
} from "./corpus.js";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : (args[index + 1] ?? fallback);
};
const corpusName = option("--corpus", "legacy-v1") as CorpusName;
const corpus = await loadCorpus(corpusName);
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
  report.profile.commonPromptSourceDigest = createHash("sha256")
    .update(
      await readFile(
        new URL(
          "../../packages/features/conversations/src/application/process-conversation.ts",
          import.meta.url,
        ),
      ),
    )
    .digest("hex");
  let prisma: PrismaClient | undefined;
  try {
    if (split === "holdout" && !report.holdoutCheckpoint)
      throw new Error("eval_holdout_checkpoint_required");
    const threads = corpus.threads.filter((thread) => thread.split === split);
    for (const variant of variants) {
      if (variant === "parser-baseline") {
        if (!process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR) {
          report.variants.push({
            variant,
            status: "UNAVAILABLE",
            reason: "pinned_action_source_missing",
          });
          continue;
        }
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
      const missing = [
        "REVIEW_ROUTER_MEMORY_HINDSIGHT_URL",
        "REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY",
        "REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_QUALIFICATION",
        "REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_MISSION",
        "REVIEW_ROUTER_CONVERSATION_QUALIFICATION",
        "REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN",
        "REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER",
        "CONVERSATION_EVAL_TEMPLATE_WORKSPACE_ID",
        "CONVERSATION_EVAL_TEMPLATE_REPOSITORY_ID",
      ].filter((key) => !process.env[key]);
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
        !url.pathname.endsWith("_test")
      )
        throw new Error("eval_requires_disposable_loopback_database");
      const { PrismaClient } = await import("@prisma/client");
      const { PrismaPg } = await import("@prisma/adapter-pg");
      const { createEvaluationFixture } = await import("./fixture.js");
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
      for (const [scenario, scenarioThreads] of grouped) {
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
        });
        const coldStart = await fixture.coldStart();
        const observations: unknown[] = [];
        for (const thread of scenarioThreads) {
          for (const event of thread.events) {
            if (variant === "native-selection-only")
              observations.push({
                eventId: corpusEventId(thread, event),
                selection: await fixture.nativeOnly(thread, event),
                durableEffects: 0,
                productAnswer: null,
              });
            else observations.push(await fixture.run(thread, event));
          }
          if (thread.afterMutation && variant === "full-product") {
            const mutation = await fixture.mutate(thread.afterMutation.kind);
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
            const followup = await fixture.run(repeated, {
              messageId: id,
              action: "created",
              eligibleFactIds: [],
              requiredFactIds: [],
              expectedReply: thread.afterMutation.expectedReply,
              forbiddenEffects: [],
              criticalSlices: [],
            });
            if (
              followup.deliveredBodyDigests.some((hash) =>
                mutation.revokedBodyDigests.includes(hash),
              )
            )
              throw new Error("eval_revoked_memory_delivered_after_mutation");
            observations.push({ mutation, followup });
          }
        }
        scenarios.push({
          scenario,
          namespace: fixture.namespace,
          scope: fixture.scope,
          scopes: fixture.scopes,
          processingScope: fixture.processingScope,
          coldStart,
          observations,
        });
      }
      const incomplete = scenarios.some((scenario) =>
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
      report.variants.push({
        variant,
        status: incomplete ? "UNAVAILABLE" : "AWAITING_HUMAN_RUBRIC",
        scenarios,
      });
    }
    report.status = report.variants.some(
      (result) => result.status === "UNAVAILABLE",
    )
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
