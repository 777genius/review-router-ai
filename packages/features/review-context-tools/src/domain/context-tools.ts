import { createHash } from "node:crypto";
import { z } from "zod";
import { contextToolsContract } from "@reviewrouter/shared";

export const contextToolLimits = contextToolsContract.limits;
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const logicalName = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
const toolName = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/);
import {
  contextBuiltinToolSchema,
  type ContextToolsSelection,
} from "./context-tools-selection.js";
export {
  contextBuiltinToolSchema,
  contextToolsSelectionSchema,
  type ContextToolsSelection,
} from "./context-tools-selection.js";
const unique = <T>(items: T[]) => new Set(items).size === items.length;
export const contextCredentialSourceSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("github-secret"), name: logicalName }).strict(),
  z.object({ source: z.literal("dashboard-secret") }).strict(),
]);
export const httpsMcpUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((raw) => {
    try {
      const u = new URL(raw);
      return (
        !/[{}$]/.test(raw) &&
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.hash &&
        !u.search &&
        !u.hostname.endsWith(".")
      );
    } catch {
      return false;
    }
  }, "context_https_url_required");
const templateRegex = /\$?\{\{\s*secrets\.([A-Z][A-Z0-9_]{0,63})\s*\}\}/g;
export function referencedContextSecrets(template: string): string[] {
  return [...template.matchAll(templateRegex)].map((m) => m[1]!);
}
const headerTemplatesSchema = z.record(
  z.string().regex(new RegExp(contextToolsContract.headerNamePattern)),
  z
    .string()
    .min(1)
    .max(contextToolsContract.maxHeaderValueChars)
    .refine((v) => !/[\r\n\0]/.test(v)),
);
const connectionDefinitionSchema = (minimumTools: number) =>
  z
    .object({
      id: identifier,
      url: httpsMcpUrlSchema,
      headers: headerTemplatesSchema,
      tools: z
        .array(toolName)
        .min(minimumTools)
        .max(contextToolsContract.maxToolsPerServer)
        .refine(unique),
      credentials: z.record(logicalName, contextCredentialSourceSchema),
    })
    .strict()
    .superRefine((v, c) => {
      if (
        Object.keys(v.credentials).length >
        contextToolsContract.maxCredentialBindingsPerServer
      )
        c.addIssue({ code: "custom", message: "context_secret_binding_limit" });
      const used = [
        ...new Set(Object.values(v.headers).flatMap(referencedContextSecrets)),
      ].sort();
      if (
        used.join() !== Object.keys(v.credentials).sort().join() ||
        Object.values(v.headers).some(
          (value) =>
            referencedContextSecrets(value).length === 0 ||
            /[{}]/.test(value.replace(templateRegex, "")),
        )
      )
        c.addIssue({
          code: "custom",
          message: "context_secret_binding_mismatch",
        });
      if (
        !unique(Object.keys(v.headers).map((k) => k.toLowerCase())) ||
        Object.keys(v.headers).length > contextToolsContract.maxHeadersPerServer
      )
        c.addIssue({ code: "custom", message: "context_header_duplicate" });
      if (
        Object.keys(v.headers).some(
          (k) =>
            new RegExp(
              contextToolsContract.forbiddenHeaderPrefixPattern,
              "i",
            ).test(k) ||
            (
              contextToolsContract.forbiddenHeaderNames as readonly string[]
            ).includes(k.toLowerCase()),
        )
      )
        c.addIssue({ code: "custom", message: "context_header_forbidden" });
    });
export const contextConnectionDefinitionSchema = connectionDefinitionSchema(1);
/** Discovery has no selected tools yet; every other connection invariant is shared. */
export const contextConnectionProbeDefinitionSchema =
  connectionDefinitionSchema(0);
export type ContextConnectionDefinition = z.infer<
  typeof contextConnectionDefinitionSchema
