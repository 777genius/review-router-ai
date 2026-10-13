// Callable extension of the controlled Go/Node/PG assembly, not a second
// transport fixture. All Gateway clients and closure/erase callbacks are actual.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, readlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  checkedDatabaseTarget,
  assertEmptyDatabase,
} from "./database-target.mjs";
import { PrismaWorkspaceAccessRepository } from "../../auth/src/infrastructure/prisma/prisma-workspace-access-repository";
import { createWorkspaceAccountDeletionCoordinator } from "../src/composition";
import {
  GatewayWorkspaceDeletionLifecycle,
  createGatewayBindingClosureDelivery,
  type WorkspaceDeletionGatewayControl,
} from "../src/infrastructure/gateway/gateway-workspace-deletion-lifecycle";
import type {
  BindingClosureResponse,
  BindingFenceResponse,
} from "../src/application/ports/workspace-binding-fence-port";
import type { ScopedBindingFence } from "../src/domain/provider-account";
import { ProviderAccountError } from "../src/domain/provider-account";
import { PrismaPersonalAccountOperations } from "../src/infrastructure/prisma/prisma-personal-account-operations";

type Control = WorkspaceDeletionGatewayControl & {
  fence(input: {
    operationId: string;
    subjectRef: string;
    revision: number;
  }): Promise<{ state: string }>;
  policyClosure(operationRef: string): Promise<BindingClosureResponse>;
};
type ActualAssembly = {
  readonly account: {
    readonly accountRef: string;
    readonly ownerRef: string;
    readonly profileId: string;
  };
  readonly heldSubject: "assembly-binding";
  readonly heldPolicyRevision: 2;
  readonly controlForSubject: (subject: string) => Promise<Control>;
  readonly closeHeld: () => Promise<void>;
  readonly cleanupGeneration: () => Promise<"settled" | "quarantined" | "none">;
};

/** Called before actual native management birth so the account gets the same
 * canonical User owner namespace as the existing personal-account adapter.
 * No credential, transport proof or arbitrary owner override crosses this seam.
 */
