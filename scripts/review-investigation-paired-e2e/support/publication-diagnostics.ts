import { performance } from "node:perf_hooks";
import type { FastifyInstance, RawServerBase } from "fastify";
import {
  ReviewActionV2ProtocolErrorCode,
  ReviewExecutionMutationResultStatus,
  ReviewExecutionRestoreResultStatus,
  ReviewPublicationRequestResultStatus,
  ReviewPublicationStatusResultStatus,
  ReviewRunAuthorizationResultStatus,
} from "../../../packages/protocol-review-action-v2/src/index.js";
import { ReviewPublicationTerminalOutcome } from "../../../packages/features/review-publishing/src/v2/domain/review-publication-attempt.js";

const maximumEntries = 32;
const maximumResponseBytes = 64 * 1024;
const routeStatuses = {
  "/api/action/v2/review-runs/renew": Object.values(
    ReviewRunAuthorizationResultStatus,
  ),
  "/api/action/v2/review-executions/restore": Object.values(
    ReviewExecutionRestoreResultStatus,
  ),
  "/api/action/v2/review-executions/finalize": Object.values(
    ReviewExecutionMutationResultStatus,
  ),
  "/api/action/v2/review-publication/request": Object.values(
    ReviewPublicationRequestResultStatus,
  ),
  "/api/action/v2/review-publication/status": Object.values(
    ReviewPublicationStatusResultStatus,
  ),
} as const;
type PublicationPath = keyof typeof routeStatuses;
type ResultStatus = (typeof routeStatuses)[PublicationPath][number];
type ResponseFields = {
  readonly resultStatus?: ResultStatus;
  readonly errorCode?: ReviewActionV2ProtocolErrorCode;
  readonly pollAfterMs?: number;
  readonly terminalOutcome?: ReviewPublicationTerminalOutcome;
};
type CompletedRequest = ResponseFields & {
  readonly requestNumber: number;
  readonly path: PublicationPath;
  readonly startedAfterMs: number;
  readonly durationMs: number;
  readonly statusCode: number;
};
export type PublicationDiagnosticsSnapshot = {
  readonly completed: readonly CompletedRequest[];
  readonly inFlight: readonly {
    readonly requestNumber: number;
    readonly path: PublicationPath;
    readonly ageMs: number;
  }[];
  readonly droppedCompleted: number;
  readonly droppedInFlight: number;
};
type RunState = {
  startedAt: number;
  nextRequestNumber: number;
  completed: CompletedRequest[];
  inFlight: Map<number, CapturedRequest>;
  droppedCompleted: number;
  droppedInFlight: number;
};
type CapturedRequest = {
  run: RunState;
  requestNumber: number;
  path: PublicationPath;
  startedAt: number;
  response: ResponseFields;
};

/** Register before app.ready(); each runner attempt owns a separate trace. */
export function registerPublicationDiagnostics<Server extends RawServerBase>(
  app: FastifyInstance<Server>,
): { beginRun(): { snapshot(): PublicationDiagnosticsSnapshot } } {
  let activeRun: RunState | undefined;
  const requests = new WeakMap<object, CapturedRequest>();

  app.addHook("onRequest", (request, _reply, done) => {
    const path = request.routeOptions.url;
    if (
      activeRun &&
      request.method === "POST" &&
      path &&
      Object.hasOwn(routeStatuses, path)
    ) {
      const captured: CapturedRequest = {
        run: activeRun,
        requestNumber: activeRun.nextRequestNumber++,
        path: path as PublicationPath,
        startedAt: performance.now(),
        response: {},
      };
      if (activeRun.inFlight.size === maximumEntries) {
        const oldest = activeRun.inFlight.keys().next().value;
        if (oldest !== undefined) activeRun.inFlight.delete(oldest);
        activeRun.droppedInFlight++;
      }
      activeRun.inFlight.set(captured.requestNumber, captured);
      requests.set(request, captured);
    }
    done();
  });

  app.addHook("onSend", (request, _reply, payload, done) => {
    const captured = requests.get(request);
    if (captured) {
      captured.response = responseFields(payload, captured.path);
    }
    // Observe serialized JSON only; never consume or replace a response stream.
    done(null, payload);
  });

  app.addHook("onResponse", (request, reply, done) => {
    const captured = requests.get(request);
    if (captured) {
      const { run, requestNumber, path, startedAt, response } = captured;
      run.inFlight.delete(requestNumber);
      if (run.completed.length === maximumEntries) {
        run.completed.shift();
        run.droppedCompleted++;
      }
      run.completed.push({
        requestNumber,
        path,
        startedAfterMs: elapsed(startedAt, run.startedAt),
        durationMs: elapsed(performance.now(), startedAt),
        statusCode: reply.statusCode,
        ...response,
      });
      requests.delete(request);
    }
    done();
  });

  return {
    beginRun() {
      const run: RunState = {
        startedAt: performance.now(),
        nextRequestNumber: 1,
        completed: [],
        inFlight: new Map(),
        droppedCompleted: 0,
        droppedInFlight: 0,
      };
      activeRun = run;
      return {
        snapshot: () => ({
          completed: run.completed.map((entry) => ({ ...entry })),
          inFlight: Array.from(run.inFlight.values(), (entry) => ({
            requestNumber: entry.requestNumber,
            path: entry.path,
            ageMs: elapsed(performance.now(), entry.startedAt),
          })),
          droppedCompleted: run.droppedCompleted,
          droppedInFlight: run.droppedInFlight,
        }),
      };
    },
  };
}

function elapsed(now: number, startedAt: number): number {
  return Math.max(0, Math.round(now - startedAt));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function allowlisted<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): Value | undefined {
  return allowed.find((candidate) => candidate === value);
}

function responseFields(
  payload: unknown,
  path: PublicationPath,
): ResponseFields {
  if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return {};
  if (Buffer.byteLength(payload) > maximumResponseBytes) return {};
  let envelope: Record<string, unknown> | undefined;
  try {
    envelope = record(JSON.parse(payload.toString()));
  } catch {
    return {};
  }
  const result = record(envelope?.result);
  const resultStatus = allowlisted<ResultStatus>(
    result?.status,
    routeStatuses[path],
  );
  const errorCode = allowlisted(
    record(envelope?.error)?.errorCode,
    Object.values(ReviewActionV2ProtocolErrorCode),
  );
  const terminalOutcome = allowlisted(
    result?.terminalOutcome,
    Object.values(ReviewPublicationTerminalOutcome),
  );
  const pollAfterMs = result?.pollAfterMs;
  return {
    ...(resultStatus === undefined ? {} : { resultStatus }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(terminalOutcome === undefined ? {} : { terminalOutcome }),
    ...(typeof pollAfterMs === "number" &&
    Number.isSafeInteger(pollAfterMs) &&
    pollAfterMs >= 0
      ? { pollAfterMs }
      : {}),
  };
}
