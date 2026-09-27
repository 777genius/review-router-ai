import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ProviderApiKeyWorkspaceAccessAction =
  | "grant"
  | "revoke"
  | "inspect";

export type ProviderApiKeyWorkspaceAccessRequest = {
  readonly action: ProviderApiKeyWorkspaceAccessAction;
  readonly workspaceId: string;
  readonly actor: string;
  readonly reason: string;
  readonly confirm: boolean;
  readonly dryRun: boolean;
};

export type ProviderApiKeyWorkspaceGrantRecord = {
  readonly id: string;
  readonly workspaceId: string;
  readonly grantedBy: string | null;
  readonly grantReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ProviderApiKeyWorkspaceAccessDatabase = {
  readonly workspace: {
    findMany(input: {
      readonly where: { readonly id: string };
      readonly select: { readonly id: true };
      readonly take: number;
    }): Promise<readonly { readonly id: string }[]>;
  };
  readonly providerApiKeyWorkspaceGrant: {
    findMany(input: {
      readonly where: { readonly workspaceId: string };
      readonly select: {
        readonly id: true;
        readonly workspaceId: true;
        readonly grantedBy: true;
        readonly grantReason: true;
        readonly createdAt: true;
        readonly updatedAt: true;
      };
      readonly take: number;
    }): Promise<readonly ProviderApiKeyWorkspaceGrantRecord[]>;
    upsert(input: {
      readonly where: { readonly workspaceId: string };
      readonly update: {
        readonly grantedBy: string;
        readonly grantReason: string;
      };
      readonly create: {
        readonly workspaceId: string;
        readonly grantedBy: string;
        readonly grantReason: string;
      };
      readonly select: {
        readonly id: true;
        readonly workspaceId: true;
        readonly grantedBy: true;
        readonly grantReason: true;
        readonly createdAt: true;
        readonly updatedAt: true;
      };
    }): Promise<ProviderApiKeyWorkspaceGrantRecord>;
    deleteMany(input: {
      readonly where: {
        readonly id: string;
        readonly workspaceId: string;
      };
    }): Promise<{ readonly count: number }>;
  };
};

export type ProviderApiKeyWorkspaceAccessResult = {
  readonly action: ProviderApiKeyWorkspaceAccessAction;
  readonly mode: "inspect" | "dry-run" | "write";
  readonly status:
    | "observed"
    | "planned"
    | "granted"
    | "revoked"
    | "already-revoked";
  readonly workspaceId: string;
  readonly mutation: boolean;
  readonly audit: {
    readonly actor: string;
    readonly reason: string;
  };
  readonly grant: ProviderApiKeyWorkspaceGrantStatus | null;
};

export type ProviderApiKeyWorkspaceGrantStatus = {
  readonly id: string;
  readonly grantedBy: string | null;
  readonly grantReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export class ProviderApiKeyWorkspaceAccessError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "ProviderApiKeyWorkspaceAccessError";
    this.code = code;
  }
}

export function parseProviderApiKeyWorkspaceAccessArgs(
  rawArgs: readonly string[],
): ProviderApiKeyWorkspaceAccessRequest {
  let index = 0;
  let actionValue: string | undefined;

  if (rawArgs[0] === "--action" || rawArgs[0]?.startsWith("--action=")) {
    const parsed = readInlineOrNextValue(rawArgs, "--action", 0);
    actionValue = parsed.value;
    index = parsed.nextIndex;
  } else if (rawArgs[0] && !rawArgs[0].startsWith("--")) {
    actionValue = rawArgs[0];
    index = 1;
  }

  const values = new Map<string, string>();
  const flags = new Set<string>();

  while (index < rawArgs.length) {
    const argument = rawArgs[index]!;
    if (!argument.startsWith("--")) {
      throw new ProviderApiKeyWorkspaceAccessError(
        "invalid_arguments",
        `unexpected_argument:${argument}`,
      );
    }

    const separator = argument.indexOf("=");
    const name = separator === -1 ? argument : argument.slice(0, separator);
    if (name === "--confirm" || name === "--dry-run") {
      if (separator !== -1) {
        throw new ProviderApiKeyWorkspaceAccessError(
          "invalid_arguments",
          `flag_value_not_allowed:${name}`,
        );
      }
      flags.add(name);
      index += 1;
      continue;
    }

    if (
      name !== "--workspace-id" &&
      name !== "--actor" &&
      name !== "--reason" &&
      name !== "--action"
    ) {
      throw new ProviderApiKeyWorkspaceAccessError(
        "invalid_arguments",
        `unknown_option:${name}`,
      );
    }

    const parsed = readInlineOrNextValue(rawArgs, name, index);
    if (name === "--action") {
      if (actionValue !== undefined) {
        throw new ProviderApiKeyWorkspaceAccessError(
          "invalid_arguments",
          "duplicate_action",
        );
      }
      actionValue = parsed.value;
    } else {
      if (values.has(name)) {
        throw new ProviderApiKeyWorkspaceAccessError(
          "invalid_arguments",
          `duplicate_option:${name}`,
        );
      }
      values.set(name, parsed.value);
    }
    index = parsed.nextIndex;
  }

  const action = parseAction(actionValue);
  const workspaceId = requiredValue(values, "--workspace-id");
  const actor = requiredValue(values, "--actor");
  const reason = requiredValue(values, "--reason");
  const dryRun = flags.has("--dry-run");

  if (action === "inspect" && dryRun) {
    throw new ProviderApiKeyWorkspaceAccessError(
      "invalid_arguments",
      "inspect_does_not_accept_dry_run",
    );
  }

  return {
    action,
    workspaceId,
    actor,
    reason,
    confirm: flags.has("--confirm"),
    dryRun,
  };
}

