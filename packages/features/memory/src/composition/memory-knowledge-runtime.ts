import type { SourcePreviewPort } from "context-memory";
import type {
  MemoryAutomaticSourceCurrentPort,
  MemoryAutomaticSourceStore,
} from "../application/ports/memory-automatic-source-port";
import { MemoryAutomaticSourceService } from "../application/use-cases/memory-automatic-source-service";
import { PrismaMemoryAutomaticSourceStore } from "../infrastructure/prisma/prisma-memory-automatic-source-store";
import { validateMemoryOperatorCredentials } from "../infrastructure/config/memory-operator-config";
import {
  assemblyFor,
  implement,
  type CapabilityContract,
} from "@get-modular/assembly";
import { compileComposition, defineModule, required } from "@get-modular/core";
import type { PrismaClient } from "@prisma/client";
import { PrismaEntitlementRepository } from "@reviewrouter/features-entitlements";
import type { MemoryCleanupProofPort } from "../application/ports/memory-cleanup-proof-port";
import { createHindsightCleanupProofAdapter } from "../infrastructure/hindsight/hindsight-cleanup-proof-adapter";
import type { MemoryKnowledgeAccessPort } from "../application/ports/memory-knowledge-access-port";
import type {
  MemoryKnowledgeReader,
  MemoryKnowledgeWriter,
  MemoryOperationObserver,
} from "../application/ports/memory-knowledge-provider-port";
import type { MemoryKnowledgeStore } from "../application/ports/memory-knowledge-store-port";
import type { MemoryPolicyConfigPort } from "../application/ports/memory-policy-config-port";
import { MemoryKnowledgeService } from "../application/use-cases/memory-knowledge-service";
import { MemoryKnowledgeError } from "../domain/memory-knowledge";
import { parseMemoryProviderConfig } from "../infrastructure/config/memory-provider-config";
import { readMemoryServiceEnabled } from "../infrastructure/config/memory-service-flag";
import { EntitlementMemoryPolicyConfig } from "../infrastructure/entitlements/entitlement-memory-policy-config";
import { EntitlementMemoryQuotaPolicy } from "../infrastructure/entitlements/entitlement-memory-quota-policy";
import { HindsightMemoryProvider } from "../infrastructure/hindsight/hindsight-memory-provider";
import { PrismaMemoryKnowledgeStore } from "../infrastructure/prisma/prisma-memory-knowledge-store";

type Provider = MemoryKnowledgeReader &
  MemoryKnowledgeWriter &
  MemoryOperationObserver;
export type MemoryKnowledgeRuntime = {
  readonly enabled: boolean;
  readonly generation: string;
  readonly providerProfileVersion: string;
  readonly store: MemoryKnowledgeStore;
  readonly policy: MemoryPolicyConfigPort;
  readonly cleanupProof: MemoryCleanupProofPort | null;
  /** The host supplies an authenticated product/source context for each request. */
  readonly automaticSources: MemoryAutomaticSourceStore;
  forAccess(
    access: MemoryKnowledgeAccessPort,
    automaticCurrent?: MemoryAutomaticSourceCurrentPort,
  ): MemoryKnowledgeService;
  forAutomaticLearning(
    access: MemoryKnowledgeAccessPort,
    current: MemoryAutomaticSourceCurrentPort,
    preview: SourcePreviewPort,
  ): MemoryAutomaticSourceService;
};

class DisabledMemoryProvider implements Provider {
  async read(): ReturnType<MemoryKnowledgeReader["read"]> {
    throw new MemoryKnowledgeError("disabled");
  }
  async list(): ReturnType<MemoryKnowledgeReader["list"]> {
    throw new MemoryKnowledgeError("disabled");
  }
  async recall(): ReturnType<MemoryKnowledgeReader["recall"]> {
    throw new MemoryKnowledgeError("disabled");
  }
  async submit(): ReturnType<MemoryKnowledgeWriter["submit"]> {
    throw new MemoryKnowledgeError("disabled");
  }
  async observe(): ReturnType<MemoryOperationObserver["observe"]> {
    throw new MemoryKnowledgeError("disabled");
  }
}

const compatibility = {
  family: "exact",
  familyVersion: 1,
  token: "reviewrouter/memory-knowledge-v1",
} as const;
const owner = { authority: "reviewrouter", path: ["memory"] } as const;
const runtimeModule = defineModule({
  kind: "get-modular.module-declaration",
  schemaVersion: 1,
  moduleId: "reviewrouter/memory-knowledge-runtime",
  implementationId: "reviewrouter/memory-knowledge-runtime/product",
  owner,
  provides: [],
  slots: [
    {
      slotId: "provider",
      capabilityId: "reviewrouter/memory-knowledge-provider",
      compatibility,
      cardinality: required(),
    },
  ],
});
type Capabilities = {
  "reviewrouter/memory-knowledge-provider": CapabilityContract<
    Provider,
    "reviewrouter/memory-knowledge-v1"
  >;
};