>;
export type ContextConnection = Readonly<{
  workspaceId: string;
  version: number;
  enabled: boolean;
  definition: ContextConnectionDefinition;
  encryptedSecrets: string | null;
}>;
const plannedCredentialSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("github-secret"), name: logicalName }).strict(),
  z
    .object({
      source: z.literal("dashboard-secret"),
      credentialRef: identifier,
      version: z.number().int().positive(),
    })
    .strict(),
]);
const plannedServerSchema = z
  .object({
    id: identifier,
    version: z.number().int().positive(),
    url: httpsMcpUrlSchema,
    headers: headerTemplatesSchema,
    tools: z
      .array(toolName)
      .min(1)
      .max(contextToolsContract.maxToolsPerServer)
      .refine(unique),
    credentials: z.record(logicalName, plannedCredentialSchema),
  })
  .strict();
export const contextToolsPlanSchema = z
  .object({
    version: z.literal(1),
    builtinTools: z.array(contextBuiltinToolSchema).max(2).refine(unique),
    servers: z.array(plannedServerSchema).max(contextToolsContract.maxServers),
    limits: z
      .object({
        startupTimeoutMs: z.literal(30000),
        callTimeoutMs: z.literal(30000),
        responseBytes: z.literal(1048576),
        maxCalls: z.literal(128),
      })
      .strict(),
    planDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export type ContextToolsPlan = z.infer<typeof contextToolsPlanSchema>;
export function canonicalContextJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
}
export function contextPlanDigest(
  plan: Omit<ContextToolsPlan, "planDigest">,
): string {
  return (
    "sha256:" +
    createHash("sha256").update(canonicalContextJson(plan)).digest("hex")
  );
}
export function parseContextToolsPlan(value: unknown): ContextToolsPlan {
  const plan = contextToolsPlanSchema.parse(value);
  const { planDigest, ...rest } = plan;
  if (
    Buffer.byteLength(canonicalContextJson(plan), "utf8") >
    contextToolsContract.maxPlanBytes
  )
    throw new Error("context_plan_invalid");
  if (
    contextPlanDigest(rest) !== planDigest ||
    !unique(plan.servers.map((s) => s.id))
  )
    throw new Error("context_plan_invalid");
  const bindings = new Map<string, string>();
  for (const server of plan.servers) {
    const { version: _version, ...definitionInput } = server;
    void _version;
    const definition = contextConnectionDefinitionSchema.parse({
      ...definitionInput,
      credentials: Object.fromEntries(
        Object.entries(server.credentials).map(([name, value]) => [
          name,
          value.source === "github-secret" ? value : { source: value.source },
        ]),
      ),
    });
    void definition;
    for (const [name, value] of Object.entries(server.credentials)) {
      const key = canonicalContextJson(value);
      if (bindings.has(name) && bindings.get(name) !== key)
        throw new Error("context_secret_ambiguous");
      bindings.set(name, key);
    }
  }
  return plan;
}
export function captureContextToolsPlan(
  selection: ContextToolsSelection,
  connections: readonly ContextConnection[],
): ContextToolsPlan {
  const servers = selection.mcp.map((selected) => {
    const connection = connections.find(
      (c) => c.definition.id === selected.connection,
    );
    if (
      !connection?.enabled ||
      selected.tools.some((t) => !connection.definition.tools.includes(t))
    )
      throw new Error("context_connection_unavailable");
    const { definition } = connection;
    return {
      id: definition.id,
      version: connection.version,
      url: definition.url,
      headers: definition.headers,
      tools: selected.tools,
      credentials: Object.fromEntries(
        Object.entries(definition.credentials).map(([name, value]) => [
          name,
          value.source === "github-secret"
            ? value
            : {
                source: "dashboard-secret" as const,
                credentialRef: definition.id,
                version: connection.version,
              },
        ]),
      ),
    };
  });
  const plan = {
    version: 1 as const,
    builtinTools: selection.builtinTools,
    servers,
    limits: contextToolLimits,
  };
  return parseContextToolsPlan({
    ...plan,
    planDigest: contextPlanDigest(plan),
  });
}
