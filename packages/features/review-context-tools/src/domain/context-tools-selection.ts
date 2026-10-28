import { z } from "zod";
import { contextToolsContract } from "@reviewrouter/shared";
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const toolName = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/);
export const contextBuiltinToolSchema = z.enum([
  "github.issue.read",
  "repository.docs.read",
]);
const unique = <T>(items: T[]) => new Set(items).size === items.length;
export const contextToolsSelectionSchema = z
  .object({
    version: z.literal(1),
    builtinTools: z.array(contextBuiltinToolSchema).max(2).refine(unique),
    mcp: z
      .array(
        z
          .object({
            connection: identifier,
            tools: z
              .array(toolName)
              .min(1)
              .max(contextToolsContract.maxToolsPerServer)
              .refine(unique),
          })
          .strict(),
      )
      .max(contextToolsContract.maxServers),
  })
  .strict()
  .refine(
    (v) => unique(v.mcp.map((s) => s.connection)),
    "context_connection_duplicate",
  );
export type ContextToolsSelection = z.infer<typeof contextToolsSelectionSchema>;
