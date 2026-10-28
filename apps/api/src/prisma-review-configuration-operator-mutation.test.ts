import {
  effectiveReviewPolicyDigest,
  parseReviewConfigurationStrict,
} from "@reviewrouter/features-review-config";
import {
  providerProfileFixture,
  providerProfileRowFixture,
  selectionsFor,
  storedPolicyHeadFixture,
  workspacePolicyDocumentFixture,
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import type { Prisma } from "@prisma/client";
import { ReviewConfigurationWriteConflictError } from "@reviewrouter/features-review-config";
import { describe, expect, it } from "vitest";
import { PrismaReviewConfigurationOperatorMutation } from "./prisma-review-configuration-operator-mutation.js";

// The workspace default is a hosted pool Codex provider.
const hostedProfile = providerProfileFixture({
  id: "profile_hosted",
  credential: {
    kind: "hosted_pool",
    authMode: "codex_subscription_oauth_hosted_pool",
  },
  model: workspaceProviderFixture.model,
});
function workspaceConfig(effort: "high" | "xhigh") {
  return parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [
      {
        ...workspaceProviderFixture,
        authMode: "codex_subscription_oauth_hosted_pool",
        reasoningEffort: effort,
      },
    ],
  });
}

type VersionRow = {
  id: string;
  workspaceId: string;
  version: number;
  schemaVersion: number;
  policyJson: string;
};

type ConfigurationRow = {
  id: string;
  workspaceId: string;
  repositoryId: string | null;
  targetKey: string;
  active: boolean;
  versions: VersionRow[];
};

type State = {
  configurations: Map<string, ConfigurationRow>;
  audits: unknown[];
  failAudit: boolean;
  nextId: number;
};

function configurationKey(workspaceId: string, targetKey: string): string {
  return JSON.stringify([workspaceId, targetKey]);
}

const repositoryKey = configurationKey("workspace_1", "repo:repo_1");

function createPrismaStub() {
  let committed = createInitialState();
  let transactionFailures: unknown[] = [];
  let transactionCalls = 0;
  const transactionOptions: { isolationLevel: string }[] = [];
  const events: string[] = [];

  const prisma = {
    async $transaction<T>(
      callback: (transaction: unknown) => Promise<T>,
      options: { isolationLevel: string },
    ) {
      transactionCalls += 1;
      transactionOptions.push(options);
      const failure = transactionFailures.shift();
      if (failure) throw failure;
      const transactionState = cloneState(committed);
      const result = await callback(
        createTransactionClient(transactionState, events),
      );
      committed = transactionState;
      return result;
    },
  };

  return {
    prisma,
    events,
    transactionOptions,
    state: () => committed,
    failNextAudit() {
      committed.failAudit = true;
    },
    replaceWorkspaceRevision(id: string) {
      const workspace = committed.configurations.get(
        configurationKey("workspace_1", "workspace:default"),
      )!;
      workspace.versions[0] = {
        ...workspace.versions[0]!,
        id,
        version: workspace.versions[0]!.version + 1,
      };
    },
    clearRepositoryOverride() {
      committed.configurations.get(repositoryKey)!.active = false;
    },
    queueTransactionFailure(error: unknown) {
      transactionFailures = [...transactionFailures, error];
    },
    transactionCalls: () => transactionCalls,
  };
}

function createInitialState(): State {
  return {
    configurations: new Map([
      [
        configurationKey("workspace_1", "workspace:default"),
        {
          id: "config_workspace",
          workspaceId: "workspace_1",
          repositoryId: null,
          targetKey: "workspace:default",
          active: true,
          versions: [versionRow("workspace_v1", 1, "xhigh")],
        },
      ],
    ]),
    audits: [],
    failAudit: false,
    nextId: 1,
  };
}

function cloneState(state: State): State {
  return {
    configurations: new Map(
      [...state.configurations].map(([key, configuration]) => [
        key,
        {
          ...configuration,
          versions: configuration.versions.map((version) => ({
            ...version,
          })),
        },
      ]),
    ),
    audits: [...state.audits],
    failAudit: state.failAudit,
    nextId: state.nextId,
  };
}

