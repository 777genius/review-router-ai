// Server-only support command. Invoke inside the maintained root-owned operator
// container/peer-PG holder; never import into a public API or browser action.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createConsumerControlClient } from "@agent-teams/account-gateway/http";
import { createPrismaClient } from "@reviewrouter/platform-db";
import { PrismaWorkspaceAccessRepository } from "@reviewrouter/features-auth";
import {
  createWorkspaceAccountDeletionCoordinator,
  GatewayWorkspaceDeletionLifecycle,
  createGatewayBindingClosureDelivery,
} from "@reviewrouter/features-provider-accounts/composition";
import {
  ProviderAccountError,
  type ScopedBindingFence,
} from "@reviewrouter/features-provider-accounts";

const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
const revision = z.number().int().min(1).max(2147483646);
const command = z.discriminatedUnion("command", [
  z.strictObject({
    command: z.literal("begin"),
    operationId: reference,
    workspaceId: reference,
    expectedWorkspaceRevision: revision,
  }),
  z.strictObject({
    command: z.literal("advance"),
    operationId: reference,
    workspaceId: reference,
    expectedWorkspaceRevision: revision,
  }),
  z.strictObject({
    command: z.literal("read"),
    operationId: reference,
    workspaceId: reference,
    expectedWorkspaceRevision: revision.optional(),
  }),
]);
// Root supplies this document through stdin from its protected existing holders.
// No password/token in argv, ambient DATABASE_URL, raw log or persisted input.
const inputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  request: command,
  operator: z.strictObject({
    workspaceId: reference,
    userId: reference,
    githubUserId: z.string().regex(/^[0-9]+$/),
    githubLogin: z.string().min(1).max(100),
  }),
  postgres: z.strictObject({
    socketDirectory: z.string().regex(/^\/[A-Za-z0-9_./-]+$/),
    port: z.number().int().min(1).max(65535),
    database: z.string().regex(/^[A-Za-z0-9_]+$/),
    user: z.string().regex(/^[A-Za-z0-9_]+$/),
    systemIdentifier: z.string().regex(/^[0-9]+$/),
  }),
  gateway: z.strictObject({
    role: z.literal("consumer-control"),
    origin: z.string().url(),
    token: z.string().min(1).max(16384),
  }),
});