export async function prepareWorkspaceDeletionAssembly() {
  assert.equal(process.env.RR_PROVIDER_ACCOUNTS_DISPOSABLE_CLUSTER, "1");
  assert.equal(process.env.RR_PROVIDER_ACCOUNTS_PG_TEST, "1");
  const mode = process.env.AG_ASSEMBLY_RR_JOINED;
  assert.ok(mode === undefined || mode === "rr_owner_delete_joined_20261013");
  const joined = mode === "rr_owner_delete_joined_20261013";
  const target = checkedDatabaseTarget(
    process.env.RR_PROVIDER_ACCOUNTS_PG_TEST_URL ?? "",
  );
  assert.equal(target.host, "127.0.0.1");
  assert.equal(target.port, joined ? 5432 : 16573);
  assert.equal(target.user, joined ? "postgres" : "fixture_owner");
  assert.equal(
    target.database,
    joined
      ? "rr_gateway_test_owner_delete_joined_20261013"
      : "rr_gateway_test_owner_delete_20261013",
  );
  const containerName = joined
    ? "rr-gateway-retirement-pg-20261013-r1"
    : "TEST-rr-owner-delete-pg-20261013";
  const inspect = spawnSync("docker", ["inspect", containerName], {
    encoding: "utf8",
  });
  assert.equal(
    inspect.status,
    0,
    "owned disposable container inspection required",
  );
  const container = JSON.parse(inspect.stdout)[0];
  assert.equal(
    container.Id,
    joined
      ? "89fe7026124e19acf6ccd74faf8f31a4645d4f4d00dff6ddf9ad410289aa876f"
      : (
          await readFile(
            "/srv/workers/TEST-rr-owner-delete-acceptance-20261013/container-id",
            "utf8",
          )
        ).trim(),
  );
  assert.equal(
    container.Image,
    "sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317",
  );
  assert.equal(container.State.Running, true);
  assert.deepEqual(container.NetworkSettings.Ports, {
    "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: joined ? "32960" : "16573" }],
  });
  assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [
    joined ? "bridge" : "TEST-rr-owner-delete-pg-net-20261013",
  ]);
  assert.equal(container.Mounts.length, 1);
  assert.equal(container.Mounts[0].Type, "bind");
  assert.equal(
    container.Mounts[0].Source,
    joined
      ? "/srv/workers/TEST-gateway-retirement-acceptance-20261013-r1/pgdata"
      : "/srv/workers/TEST-rr-owner-delete-acceptance-20261013/data",
  );
  assert.equal(container.Mounts[0].Destination, "/var/lib/postgresql/data");
  if (joined) {
    assert.equal(
      container.Config.Labels["review-router.job"],
      "gateway-retirement-acceptance-20261013-r1",
    );
    assert.equal(container.State.Pid, 2356846);
    const stat = await readFile("/proc/2356846/stat", "utf8");
    assert.equal(
      stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/)[19],
      "197499884",
    );
    assert.equal(await readlink("/proc/2356846/ns/net"), "net:[4026538582]");
    assert.equal(await readlink("/proc/self/ns/net"), "net:[4026538582]");
    assert.equal(
      (await readFile("/etc/machine-id", "utf8")).trim(),
      "d856d40da5ad4e23b4f67773e5942842",
    );
  }
  const sql = new Client(target);
  await sql.connect();
  try {
    assert.match(
      (await sql.query("SHOW server_version")).rows[0].server_version,
      /^17\.10(?:$| )/,
    );
    if (joined) {
      const current = (
        await sql.query(`SELECT current_user AS role, current_database() AS db,
        (pg_control_system()).system_identifier::text AS system,
        (SELECT count(*)::int FROM pg_roles WHERE rolname LIKE 'reviewrouter%' OR rolname='app') AS conflicting_roles`)
      ).rows[0];
      assert.equal(current.role, "postgres");
      assert.equal(current.db, target.database);
      assert.equal(current.system, "7696100374778028078");
      assert.equal(
        current.conflicting_roles,
        0,
        "historical RR migrations must not mutate another job's existing global roles",
      );
    }
    await assertEmptyDatabase(sql);
    const directory = new URL(
      "../../../platform/db/prisma/migrations/",
      import.meta.url,
    );
    const names = (await readdir(directory))
      .filter((name) => /^\d{6}_/.test(name))
      .sort();
    assert.ok(names.includes("000127_owner_workspace_deletion"));
    for (const name of names) {
      // The guarded fixture image already contains PG17.10 psql. The HOST has
      // no psql installation; do not install or borrow a different DB client.
      const result = spawnSync(
        "docker",
        [
          "exec",
          "-i",
          containerName,
          "psql",
          "-X",
          "--no-password",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          target.user,
          "-d",
          target.database,
        ],
        {
          input: await readFile(
            new URL(`${name}/migration.sql`, directory),
            "utf8",
          ),
          timeout: 60_000,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            PGPASSFILE: "/dev/null",
            PGSSLMODE: "disable",
            PGOPTIONS: "-c search_path=public",
          },
        },
      );
      assert.ok(
        !result.error && result.status === 0,
        `disposable migration failed: ${name}`,
      );
    }
  } finally {
    await sql.end();
  }
  const db = new PrismaClient({
    adapter: new PrismaPg(target),
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
  const operator = "delete-assembly-operator",
    personal = "delete-assembly-personal",
    borrowed = "delete-assembly-borrowed",
    unrelated = "delete-assembly-unrelated",
    user = "delete-assembly-user";
  const actor = {
    userId: user,
    githubUserId: "930001",
    githubLogin: "delete-assembly-operator",
  };
  await db.user.create({
    data: { id: user, githubUserId: 930001n, githubLogin: actor.githubLogin },
  });
  await db.workspace.createMany({
    data: [operator, borrowed, unrelated].map((id) => ({
      id,
      slug: id,
      name: id,
    })),
  });
  await db.workspace.create({
    data: {
      id: personal,
      slug: personal,
      name: personal,
      personalOwnerUserId: user,
    },
  });
  await db.workspaceMember.createMany({
    data: [operator, personal, borrowed, unrelated].map((workspaceId) => ({
      workspaceId,
      userId: user,
      role: "owner",
    })),
  });
  const ownerRef =
    "rru_" +
    createHash("sha256").update(`rr-user-owner-v1\0${user}`).digest("hex");
  let used = false;
  const historicalSubjects = Array.from(
    { length: 100 },
    (_, i) => `delete-assembly-history-${String(i).padStart(3, "0")}`,
  );
  return {
    ownerRef,
    managementSubjects: [
      "assembly-binding",
      "delete-assembly-y-binding",
      ...historicalSubjects,
    ],
    async dispose() {
      await db.$disconnect();
    },
    async run(actual: ActualAssembly) {
      assert.equal(used, false, "assembly callback must run once");
      used = true;
      assert.equal(actual.account.ownerRef, ownerRef);
      assert.equal(actual.heldSubject, "assembly-binding");
      assert.equal(actual.heldPolicyRevision, 2);
      const connection = "delete-assembly-connection";
      // Retained SQL117 requires initial revision1. Advance the local mirror by
      // a legal metadata write; only the actual SDK revision may later CAS.
      await db.providerAccountConnection.create({
        data: {
          id: connection,
          ownerUserId: user,
          gatewayAccountRef: actual.account.accountRef,
          profileRef: actual.account.profileId,
          displayName: "Controlled real native birth",
          state: "active",
        },
      });
      await db.providerAccountConnection.update({
        where: { id: connection },
        data: { metadataRevision: { increment: 1 } },
      });
      // Actual Gateway promotion is revision2. A second legal local metadata write
      // makes the RR mirror3 and proves that disable does not use the mirror CAS.
      await db.providerAccountConnection.update({
        where: { id: connection },
        data: { metadataRevision: { increment: 1 } },
      });
      await db.workspaceAccountBinding.createMany({
        data: [
          {
            id: actual.heldSubject,
            workspaceId: borrowed,
            connectionId: connection,
            state: "active",
          },
          {
            id: "delete-assembly-y-binding",
            workspaceId: unrelated,
            connectionId: connection,
            state: "active",
          },
        ],
      });
      for (const id of [actual.heldSubject, "delete-assembly-y-binding"])
        await db.workspaceAccountBinding.update({
          where: { id },
          data: {
            revision: { increment: 1 },
            policyRevision: { increment: 1 },
          },
        });
      // Each history row starts as a valid initial grant. Revoke legally before
      // making the next active pair: real pending intents, never invented ACKs.
      for (const id of historicalSubjects) {
        await db.workspaceAccountBinding.create({
          data: {
            id,
            workspaceId: personal,
            connectionId: connection,
            state: "active",
          },
        });
        await db.workspaceAccountBinding.update({
          where: { id },
          data: {
            state: "revoked",
            revision: { increment: 1 },
            policyRevision: { increment: 1 },
            pendingFenceOperationId: randomUUID(),
            pendingFencePolicySubject: id,
            pendingFencePolicyRevision: 2,
          },
        });
      }
      let disables = 0;
      const lifecycle = new GatewayWorkspaceDeletionLifecycle(
        async ({ owner }) => {
          assert.ok(owner.kind === "user" && owner.userId === user);
          const client = await actual.controlForSubject(actual.heldSubject);
          return {
            ownerRef,
            client: {
              ...client,
              async disable(...args: Parameters<Control["disable"]>) {
                disables++;
                await client.disable(...args);
                // Real server applied once; only the caller's ACK is lost, then GET reconciles.
                throw new Error("controlled lost disable ACK");
              },
            },
          };
        },
      );
      const delivered = async (
        intent: ScopedBindingFence,
        submit: boolean,
      ): Promise<BindingFenceResponse> => {
        const client = await actual.controlForSubject(intent.policySubject);
        if (submit)
          await client.fence({
            operationId: intent.operationId,
            subjectRef: intent.policySubject,
            revision: intent.policyRevision,
          });
        const read = await client.policyClosure(intent.operationId);
        return {
          state: "applied",
          operationId: read.operationRef,
          policySubject: read.policySubject,
          policyRevision: read.policyRevision,
        };
      };
      const dependencies = {
        prisma: db,
        workspaceAccess: new PrismaWorkspaceAccessRepository(db),
        operatorWorkspaceId: operator,
        lifecycle,
        fenceDelivery: {
          submitFence: (i: ScopedBindingFence) => delivered(i, true),
          readFenceOperation: (i: ScopedBindingFence) => delivered(i, false),
        },
        closures: createGatewayBindingClosureDelivery((i) =>
          actual.controlForSubject(i.policySubject),
        ),
      };
      const coordinator = () =>
        createWorkspaceAccountDeletionCoordinator(dependencies);
      const beforeBorrowed = await (
        await actual.controlForSubject(actual.heldSubject)
      ).get(actual.account.accountRef);
      assert.notEqual(
        beforeBorrowed.metadataRevision,
        (
          await db.providerAccountConnection.findUniqueOrThrow({
            where: { id: connection },
          })
        ).metadataRevision,
      );
      const borrowedRequest = {
        operationId: randomUUID(),
        workspaceId: borrowed,
        expectedWorkspaceRevision: 1,
        actor,
      };
      const began = await coordinator().begin(borrowedRequest);
      assert.equal(began.targets.length, 0);
      assert.equal(began.affectedBindingIds.length, 1);
      const held = await coordinator().advance({
        ...borrowedRequest,
        expectedWorkspaceRevision: began.currentWorkspaceRevision,
      });
      assert.equal(held.pendingPolicyClosureCount, 1);
      assert.notEqual(held.stage, "deleted");
      assert.equal(disables, 0);
      // Live membership is rechecked even after a durable deletion operation exists.
      await db.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: operator, userId: user } },
        data: { role: "member" },
      });
      await assert.rejects(
        coordinator().advance({
          ...borrowedRequest,
          expectedWorkspaceRevision: held.currentWorkspaceRevision,
        }),
        (e: unknown) =>
          e instanceof ProviderAccountError && e.code === "workspace_forbidden",
      );
      await db.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: operator, userId: user } },
        data: { role: "owner" },
      });
      await actual.closeHeld();
      const borrowedDone = await coordinator().advance({
        ...borrowedRequest,
        expectedWorkspaceRevision: held.currentWorkspaceRevision,
      });
      assert.equal(borrowedDone.stage, "deleted");
      assert.equal(disables, 0);
      assert.equal(
        (
          await db.workspaceAccountBinding.findUniqueOrThrow({
            where: { id: "delete-assembly-y-binding" },
          })
        ).state,
        "active",
      );
      const afterBorrowed = await (
        await actual.controlForSubject(actual.heldSubject)
      ).get(actual.account.accountRef);
      assert.equal(
        afterBorrowed.metadataRevision,
        beforeBorrowed.metadataRevision,
      );
      assert.equal(
        afterBorrowed.authorizationEpoch,
        beforeBorrowed.authorizationEpoch,
      );
      const personalStore = new PrismaPersonalAccountOperations(db),
        reservation = randomUUID();
      await personalStore.reserveConnect({
        actorUserId: user,
        clientOperationId: reservation,
        action: "connect",
        personalWorkspaceId: personal,
        proposedSourceId: "delete-assembly-no-source-yet",
        profileId: actual.account.profileId,
        displayName: "Controlled unused reservation",
        ingress: "api-key-create",
      });
      assert.equal(await personalStore.claimConnect(user, reservation), true);
      await personalStore.noteConnectPhase(user, reservation, "unknown");
      const ownerRequest = {
        operationId: randomUUID(),
        workspaceId: personal,
        expectedWorkspaceRevision: 1,
        actor,
      };
      const owner = await coordinator().begin(ownerRequest);
      assert.equal(owner.targets.length, 1);
      assert.equal(owner.targets[0]!.owner.kind, "user");
      assert.equal(owner.affectedBindingIds.length, 102);
      const page = await coordinator().advance({
        ...ownerRequest,
        expectedWorkspaceRevision: owner.currentWorkspaceRevision,
      });
      assert.equal(page.pendingFenceCount, 2);
      assert.equal(disables, 0, "one page is not complete cohort proof");
      const unresolved = await coordinator().advance({
        ...ownerRequest,
        expectedWorkspaceRevision: page.currentWorkspaceRevision,
      });
      assert.equal(unresolved.pendingFenceCount, 0);
      assert.equal(unresolved.pendingPersonalOperationCount, 1);
      assert.equal(
        disables,
        0,
        "unresolved enrollment without a source row is still pending",
      );
      // No remote ingress exists for this controlled reservation. The fixture
      // explicitly records rejection via the real store's legal transition;
      // absence of a connection is never used as completion evidence.
      await personalStore.noteConnectPhase(user, reservation, "rejected");
      let state = page;
      for (let i = 0; i < 4 && disables === 0; i++)
        state = await coordinator().advance({
          ...ownerRequest,
          expectedWorkspaceRevision: state.currentWorkspaceRevision,
        });
      assert.equal(disables, 1);
      assert.notEqual(state.stage, "deleted", "disable ACK is not erasure");
      assert.equal(await actual.cleanupGeneration(), "settled");
      state = await coordinator().advance({
        ...ownerRequest,
        expectedWorkspaceRevision: state.currentWorkspaceRevision,
      });
      assert.equal(state.stage, "deleted");
      assert.equal(disables, 1);
      assert.equal(
        (await coordinator().begin(ownerRequest)).stage,
        "deleted",
        "terminal original intent is repeatable",
      );
      assert.equal(
        (
          await coordinator().advance({
            ...ownerRequest,
            expectedWorkspaceRevision: state.currentWorkspaceRevision,
          })
        ).stage,
        "deleted",
      );
      assert.equal(disables, 1);
      assert.equal(
        await db.workspaceMember.count({ where: { workspaceId: personal } }),
        0,
      );
      assert.equal(
        (
          await db.providerAccountConnection.findUniqueOrThrow({
            where: { id: connection },
          })
        ).state,
        "disabled",
      );
      assert.equal(
        await db.workspaceDeletionFact.count({
          where: {
            operationId: ownerRequest.operationId,
            kind: "binding_fence",
          },
        }),
        102,
      );
      await assert.rejects(
        db.workspaceMember.create({
          data: { workspaceId: personal, userId: user, role: "owner" },
        }),
      );
      return {
        borrowedClosedWithoutDisable: true,
        personalOwnerErased: true,
        completePolicyFences: 102,
        disableCalls: disables,
        tombstones: 2,
        nativeClosureSource: "actual-controlled-Go" as const,
      };
    },
  };
}