function createTransactionClient(state: State, events: string[]) {
  return {
    // Guards pass a Prisma.Sql; the profile lock is a tagged template.
    async $queryRaw(sql: Prisma.Sql | TemplateStringsArray) {
      const text = "text" in sql ? sql.text : sql.join("?");
      events.push(
        text.includes("WorkspaceProviderProfile")
          ? "profile-lock"
          : text.includes("lock_shared(")
            ? "shared"
            : "exclusive",
      );
      return [];
    },
    workspaceProviderProfile: {
      async findMany() {
        return [providerProfileRowFixture(hostedProfile)];
      },
    },
    reviewConfiguration: {
      async findUnique(input: {
        where: {
          workspaceId_targetKey: { workspaceId: string; targetKey: string };
          active?: boolean;
        };
      }) {
        events.push("read");
        const { workspaceId, targetKey } = input.where.workspaceId_targetKey;
        const record = state.configurations.get(
          configurationKey(workspaceId, targetKey),
        );
        return record &&
          (input.where.active === undefined ||
            record.active === input.where.active)
          ? {
              active: record.active,
              versions: [...record.versions]
                .sort((left, right) => right.version - left.version)
                .slice(0, 1),
            }
          : null;
      },
      async upsert(input: {
        where: {
          workspaceId_targetKey: { workspaceId: string; targetKey: string };
        };
        update: { repositoryId: string | null };
        create: {
          workspaceId: string;
          repositoryId: string | null;
          targetKey: string;
        };
      }) {
        events.push("write");
        const { workspaceId, targetKey } = input.where.workspaceId_targetKey;
        const key = configurationKey(workspaceId, targetKey);
        let record = state.configurations.get(key);
        if (!record) {
          if (
            input.create.workspaceId !== workspaceId ||
            input.create.targetKey !== targetKey
          )
            throw new Error("fixture_configuration_scope_mismatch");
          record = {
            id: `config_${state.nextId++}`,
            ...input.create,
            // Prisma's persisted default for a newly created override.
            active: true,
            versions: [],
          };
          state.configurations.set(key, record);
        } else Object.assign(record, input.update);
        return {
          id: record.id,
          workspaceId: record.workspaceId,
          active: record.active,
        };
      },
      async update(input: {
        where: { id: string };
        data: { active: boolean };
      }) {
        const record = [...state.configurations.values()].find(
          (configuration) => configuration.id === input.where.id,
        );
        if (!record) throw new Error("fixture_configuration_not_found");
        record.active = input.data.active;
        events.push("reactivate");
        return { ...record };
      },
      async deleteMany() {
        return { count: 0 };
      },
    },
    reviewConfigurationVersion: {
      async findFirst(input: { where: { configurationId: string } }) {
        const record = [...state.configurations.values()].find(
          (configuration) => configuration.id === input.where.configurationId,
        );
        const latest = [...(record?.versions ?? [])].sort(
          (left, right) => right.version - left.version,
        )[0];
        return latest ? { version: latest.version } : null;
      },
      async create(input: {
        data: Omit<VersionRow, "id"> & { configurationId: string };
      }) {
        const record = [...state.configurations.values()].find(
          (configuration) => configuration.id === input.data.configurationId,
        )!;
        if (record.workspaceId !== input.data.workspaceId)
          throw new Error("fixture_version_workspace_mismatch");
        const created = { ...input.data, id: `version_${state.nextId++}` };
        record.versions.push(created);
        return created;
      },
    },
    auditEvent: {
      async create(input: unknown) {
        if (state.failAudit) {
          throw new Error("audit_store_failed");
        }
        state.audits.push(input);
        return {};
      },
    },
  };
}

function versionRow(
  id: string,
  version: number,
  effort: "high" | "xhigh",
): VersionRow {
  return {
    id,
    workspaceId: "workspace_1",
    ...storedPolicyHeadFixture(
      workspacePolicyDocumentFixture(workspaceConfig(effort), [
        hostedProfile.id,
      ]),
      version,
    ),
  };
}

function mutationInput() {
  return {
    target: {
      scope: "repository" as const,
      workspaceId: "workspace_1",
      repositoryId: "repo_1",
    },
    expectedRevisionToken: `policy:1:0:${effectiveReviewPolicyDigest(
      workspaceConfig("xhigh"),
    )}`,
    policy: {
      schemaVersion: 4 as const,
      providers: selectionsFor(workspaceConfig("high"), [hostedProfile.id]),
      investigationRollout: {
        recordingEnabled: true,
        shadowEnabled: true,
        contextCriticEnabled: false,
        verifiedCleanEnabled: false,
        crossRevisionReplayEnabled: false,
        productionEffectsEnabled: false,
      },
    },
    auditEvent: {
      workspaceId: "workspace_1",
      actor: "operator:test",
      action: "review_config.operator_investigation_rollout_set",
      targetType: "repository",
      targetId: "repo_1",
      metadata: {
        repository: "777genius/example",
        reason: "test",
      },
    },
  };
}