async function readInput(): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > 32768) throw new Error("operator_input_denied");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function runWorkspaceAccountDeleteOperator(raw: unknown) {
  const input = inputSchema.parse(raw);
  if (
    process.platform !== "linux" ||
    ![0, 993].includes(process.getuid?.() ?? -1) ||
    input.postgres.socketDirectory.split("/").includes("..") ||
    ["reviewrouter_api", "reviewrouter_web", "reviewrouter_worker"].includes(
      input.postgres.user,
    ) ||
    process.env.PGPASSWORD !== undefined
  )
    throw new Error("operator_holder_denied");
  // Explicit peer target only. Disable pgpass fallback in this CLI process.
  process.env.PGPASSFILE = "/dev/null";
  const database = new URL(
    `postgresql://${input.postgres.user}@localhost:${input.postgres.port}/${input.postgres.database}`,
  );
  database.searchParams.set("host", input.postgres.socketDirectory);
  database.searchParams.set("sslmode", "disable");
  const prisma = createPrismaClient({
    databaseUrl: database.href,
    poolMax: 2,
    poolMaxLifetimeSeconds: 60,
    transactionMaxWaitMs: 10000,
    transactionTimeoutMs: 20000,
  });
  try {
    const identity = await prisma.$queryRaw<
      readonly { user: string; session: string; db: string; system: string }[]
    >`
      SELECT current_user::text AS "user", session_user::text AS "session", current_database() AS db,
        (pg_control_system()).system_identifier::text AS system`;
    if (
      identity.length !== 1 ||
      identity[0]!.user !== input.postgres.user ||
      identity[0]!.session !== input.postgres.user ||
      identity[0]!.db !== input.postgres.database ||
      identity[0]!.system !== input.postgres.systemIdentifier
    )
      throw new Error("operator_holder_denied");
    // Each required privilege is checked separately: comma-separated PostgreSQL
    // privilege names test ANY, which would not prove the mutation authority.
    const privilege = await prisma.$queryRaw<readonly { allowed: boolean }[]>`
      SELECT bool_and(CASE WHEN to_regclass('public.' || quote_ident(t)) IS NULL THEN false
        ELSE has_table_privilege(current_user, 'public.' || quote_ident(t), p) END) AS allowed
      FROM (VALUES
        ('Workspace','SELECT'),('Workspace','UPDATE'),('WorkspaceMember','SELECT'),('WorkspaceMember','UPDATE'),('WorkspaceMember','DELETE'),
        ('User','SELECT'),('PersonalAccountOperation','SELECT'),('PersonalAccountOperation','UPDATE'),
        ('ProviderAccountConnection','SELECT'),('ProviderAccountConnection','UPDATE'),
        ('WorkspaceAccountBinding','SELECT'),('WorkspaceAccountBinding','UPDATE'),
        ('WorkspaceDeletionOperation','SELECT'),('WorkspaceDeletionOperation','INSERT'),('WorkspaceDeletionOperation','UPDATE'),
        ('WorkspaceDeletionFact','SELECT'),('WorkspaceDeletionFact','INSERT'),
        ('RepositoryConnection','SELECT'),('RepositoryConnection','UPDATE')) AS required(t,p)`;
    if (privilege.length !== 1 || privilege[0]!.allowed !== true)
      throw new Error("operator_holder_denied");
    const user = await prisma.user.findUnique({
      where: { id: input.operator.userId },
      select: { githubUserId: true },
    });
    if (!user || user.githubUserId?.toString() !== input.operator.githubUserId)
      throw new Error("operator_identity_denied");
    // These methods are statically supplied by the qualified successor SDK.
    // No older-SDK/dynamic method fallback or private endpoint replacement.
    const client = createConsumerControlClient({
      ...input.gateway,
      timeoutMs: 5000,
    });
    const lifecycle = new GatewayWorkspaceDeletionLifecycle(
      async ({ owner }) => ({
        client,
        ownerRef:
          owner.kind === "user"
            ? `rru_${createHash("sha256").update(`rr-user-owner-v1\0${owner.userId}`).digest("hex")}`
            : `rrw_${createHash("sha256").update(`rr-workspace-owner-v1\0${owner.workspaceId}`).digest("hex")}`,
      }),
    );
    const fenceReceipt = async (
      intent: ScopedBindingFence,
      submit: boolean,
    ) => {
      if (submit)
        await client.fence({
          operationId: intent.operationId,
          subjectRef: intent.policySubject,
          revision: intent.policyRevision,
        });
      // Only stored server fence identity may ACK this exact persisted intent.
      const read = await client.policyClosure(intent.operationId);
      return {
        state: "applied" as const,
        operationId: read.operationRef,
        policySubject: read.policySubject,
        policyRevision: read.policyRevision,
      };
    };
    const coordinator = createWorkspaceAccountDeletionCoordinator({
      prisma,
      workspaceAccess: new PrismaWorkspaceAccessRepository(prisma),
      operatorWorkspaceId: input.operator.workspaceId,
      lifecycle,
      closures: createGatewayBindingClosureDelivery(async () => client),
      fenceDelivery: {
        submitFence: (intent) => fenceReceipt(intent, true),
        readFenceOperation: (intent) => fenceReceipt(intent, false),
      },
    });
    const actor = {
      userId: input.operator.userId,
      githubUserId: input.operator.githubUserId,
      githubLogin: input.operator.githubLogin,
    };
    const request = {
      operationId: input.request.operationId,
      workspaceId: input.request.workspaceId,
      actor,
    };
    const result =
      input.request.command === "begin"
        ? await coordinator.begin({
            ...request,
            expectedWorkspaceRevision: input.request.expectedWorkspaceRevision,
          })
        : input.request.command === "advance"
          ? await coordinator.advance({
              ...request,
              expectedWorkspaceRevision:
                input.request.expectedWorkspaceRevision,
            })
          : await coordinator.read({
              ...request,
              ...(input.request.expectedWorkspaceRevision === undefined
                ? {}
                : {
                    expectedWorkspaceRevision:
                      input.request.expectedWorkspaceRevision,
                  }),
            });
    // Positive allowlist only; no owner snapshots, raw remote errors or proofs.
    return {
      operationId: result.operationId,
      workspaceId: result.workspaceId,
      stage: result.stage,
      stageReason: result.stageReason,
      currentWorkspaceRevision: result.currentWorkspaceRevision,
      pendingFences: result.pendingFenceCount,
      pendingPolicyClosures: result.pendingPolicyClosureCount,
      pendingPersonalOperations: result.pendingPersonalOperationCount,
      ownedAccounts: result.targets.length,
    };
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 2) {
    process.stderr.write("workspace_delete_input_denied\n");
    process.exitCode = 1;
  } else {
    Promise.resolve()
      .then(readInput)
      .then(runWorkspaceAccountDeleteOperator)
      .then((result) => {
        process.stdout.write(JSON.stringify(result) + "\n");
      })
      .catch((error) => {
        process.stderr.write(
          JSON.stringify({
            phase: "workspace_delete_denied_or_pending",
            reason:
              error instanceof ProviderAccountError
                ? error.code
                : "operator_precondition_or_transport",
          }) + "\n",
        );
        process.exitCode = 1;
      });
  }
}
