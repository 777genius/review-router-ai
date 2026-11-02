import { safeWorkerErrorSummary } from "./outbox-worker-loop";

export type WorkerPhaseFailure = Readonly<{
  phase: string;
  safeErrorSummary: string;
}>;

export type WorkerPhaseResult<Value> =
  | Readonly<{ status: "completed"; value: Value }>
  | Readonly<{ status: "failed"; failure: WorkerPhaseFailure }>;

/** Capture one host operation without turning a failed read into an empty result. */
export async function captureWorkerPhase<Value>(
  phase: string,
  execute: () => Promise<Value>,
): Promise<WorkerPhaseResult<Value>> {
  try {
    return { status: "completed", value: await execute() };
  } catch (error) {
    return {
      status: "failed",
      failure: { phase, safeErrorSummary: safeWorkerErrorSummary(error) },
    };
  }
}