describe("Prisma review configuration operator mutation", () => {
  it("commits the config version and audit event together", async () => {
    const stub = createPrismaStub();
    const mutation = new PrismaReviewConfigurationOperatorMutation(
      stub.prisma as never,
    );

    const result = await mutation.commit(mutationInput());

    expect(result).toMatchObject({
      version: 1,
      config: { providers: [{ reasoningEffort: "high" }] },
    });
    expect(
      stub.state().configurations.get(repositoryKey)?.versions,
    ).toHaveLength(1);
    const stored = stub.state().configurations.get(repositoryKey)!.versions[0]!;
    // Schema 4 stores only the document: no first-provider projection.
    expect(stored).toMatchObject({ schemaVersion: 4 });
    expect(stored).not.toHaveProperty("providerKind");
    expect(stored).not.toHaveProperty("providers");
    expect(JSON.parse(stored.policyJson)).toEqual(mutationInput().policy);
    expect(stub.state().audits).toHaveLength(1);
    expect(stub.events.slice(0, 4)).toEqual([
      "shared",
      "shared",
      "exclusive",
      "read",
    ]);
    expect(stub.events.filter((event) => event === "exclusive")).toHaveLength(
      1,
    );
    expect(stub.transactionOptions).toEqual([
      { isolationLevel: "Serializable" },
    ]);
    const override = stub.state().configurations.get(repositoryKey)!;
    expect(override).toMatchObject({
      workspaceId: "workspace_1",
      repositoryId: "repo_1",
      active: true,
    });
    expect(result.revisionToken).toBe(
      `policy:1:1:${result.effectivePolicyDigest}`,
    );
    await expect(mutation.commit(mutationInput())).rejects.toBeInstanceOf(
      ReviewConfigurationWriteConflictError,
    );
    expect(
      stub.state().configurations.get(repositoryKey)?.versions,
    ).toHaveLength(1);
    expect(stub.state().audits).toHaveLength(1);

    // Clearing retains history; a CAS-valid inherited write reactivates it.
    stub.clearRepositoryOverride();
    const reactivated = await mutation.commit(mutationInput());
    expect(reactivated.version).toBe(2);
    expect(stub.state().configurations.get(repositoryKey)).toMatchObject({
      active: true,
      versions: [override.versions[0], expect.objectContaining({ version: 2 })],
    });
    expect(stub.events.filter((event) => event === "reactivate")).toHaveLength(
      1,
    );
    expect(stub.state().audits).toHaveLength(2);
  });

  it("rejects a stale inherited revision without creating an override", async () => {
    const stub = createPrismaStub();
    stub.replaceWorkspaceRevision("workspace_v2");
    const mutation = new PrismaReviewConfigurationOperatorMutation(
      stub.prisma as never,
    );

    await expect(mutation.commit(mutationInput())).rejects.toBeInstanceOf(
      ReviewConfigurationWriteConflictError,
    );
    expect(stub.state().configurations.has(repositoryKey)).toBe(false);
    expect(stub.state().audits).toEqual([]);
    const foreignWorkspace = mutationInput();
    foreignWorkspace.target.workspaceId = "workspace_2";
    foreignWorkspace.auditEvent.workspaceId = "workspace_2";
    foreignWorkspace.expectedRevisionToken = "db:workspace_v2";
    await expect(mutation.commit(foreignWorkspace)).rejects.toBeInstanceOf(
      ReviewConfigurationWriteConflictError,
    );
    expect(
      stub
        .state()
        .configurations.has(configurationKey("workspace_2", "repo:repo_1")),
    ).toBe(false);
    expect(stub.state().audits).toEqual([]);
  });

  it("rolls the config version back when audit persistence fails", async () => {
    const stub = createPrismaStub();
    stub.failNextAudit();
    const mutation = new PrismaReviewConfigurationOperatorMutation(
      stub.prisma as never,
    );

    await expect(mutation.commit(mutationInput())).rejects.toThrow(
      "audit_store_failed",
    );
    expect(stub.state().configurations.has(repositoryKey)).toBe(false);
    expect(stub.state().audits).toEqual([]);
    expect(stub.transactionOptions).toEqual([
      { isolationLevel: "Serializable" },
    ]);
  });

  it("retries a serialization conflict without duplicating state", async () => {
    const stub = createPrismaStub();
    stub.queueTransactionFailure({ code: "P2034" });
    const mutation = new PrismaReviewConfigurationOperatorMutation(
      stub.prisma as never,
    );

    await expect(mutation.commit(mutationInput())).resolves.toMatchObject({
      version: 1,
    });
    expect(stub.transactionCalls()).toBe(2);
    expect(stub.transactionOptions).toEqual([
      { isolationLevel: "Serializable" },
      { isolationLevel: "Serializable" },
    ]);
    expect(
      stub.state().configurations.get(repositoryKey)?.versions,
    ).toHaveLength(1);
    expect(stub.state().audits).toHaveLength(1);
  });
});
