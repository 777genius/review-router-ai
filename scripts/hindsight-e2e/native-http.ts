/** Only structural native routes are safe diagnostics; identifiers and bodies are private. */
export function safeNativeRoute(path: string): string {
  const route = path.split("?")[0] ?? "";
  const bank = "/v1/default/banks/[^/]+";
  const routes = [
    [new RegExp(`^${bank}$`), "/v1/default/banks/:bank"],
    [new RegExp(`^${bank}/config$`), "/v1/default/banks/:bank/config"],
    [
      new RegExp(`^${bank}/documents/[^/]+$`),
      "/v1/default/banks/:bank/documents/:document",
    ],
    [new RegExp(`^${bank}/memories$`), "/v1/default/banks/:bank/memories"],
    [
      new RegExp(`^${bank}/observations$`),
      "/v1/default/banks/:bank/observations",
    ],
    [
      new RegExp(`^${bank}/memories/list$`),
      "/v1/default/banks/:bank/memories/list",
    ],
    [
      new RegExp(`^${bank}/memories/[^/]+/history$`),
      "/v1/default/banks/:bank/memories/:memory/history",
    ],
    [new RegExp(`^${bank}/operations$`), "/v1/default/banks/:bank/operations"],
    [
      new RegExp(`^${bank}/operations/[^/]+$`),
      "/v1/default/banks/:bank/operations/:operation",
    ],
    [
      new RegExp(`^${bank}/operations/[^/]+/delete$`),
      "/v1/default/banks/:bank/operations/:operation/delete",
    ],
  ] as const;
  return (
    routes.find(([pattern]) => pattern.test(route))?.[1] ?? "native-endpoint"
  );
}

export function assertNativeCleanupStatus(
  path: string,
  method: string,
  status: number,
  allowed: readonly number[],
): void {
  if (allowed.includes(status)) return;
  const safeMethod = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)
    ? method
    : "REQUEST";
  throw new Error(
    `Native cleanup ${safeMethod} ${safeNativeRoute(path)} returned HTTP ${status}; expected ${allowed.join("/")} (body suppressed)`,
  );
}

/** Pinned native status reads use HTTP 200 + not_found for an absent operation. */
export function assertNativeOperationAbsent(
  input: unknown,
  operationId: string,
): void {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const value = input as Record<string, unknown>;
    const emptyFields = [
      "operation_type",
      "task_type",
      "mental_model_id",
      "created_at",
      "updated_at",
      "completed_at",
      "error_message",
      "retry_count",
      "next_retry_at",
      "progress",
      "result_metadata",
      "details",
      "child_operations",
      "task_payload",
    ];
    const allowed = new Set(["operation_id", "status", "id", ...emptyFields]);
    if (
      value.operation_id === operationId &&
      (value.id == null || value.id === operationId) &&
      value.status === "not_found" &&
      Object.keys(value).every((key) => allowed.has(key)) &&
      emptyFields.every((key) => value[key] == null)
    )
      return;
  }
  throw new Error(
    "Native operation absence or payload removal could not be verified",
  );
}

/** An accepted reset still requires independent empty-state readback. */
export function assertNativeObservationsCleared(input: unknown): void {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const value = input as Record<string, unknown>;
    if (
      value.success === true &&
      typeof value.deleted_count === "number" &&
      Number.isSafeInteger(value.deleted_count) &&
      value.deleted_count >= 0
    )
      return;
  }
  throw new Error("Native observation reset could not be verified");
}
