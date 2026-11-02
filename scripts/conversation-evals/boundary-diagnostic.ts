export type EvaluationPhase =
  | "configuration"
  | "parser_import"
  | "parser_execution"
  | "runtime_import"
  | "database_client"
  | "fixture_creation"
  | "cold_start"
  | "event_execution"
  | "mutation"
  | "mutation_followup"
  | "result_assembly";

const errorTypes = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AggregateError",
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientInitializationError",
  "PrismaClientValidationError",
  "PrismaClientRustPanicError",
]);
const databaseCodes = new Set([
  "08001",
  "08006",
  "23502",
  "23503",
  "23505",
  "25006",
  "28P01",
  "3D000",
  "40001",
  "40P01",
  "42501",
  "42601",
  "42703",
  "42P01",
  "53300",
  "57014",
  "57P01",
]);
const nodeCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ERR_MODULE_NOT_FOUND",
  "ERR_PACKAGE_PATH_NOT_EXPORTED",
  "ERR_UNKNOWN_FILE_EXTENSION",
  "ERR_INVALID_URL",
]);
const sourceFiles = new Set([
  "scripts/conversation-evals/run.ts",
  "scripts/conversation-evals/fixture.ts",
  "scripts/conversation-evals/configuration.ts",
  "scripts/conversation-evals/corpus.ts",
  "scripts/conversation-evals/command-inventory.ts",
  "scripts/conversation-evals/gateway-receipt.ts",
  "packages/platform/db/src/index.ts",
]);

function property(value: unknown, key: string): unknown {
  try {
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

// A diagnostic, never authority: emit no message, raw stack, metadata or arbitrary code.
export function evaluationBoundaryDiagnostic(
  phase: EvaluationPhase,
  error: unknown,
) {
  const name = property(error, "name");
  const code = property(error, "code");
  const databaseCode = property(property(error, "meta"), "code");
  const stack = property(error, "stack");
  let sourceFrame: { file: string; line: number; column: number } | undefined;
  if (typeof stack === "string") {
    for (const line of stack.slice(0, 16_384).split("\n").slice(1, 33)) {
      const frame = line.match(
        /^\s+at (?:[^()\r\n]* \()?((?:file:\/\/)?\/[^()\s?#]*\/((?:scripts\/conversation-evals|packages\/platform\/db\/src)\/[a-z-]+\.ts)):([1-9][0-9]{0,6}):([1-9][0-9]{0,6})\)?$/,
      );
      if (frame && sourceFiles.has(frame[2]!)) {
        sourceFrame = {
          file: frame[2]!,
          line: Number(frame[3]),
          column: Number(frame[4]),
        };
        break;
      }
    }
  }
  return {
    phase,
    errorType:
      typeof name === "string" && errorTypes.has(name) ? name : "unknown",
    ...(typeof code === "string" &&
    (nodeCodes.has(code) ||
      databaseCodes.has(code) ||
      /^P[12][0-9]{3}$/.test(code))
      ? { code }
      : {}),
    ...(typeof databaseCode === "string" && databaseCodes.has(databaseCode)
      ? { databaseCode }
      : {}),
    ...(sourceFrame ? { sourceFrame } : {}),
  };
}