export async function executeProviderApiKeyWorkspaceAccess(
  request: ProviderApiKeyWorkspaceAccessRequest,
  database: ProviderApiKeyWorkspaceAccessDatabase,
): Promise<ProviderApiKeyWorkspaceAccessResult> {
  assertProviderApiKeyWorkspaceAccessConfirmed(request);

  const currentGrant = await readWorkspaceAndGrant(
    database,
    request.workspaceId,
  );

  if (request.action === "inspect") {
    return {
      action: request.action,
      mode: "inspect",
      status: "observed",
      workspaceId: request.workspaceId,
      mutation: false,
      audit: { actor: request.actor, reason: request.reason },
      grant: serializeGrant(currentGrant),
    };
  }

  if (request.dryRun) {
    return {
      action: request.action,
      mode: "dry-run",
      status: "planned",
      workspaceId: request.workspaceId,
      mutation: false,
      audit: { actor: request.actor, reason: request.reason },
      grant: serializeGrant(currentGrant),
    };
  }

  if (request.action === "grant") {
    const grant = await database.providerApiKeyWorkspaceGrant.upsert({
      where: { workspaceId: request.workspaceId },
      update: {
        grantedBy: request.actor,
        grantReason: request.reason,
      },
      create: {
        workspaceId: request.workspaceId,
        grantedBy: request.actor,
        grantReason: request.reason,
      },
      select: {
        id: true,
        workspaceId: true,
        grantedBy: true,
        grantReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (grant.workspaceId !== request.workspaceId) {
      throw new ProviderApiKeyWorkspaceAccessError("grant_target_mismatch");
    }
    return {
      action: request.action,
      mode: "write",
      status: "granted",
      workspaceId: request.workspaceId,
      mutation: true,
      audit: { actor: request.actor, reason: request.reason },
      grant: serializeGrant(grant),
    };
  }

  if (currentGrant === null) {
    return {
      action: request.action,
      mode: "write",
      status: "already-revoked",
      workspaceId: request.workspaceId,
      mutation: false,
      audit: { actor: request.actor, reason: request.reason },
      grant: null,
    };
  }

  const deletion = await database.providerApiKeyWorkspaceGrant.deleteMany({
    where: {
      id: currentGrant.id,
      workspaceId: request.workspaceId,
    },
  });
  if (deletion.count !== 1) {
    throw new ProviderApiKeyWorkspaceAccessError("revoke_target_changed");
  }

  return {
    action: request.action,
    mode: "write",
    status: "revoked",
    workspaceId: request.workspaceId,
    mutation: true,
    audit: { actor: request.actor, reason: request.reason },
    grant: null,
  };
}

export function assertProviderApiKeyWorkspaceAccessConfirmed(
  request: ProviderApiKeyWorkspaceAccessRequest,
): void {
  if (request.action !== "inspect" && !request.dryRun && !request.confirm) {
    throw new ProviderApiKeyWorkspaceAccessError("confirmation_required");
  }
}

export function serializeProviderApiKeyWorkspaceAccessError(
  error: unknown,
): string {
  const code =
    error instanceof ProviderApiKeyWorkspaceAccessError
      ? error.code
      : "provider_api_key_workspace_access_failed";
  return `${JSON.stringify({ error: code })}\n`;
}

export const PROVIDER_API_KEY_WORKSPACE_ACCESS_USAGE = [
  "Usage:",
  "  provider-api-key-workspace-access inspect --workspace-id ID --actor ACTOR --reason REASON",
  "  provider-api-key-workspace-access grant --workspace-id ID --actor ACTOR --reason REASON (--dry-run | --confirm)",
  "  provider-api-key-workspace-access revoke --workspace-id ID --actor ACTOR --reason REASON (--dry-run | --confirm)",
].join("\n");

async function readWorkspaceAndGrant(
  database: ProviderApiKeyWorkspaceAccessDatabase,
  workspaceId: string,
): Promise<ProviderApiKeyWorkspaceGrantRecord | null> {
  const workspaces = await database.workspace.findMany({
    where: { id: workspaceId },
    select: { id: true },
    take: 2,
  });
  if (workspaces.length === 0) {
    throw new ProviderApiKeyWorkspaceAccessError("workspace_missing");
  }
  if (workspaces.length !== 1) {
    throw new ProviderApiKeyWorkspaceAccessError("workspace_ambiguous");
  }
  if (workspaces[0]!.id !== workspaceId) {
    throw new ProviderApiKeyWorkspaceAccessError("workspace_target_mismatch");
  }

  const grants = await database.providerApiKeyWorkspaceGrant.findMany({
    where: { workspaceId },
    select: {
      id: true,
      workspaceId: true,
      grantedBy: true,
      grantReason: true,
      createdAt: true,
      updatedAt: true,
    },
    take: 2,
  });
  if (grants.length > 1) {
    throw new ProviderApiKeyWorkspaceAccessError("workspace_grant_ambiguous");
  }
  const grant = grants[0] ?? null;
  if (grant !== null && grant.workspaceId !== workspaceId) {
    throw new ProviderApiKeyWorkspaceAccessError(
      "workspace_grant_target_mismatch",
    );
  }
  return grant;
}

function serializeGrant(
  grant: ProviderApiKeyWorkspaceGrantRecord | null,
): ProviderApiKeyWorkspaceGrantStatus | null {
  if (grant === null) return null;
  return {
    id: grant.id,
    grantedBy: grant.grantedBy,
    grantReason: grant.grantReason,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

function parseAction(
  value: string | undefined,
): ProviderApiKeyWorkspaceAccessAction {
  if (value === "grant" || value === "revoke" || value === "inspect") {
    return value;
  }
  throw new ProviderApiKeyWorkspaceAccessError(
    "invalid_arguments",
    "action_must_be_grant_revoke_or_inspect",
  );
}

function requiredValue(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new ProviderApiKeyWorkspaceAccessError(
      "invalid_arguments",
      `missing_required:${name}`,
    );
  }
  return value;
}

function readInlineOrNextValue(
  rawArgs: readonly string[],
  name: string,
  index: number,
): { readonly value: string; readonly nextIndex: number } {
  const argument = rawArgs[index]!;
  const separator = argument.indexOf("=");
  if (separator !== -1) {
    const value = validateOptionValue(name, argument.slice(separator + 1));
    return { value, nextIndex: index + 1 };
  }
  const value = rawArgs[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new ProviderApiKeyWorkspaceAccessError(
      "invalid_arguments",
      `missing_value:${name}`,
    );
  }
  return {
    value: validateOptionValue(name, value),
    nextIndex: index + 2,
  };
}

function validateOptionValue(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ProviderApiKeyWorkspaceAccessError(
      "invalid_arguments",
      `empty_value:${name}`,
    );
  }
  return normalized;
}

async function main(): Promise<void> {
  let database: { readonly $disconnect: () => Promise<void> } | undefined;
  try {
    if (process.argv.includes("--help")) {
      process.stdout.write(`${PROVIDER_API_KEY_WORKSPACE_ACCESS_USAGE}\n`);
      return;
    }
    const request = parseProviderApiKeyWorkspaceAccessArgs(
      process.argv.slice(2),
    );
    assertProviderApiKeyWorkspaceAccessConfirmed(request);
    const { createPrismaClient } = await import("@reviewrouter/platform-db");
    const prisma = createPrismaClient({ poolMax: 1 });
    database = prisma;
    const result = await executeProviderApiKeyWorkspaceAccess(
      request,
      prisma as unknown as ProviderApiKeyWorkspaceAccessDatabase,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(serializeProviderApiKeyWorkspaceAccessError(error));
    process.exitCode = 1;
  } finally {
    await database?.$disconnect().catch(() => undefined);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  void main();
}
