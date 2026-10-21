import {
  canonicalContextJson, captureContextToolsPlan, contextConnectionDefinitionSchema,
  parseContextToolsPlan, type ContextConnection, type ContextConnectionDefinition, type ContextToolsPlan,
} from "../domain/context-tools.js";

export interface ContextConnectionStore {
  find(workspaceId: string, id: string): Promise<ContextConnection | null>;
  list(workspaceId: string): Promise<readonly ContextConnection[]>;
  /** null creates revision 1; updates atomically match and increment expectedVersion. */
  save(connection: ContextConnection, expectedVersion: number | null): Promise<boolean>;
}
export interface ContextSecretCrypto {
  encrypt(plaintext: string): string | Promise<string>;
  decrypt(ciphertext: string): string | Promise<string>;
}
export type ContextConnectionErrorCode = "context_connection_invalid" | "context_connection_conflict" | "context_secret_invalid" | "context_secret_unavailable" | "context_plan_unavailable";
export class ContextConnectionError extends Error {
  constructor(readonly code: ContextConnectionErrorCode) { super(code); this.name = "ContextConnectionError"; }
}
type Dependencies = { store: ContextConnectionStore; crypto: ContextSecretCrypto };
export type ContextConnectionMetadata = {
  id: string; version: number; enabled: boolean; definition: ContextConnectionDefinition;
  credentials: { name: string; source: "dashboard-secret" | "github-secret"; present: boolean }[];
};
const dashboardNames = (definition: ContextConnectionDefinition) => Object.entries(definition.credentials).filter(([, value]) => value.source === "dashboard-secret").map(([name]) => name).sort();
const same = (a: unknown, b: unknown) => canonicalContextJson(a) === canonicalContextJson(b);
function metadata(connection: ContextConnection): ContextConnectionMetadata {
  return { id: connection.definition.id, version: connection.version, enabled: connection.enabled, definition: connection.definition,
    credentials: Object.entries(connection.definition.credentials).map(([name, value]) => ({ name, source: value.source, present: value.source === "dashboard-secret" && connection.encryptedSecrets !== null })) };
}
export async function listContextConnectionMetadata(workspaceId: string, store: ContextConnectionStore): Promise<ContextConnectionMetadata[]> {
  return (await store.list(workspaceId)).filter(c => c.workspaceId === workspaceId).map(metadata);
}
function checkedSecrets(value: unknown, names: string[]): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value) || !same(Object.keys(value).sort(), names)) throw new ContextConnectionError("context_secret_invalid");
  const entries = Object.entries(value);
  if (entries.some(([, secret]) => typeof secret !== "string" || !secret.trim() || /[\r\n\0]/.test(secret) || Buffer.byteLength(secret) > 16_384) || Buffer.byteLength(JSON.stringify(value)) > 65_536) throw new ContextConnectionError("context_secret_invalid");
  return Object.fromEntries(entries) as Record<string, string>;
}
export async function saveContextConnection(input: {
  workspaceId: string; expectedVersion: number | null; definition: unknown; enabled: boolean; secrets?: Record<string, string>;
}, { store, crypto }: Dependencies): Promise<ContextConnectionMetadata> {
  const parsed = contextConnectionDefinitionSchema.safeParse(input.definition);
  if (!input.workspaceId || typeof input.enabled !== "boolean" || !parsed.success || (input.expectedVersion !== null && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion >= 2_147_483_647))) throw new ContextConnectionError("context_connection_invalid");
  const definition = parsed.data;
  const current = await store.find(input.workspaceId, definition.id);
  if ((current?.version ?? null) !== input.expectedVersion || (current && current.workspaceId !== input.workspaceId)) throw new ContextConnectionError("context_connection_conflict");
  const names = dashboardNames(definition);
  let encryptedSecrets: string | null = null;
  if (input.secrets !== undefined) {
    const secrets = checkedSecrets(input.secrets, names);
    if (names.length) {
      try { encryptedSecrets = await crypto.encrypt(JSON.stringify(secrets)); }
      catch { throw new ContextConnectionError("context_secret_unavailable"); }
      if (!encryptedSecrets) throw new ContextConnectionError("context_secret_unavailable");
    }
  } else if (names.length) {
    if (!current?.encryptedSecrets || !same(names, dashboardNames(current.definition))) throw new ContextConnectionError("context_secret_invalid");
    encryptedSecrets = current.encryptedSecrets;
  }
  const connection: ContextConnection = { workspaceId: input.workspaceId, version: (input.expectedVersion ?? 0) + 1, enabled: input.enabled, definition, encryptedSecrets };
  if (!await store.save(connection, input.expectedVersion)) throw new ContextConnectionError("context_connection_conflict");
  return metadata(connection);
}

/** Caller must authorize the run/workspace before invoking. Never resolves GitHub secrets. */
export async function deliverContextCredentials(workspaceId: string, capturedPlan: unknown, { store, crypto }: Dependencies): Promise<Record<string, string>> {
  let plan: ContextToolsPlan;
  try { plan = parseContextToolsPlan(capturedPlan); }
  catch { throw new ContextConnectionError("context_plan_unavailable"); }
  const connections: ContextConnection[] = [];
  for (const server of plan.servers) {
    const connection = await store.find(workspaceId, server.id);
    if (!connection || connection.workspaceId !== workspaceId || !connection.enabled || connection.version !== server.version || connection.definition.id !== server.id) throw new ContextConnectionError("context_plan_unavailable");
    connections.push(connection);
  }
  // Re-capture against every current definition before any decryption, including bindings.
  try {
    const current = captureContextToolsPlan({ version: 1, builtinTools: plan.builtinTools, mcp: plan.servers.map(s => ({ connection: s.id, tools: s.tools })) }, connections);
    if (!same(current, plan)) throw new Error();
  } catch { throw new ContextConnectionError("context_plan_unavailable"); }
  const delivered: Record<string, string> = {};
  for (const connection of connections) {
    const names = dashboardNames(connection.definition);
    if (!names.length) continue;
    if (!connection.encryptedSecrets) throw new ContextConnectionError("context_secret_unavailable");
    try {
      const secrets = checkedSecrets(JSON.parse(await crypto.decrypt(connection.encryptedSecrets)), names);
      for (const name of names) delivered[name] = secrets[name]!;
    } catch { throw new ContextConnectionError("context_secret_unavailable"); }
  }
  return delivered;
}
