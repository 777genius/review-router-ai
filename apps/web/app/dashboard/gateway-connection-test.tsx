"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@reviewrouter/ui";
import { Check, LoaderCircle, PlugZap } from "lucide-react";
import { useGatewayModelAccountScope } from "./gateway-model-account-options";
import { testGatewayConnection } from "./gateway-connection-probe-api";
import {
  connectionProbeStages,
  type ConnectionProbeEvent,
  type ConnectionProbeStage,
} from "../../src/features/account-gateway/connection-probe";

const labels: Record<ConnectionProbeStage, string> = {
  authorizing: "Checking account access",
  connecting: "Connecting to the gateway",
  requesting: "Sending a real model request",
  receiving: "Receiving the model response",
  validating: "Validating the response",
  closing: "Closing the test session",
};
const errors = {
  denied:
    "Account access changed or the model is unavailable. Refresh account options.",
  unavailable:
    "The connection could not be tested. Check the gateway and account, then try again.",
  invalid_response: "The provider did not return a complete text response.",
  timeout:
    "The request timed out. Completion is unconfirmed; it was not retried.",
  cancelled: "Test cancelled. A request already sent may still consume quota.",
  busy: "The account is currently busy. Wait for its active request to finish, then test again.",
  rate_limited: "Too many tests. Wait a minute before trying again.",
  cleanup_pending:
    "The test session could not be confirmed closed. Wait for it to expire before testing again.",
};

export function GatewayConnectionTest({
  bindingId,
  model,
  available,
}: {
  bindingId: string;
  model: string;
  available: boolean;
}) {
  const scope = useGatewayModelAccountScope();
  // Remount on any selection/workspace change: abort old work and discard its result.
  return (
    <ConnectionTest
      key={`${scope}:${bindingId}:${model}`}
      scope={scope}
      bindingId={bindingId}
      model={model}
      available={available}
    />
  );
}
function ConnectionTest({
  scope,
  bindingId,
  model,
  available,
}: {
  scope: string | null;
  bindingId: string;
  model: string;
  available: boolean;
}) {
  const [stage, setStage] = useState<ConnectionProbeStage | null>(null);
  const [result, setResult] = useState<Extract<
    ConnectionProbeEvent,
    { type: "result" }
  > | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [running]);
  async function run() {
    if (active.current || !scope || !available) return;
    const separator = ":workspace:";
    const offset = scope.indexOf(separator);
    if (offset < 1) return;
    const controller = new AbortController();
    active.current = controller;
    setResult(null);
    setStage("authorizing");
    setElapsed(0);
    setRunning(true);
    try {
      await testGatewayConnection(
        {
          context: scope.slice(0, offset),
          workspaceId: scope.slice(offset + separator.length),
          bindingId,
          model,
          nonce: crypto.randomUUID(),
        },
        (event) => {
          if (active.current !== controller) return;
          if (event.type === "progress") setStage(event.stage);
          else setResult(event);
        },
        controller.signal,
      );
    } catch {
      if (active.current === controller)
        setResult({
          type: "result",
          ok: false,
          code: controller.signal.aborted ? "cancelled" : "unavailable",
        });
    } finally {
      if (active.current === controller) {
        active.current = null;
        setRunning(false);
      }
    }
  }
  const current = stage ? connectionProbeStages.indexOf(stage) : -1;
  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={!available || !scope || running}
          onClick={() => void run()}
        >
          {running ? (
            <LoaderCircle
              className="mr-2 size-4 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <PlugZap className="mr-2 size-4" aria-hidden="true" />
          )}
          {running ? "Testing connection…" : "Test connection"}
        </Button>
        {running ? (
          <button
            type="button"
            className="text-sm text-slate-300 underline underline-offset-4"
            onClick={() => active.current?.abort()}
          >
            Cancel test
          </button>
        ) : null}
        <span className="text-xs text-slate-400">
          One small request to the selected model. Uses account quota.
        </span>
      </div>
      {!available ? (
        <p className="mt-2 text-sm">
          Choose an available account and model to test.
        </p>
      ) : !scope ? (
        <p className="mt-2 text-sm">
          Refresh the page to enable connection testing.
        </p>
      ) : null}
      {running ? (
        <div className="mt-3" aria-busy="true">
          <p role="status" className="text-sm text-cyan-200">
            {stage ? labels[stage] : "Starting test"} · {elapsed}s
          </p>
          <ol
            aria-label="Connection test progress"
            className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"
          >
            {connectionProbeStages.map((step, index) => (
              <li
                key={step}
                className={
                  index === current
                    ? "text-cyan-200"
                    : index < current
                      ? "text-slate-300"
                      : "text-slate-500"
                }
              >
                {index < current ? (
                  <Check className="mr-1 inline size-3" aria-hidden="true" />
                ) : null}
                {labels[step]}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={`mt-3 text-sm ${result.ok ? "text-emerald-300" : "text-amber-200"}`}
        >
          {result.ok
            ? `Connection successful · ${result.model} · ${(result.elapsedMs / 1000).toFixed(1)}s. Real model response verified.`
            : errors[result.code]}
        </p>
      ) : null}
    </div>
  );
}