/** No native I/O, database migrations or readiness dependency during composition. */
export async function createMemoryKnowledgeRuntime(input: {
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
}): Promise<MemoryKnowledgeRuntime> {
  const config = parseMemoryProviderConfig(input.env);
  validateMemoryOperatorCredentials({
    operatorToken: input.env.REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN,
    nativeServiceKey: config.kind === "hindsight" ? config.apiKey : undefined,
  });
  const enabled =
    config.kind !== "disabled" && readMemoryServiceEnabled(input.env);
  const providerProfileVersion =
    config.kind === "hindsight"
      ? config.profileVersion
      : input.env.REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE || "unconfigured-v1";
  const providerModule = defineModule({
    kind: "get-modular.module-declaration",
    schemaVersion: 1,
    moduleId: "reviewrouter/memory-knowledge-provider",
    implementationId: `reviewrouter/memory-knowledge-provider/${config.kind}`,
    owner,
    provides: [
      { capabilityId: "reviewrouter/memory-knowledge-provider", compatibility },
    ],
    slots: [],
  });
  const assembly = assemblyFor<Capabilities>();
  const providerFactory = implement<Capabilities>()(
    providerModule,
    async () => {
      const provider: Provider =
        config.kind === "hindsight"
          ? new HindsightMemoryProvider(config)
          : new DisabledMemoryProvider();
      return {
        instance: provider,
        capabilities: { "reviewrouter/memory-knowledge-provider": provider },
      };
    },
  );
  const runtimeFactory = implement<Capabilities>()(
    runtimeModule,
    async ({ provider }) => {
      const store = new PrismaMemoryKnowledgeStore(input.prisma);
      const automaticSources = new PrismaMemoryAutomaticSourceStore(
        input.prisma,
      );
      const entitlements = new PrismaEntitlementRepository(input.prisma);
      const policy = new EntitlementMemoryPolicyConfig(entitlements, {
        serviceEnabled: enabled,
      });
      const quota = new EntitlementMemoryQuotaPolicy(entitlements);
      const instance: MemoryKnowledgeRuntime = {
        enabled,
        generation: config.generation,
        providerProfileVersion,
        store,
        policy,
        cleanupProof:
          config.kind === "hindsight"
            ? createHindsightCleanupProofAdapter(config, input.env)
            : null,
        automaticSources,
        forAutomaticLearning: (access, current, preview) =>
          new MemoryAutomaticSourceService({
            preview,
            current,
            sources: automaticSources,
            knowledge: instance.forAccess(access, current),
            generation: config.generation,
            providerProfileVersion,
            ...(input.now ? { now: input.now } : {}),
          }),
        forAccess: (access, automaticCurrent) =>
          new MemoryKnowledgeService({
            generation: config.generation,
            providerProfileVersion,
            store,
            access,
            ...(automaticCurrent
              ? {
                  automaticSources: {
                    store: automaticSources,
                    current: automaticCurrent,
                  },
                }
              : {}),
            policy,
            quota,
            reader: provider,
            writer: provider,
            observer: provider,
            resubmitWindowMs:
              config.kind === "hindsight" ? config.resubmitWindowMs : 0,
            ...(input.now ? { now: input.now } : {}),
          }),
      };
      return { instance, capabilities: {} };
    },
  );
  const declarations = [providerModule, runtimeModule];
  const composition = await compileComposition({
    declarations,
    profile: {
      kind: "get-modular.composition-profile",
      schemaVersion: 1,
      profileId: "reviewrouter/memory-knowledge",
      roots: [runtimeModule.moduleId],
      selections: declarations.map(({ moduleId, implementationId }) => ({
        moduleId,
        implementationId,
      })),
      bindings: [
        {
          consumerImplementationId: runtimeModule.implementationId,
          slotId: "provider",
          providerImplementationIds: [providerModule.implementationId],
        },
      ],
    },
  });
  if (!composition.ok) throw new Error("memory_knowledge_composition_invalid");
  const preparation = await assembly.prepare({
    composition,
    modules: [providerFactory, runtimeFactory],
    roots: { memory: runtimeFactory },
  });
  if (preparation.status !== "prepared")
    throw new Error("memory_knowledge_composition_unprepared");
  const result = await preparation.prepared.run();
  if (result.status !== "succeeded")
    throw new Error("memory_knowledge_composition_failed");
  return result.roots.memory;
}
