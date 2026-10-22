import { fileURLToPath, pathToFileURL } from "node:url";
import { config as loadDotenv } from "dotenv";
import {
  createMemorySearchRuntime,
  safeMemorySearchConfigurationErrorCode,
} from "@reviewrouter/features-memory/composition";
import { createPrismaClient } from "@reviewrouter/platform-db";

export type MemoryProjectionOperatorCommand =
  | { readonly kind: "help" }
  | {
      readonly kind: "backfill";
      readonly limit?: number;
      readonly afterId?: string;
    }
  | {
      readonly kind: "drain";
      readonly writersStopped: true;
      readonly limit?: number;
    };

const usage = [
  "Memory projection operator (uses the same environment as API and worker)",
  "  memory:index backfill [--limit 1..500] [--after canonical-item-id]",
  "  memory:index drain --writers-stopped [--limit 1..100]",
  "",
  "Backfill enqueues one page; continue with nextCursor until null.",
  "Drain performs one bounded pass using the retained old configuration.",
  "Stop API/worker writers before asserting --writers-stopped.",
  "Exit 2 means drain debt or blocked backfill events remain.",
  "Retry backfill dead-letter events through the workspace Outbox action.",
  "Repeat drain without changing configuration while debt remains.",
  "After a successful drain, use a fresh projection generation.",
].join("\n");

export function parseMemoryProjectionOperatorArgs(
  args: readonly string[],
): MemoryProjectionOperatorCommand {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    return { kind: "help" };
  }
  const kind = args[0];
  if (kind !== "backfill" && kind !== "drain") throw invalidArguments();
  let limit: number | undefined;
  let afterId: string | undefined;
  let writersStopped = false;
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index]!;
    if (seen.has(flag)) throw invalidArguments();
    seen.add(flag);
    if (flag === "--writers-stopped" && kind === "drain") {
      writersStopped = true;
      continue;
    }
    if (flag === "--limit") {
      const value = args[++index];
      if (!value || !/^[1-9]\d*$/u.test(value)) throw invalidArguments();
      limit = Number(value);
      if (
        !Number.isSafeInteger(limit) ||
        limit > (kind === "drain" ? 100 : 500)
      ) {
        throw invalidArguments();
      }
      continue;
    }
    if (flag === "--after" && kind === "backfill") {
      const value = args[++index];
      if (
        !value ||
        value.trim() !== value ||
        value.length > 256 ||
        value.startsWith("--") ||
        [...value].some((character) => {
          const point = character.codePointAt(0)!;
          return point <= 0x20 || (point >= 0x7f && point <= 0x9f);
        })
      ) {
        throw invalidArguments();
      }
      afterId = value;
      continue;
    }
    throw invalidArguments();
  }
  if (kind === "backfill") {
    return {
      kind,
      ...(limit === undefined ? {} : { limit }),
      ...(afterId === undefined ? {} : { afterId }),
    };
  }
  if (!writersStopped) {
    throw new Error("memory_projection_writers_stopped_required");
  }
  return {
    kind,
    writersStopped: true,
    ...(limit === undefined ? {} : { limit }),
  };
}

export function safeMemoryProjectionOperatorError(error: unknown): string {
  const configurationCode = safeMemorySearchConfigurationErrorCode(error);
  if (configurationCode) return configurationCode;
  const code = error instanceof Error ? error.message : "";
  return safeErrorCodes.has(code) ? code : "memory_projection_operator_failed";
}

async function main(): Promise<number> {
  let prisma: ReturnType<typeof createPrismaClient> | undefined;
  try {
    const command = parseMemoryProjectionOperatorArgs(process.argv.slice(2));
    if (command.kind === "help") {
      process.stdout.write(usage + "\n");
      return 0;
    }
    for (const name of [".env.local", ".env"]) {
      loadDotenv({
        path: fileURLToPath(new URL("../../../" + name, import.meta.url)),
        override: false,
        quiet: true,
      });
    }
    prisma = createPrismaClient();
    const runtime = await createMemorySearchRuntime({
      prisma,
      env: process.env,
    });
    if (command.kind === "backfill") {
      const result = await runtime.backfill(command);
      const blocked = result.deadLetterEventIds.length > 0;
      process.stdout.write(
        JSON.stringify({
          command: command.kind,
          ...result,
          deadLetterCount: result.deadLetterEventIds.length,
          ...(blocked ? { code: "memory_projection_backfill_blocked" } : {}),
        }) + "\n",
      );
      return blocked ? 2 : 0;
    }
    const result = await runtime.drain(command);
    const pending = result.pending > 0;
    process.stdout.write(
      JSON.stringify({
        command: command.kind,
        ...result,
        ...(pending ? { code: "memory_projection_drain_pending" } : {}),
      }) + "\n",
    );
    return pending ? 2 : 0;
  } catch (error) {
    process.stderr.write(safeMemoryProjectionOperatorError(error) + "\n");
    return 1;
  } finally {
    await prisma?.$disconnect();
  }
}

function invalidArguments(): Error {
  return new Error("memory_projection_operator_arguments_invalid");
}

const safeErrorCodes = new Set([
  "memory_projection_operator_arguments_invalid",
  "memory_projection_writers_stopped_required",
  "memory_projection_backfill_invalid",
  "memory_index_identity_conflict",
  "memory_index_generation_retired",
  "memory_index_pending",
  "memory_search_composition_invalid",
  "memory_search_composition_unprepared",
  "memory_search_composition_failed",
]);

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write("memory_projection_operator_failed\n");
      process.exitCode = 1;
    },
  );
}
