"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@reviewrouter/ui";
import type { AccountView } from "../../src/server/account-gateway-accounts";
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

/** Already-public account metadata is used only to discard stale UI results.
 * It is never sent as diagnostic authority or as a Gateway request parameter. */
type ProbeAccountMetadata = Pick<
  AccountView,
  | "connectionId"
  | "gatewayRevision"
  | "mirrorRevision"
  | "authorizationEpoch"
  | "binding"
  | "state"
  | "readiness"
>;

export function GatewayConnectionTest({
  bindingId,
  model,
  available,
  account,
}: {
  bindingId: string;
  model: string;
  available: boolean;
  account?: ProbeAccountMetadata | undefined;
}) {
  const scope = useGatewayModelAccountScope();
  // Availability and safe metadata revisions also invalidate a past result. A
  // later response from the old request cannot restore it after this remount.
  const identity = JSON.stringify([
    scope,
    bindingId,
    model,
    available,
    account?.connectionId,
    account?.gatewayRevision,
    account?.mirrorRevision,
    account?.authorizationEpoch,
    account?.state,
    account?.readiness,
    account?.binding?.id,
    account?.binding?.revision,
    account?.binding?.state,
    account?.binding?.fencePending,
  ]);
  return (
    <ConnectionTest
      key={identity}
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
  const [completed, setCompleted] = useState<{
    result: Extract<ConnectionProbeEvent, { type: "result" }>;
    at: number;
  } | null>(null);
  const result = completed?.result;
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
    setCompleted(null);
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
          else setCompleted({ result: event, at: Date.now() });
        },
        controller.signal,
      );
    } catch {
      if (active.current === controller)
        setCompleted({
          result: {
            type: "result",
            ok: false,
            code: controller.signal.aborted ? "cancelled" : "unavailable",
          },
          at: Date.now(),
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
        <div
          role={result.ok ? "status" : "alert"}
          className={`mt-3 text-sm ${result.ok ? "text-emerald-300" : "text-amber-200"}`}
        >
          <p>
            {result.ok
              ? `Model answered · ${result.model} · ${(result.elapsedMs / 1000).toFixed(1)}s.`
              : errors[result.code]}
          </p>
          {result.ok && completed ? (
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Tested at{" "}
              <time dateTime={new Date(completed.at).toISOString()}>
                {new Date(completed.at).toLocaleString()}
              </time>
              . Account access can change. This test does not check review
              settings or tools.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
