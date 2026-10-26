"use client";

import { createContext, useEffect, useRef, useState } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { Button } from "@reviewrouter/ui";
import { RefreshCw } from "lucide-react";
import type {
  AccountLimitsView,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import {
  accountLimitsOptions,
  releaseAccountLimits,
  removeAccountLimits,
} from "./account-limits-query";
import type { AccountLimitsRequest } from "./account-limits-api";

export const AccountLimitsReadContext = createContext<{
  scope: string;
  context: string;
  workspaceId?: string | undefined;
  client: QueryClient;
  projections?: ReadonlyMap<
    string,
    {
      displayToken: string;
      status: AccountLimitsView["status"];
      fetchedAt: string;
    }
  >;
  denied?: boolean;
  removed?: ReadonlySet<string>;
  replacingBootstrap?: boolean;
  allowed?: ReadonlySet<string>;
} | null>(null);

function instant(value: string | null, local: boolean) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "unknown";
  if (!local)
    return `${date
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, " UTC+00:00")}`;
  const offset = -date.getTimezoneOffset();
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return `${new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)} UTC${offset >= 0 ? "+" : "-"}${hours}:${minutes}`;
}
const statusText = {
  unknown: "No limits saved yet",
  unsupported: "Limits not supported",
  unavailable: "",
  restricted: "Limits visible to the owner only",
};

function resetText(reset: number, now: number) {
  if (!Number.isFinite(reset)) return "Reset unknown";
  if (now >= reset) return "Reset pending";
  const minutes = Math.ceil((reset - now) / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const remaining = minutes % 60;
  const duration = days
    ? `${days}d${hours ? ` ${hours}h` : ""}`
    : hours
      ? `${hours}h${remaining ? ` ${remaining}m` : ""}`
      : `${remaining}m`;
  return `Resets in ${duration}`;
}

export function AccountLimitsLine({
  scope,
  context,
  connectionId,
  workspaceId,
  client,
  initialData,
  blocked = false,
  expectedDisplayToken,
  expectedStatus,
  expectedFetchedAt,
}: AccountLimitsRequest & {
  scope: string;
  client: QueryClient;
  initialData?: AccountLimitsView | undefined;
  blocked?: boolean;
  expectedDisplayToken?: string | undefined;
  expectedStatus?: AccountLimitsView["status"] | undefined;
  expectedFetchedAt?: string | undefined;
}) {
  const reading = useRef(false);
  const [local, setLocal] = useState(false);
  const [clock, setClock] = useState<number | null>(null);
  const query = useQuery(
    {
      ...accountLimitsOptions(
        scope,
        { context, connectionId, workspaceId },
        client,
      ),
      ...(initialData
        ? {
            initialData: {
              status: "ok",
              value: initialData,
            } as AccountsResult<AccountLimitsView>,
          }
        : {}),
    },
    client,
  );
  const cachedView = query.data?.status === "ok" ? query.data.value : null;
  const changed =
    expectedDisplayToken !== undefined &&
    cachedView?.displayToken !== expectedDisplayToken &&
    (!cachedView ||
      !expectedFetchedAt ||
      cachedView.fetchedAt <= expectedFetchedAt);
  const view = changed ? null : cachedView;
  const fetchedAt = view?.fetchedAt;
  useEffect(() => {
    setLocal(true);
    const started = Date.now();
    const serverNow = fetchedAt ? Date.parse(fetchedAt) : started;
    setClock(serverNow);
    const timer = window.setInterval(
      () => setClock(serverNow + Date.now() - started),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [fetchedAt]);
  useEffect(() => {
    if (blocked) void removeAccountLimits(client, scope, connectionId);
  }, [blocked, client, scope, connectionId]);
  useEffect(
    () => () => {
      releaseAccountLimits(client, scope, connectionId);
    },
    [client, scope, connectionId],
  );
  if (blocked)
    return (
      <p className="mt-2 text-xs text-slate-400">
        Limits unavailable while connection changes
      </p>
    );
  const now = clock ?? (view ? Date.parse(view.fetchedAt) : 0);
  const denied =
    query.data &&
    query.data.status !== "ok" &&
    query.data.status !== "unavailable";
  if (denied) return null;
  const restricted =
    view?.status === "restricted" ||
    (changed && expectedStatus === "restricted");
  const unsupported =
    view?.status === "unsupported" ||
    (changed && expectedStatus === "unsupported");
  const unavailable =
    view?.status === "unavailable" ||
    (changed && expectedStatus === "unavailable");
  return (
    <div
      className="mt-2 flex min-w-0 items-start gap-2 text-xs text-slate-400"
      aria-label="Account limits"
    >
      <div className="min-w-0 flex-1 space-y-2">
        {view?.status === "snapshot" ? (
          <>
            {view.windows
              .filter(
                (window) =>
                  window.dimension === undefined ||
                  window.remainingPercent !== null ||
                  (window.dimension === "plan_quota" &&
                    window.resetAt !== null),
              )
              .sort(
                (left, right) =>
                  Number(left.dimension === "rate_limit") -
                  Number(right.dimension === "rate_limit"),
              )
              .slice(0, 2)
              .map((window, index) => {
                const reset = window.resetAt ? Date.parse(window.resetAt) : NaN;
                const observed = window.observedAt
                  ? Date.parse(window.observedAt)
                  : NaN;
                const elapsed = Number.isFinite(reset) && now >= reset;
                const stale =
                  window.stale ||
                  !Number.isFinite(observed) ||
                  now - observed >= 300_000 ||
                  elapsed;
                return (
                  <div
                    key={`${window.label}:${index}`}
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5"
                  >
                    <span className="min-w-4 shrink-0">{window.label}</span>
                    <span className="min-w-20 font-semibold tabular-nums text-slate-100">
                      {window.remainingPercent === null
                        ? window.dimension === "plan_quota"
                          ? "Remaining not reported"
                          : "Remaining unknown"
                        : `${window.remainingPercent}% left`}
                    </span>
                    {window.remainingPercent !== null ? (
                      <div
                        role="progressbar"
                        aria-label={`${window.label} remaining`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={window.remainingPercent}
                        aria-valuetext={`${window.remainingPercent}% remaining${window.usedPercent === null ? "" : `; ${window.usedPercent}% used`}`}
                        className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-slate-700 sm:w-20"
                      >
                        <div
                          className={
                            window.remainingPercent <= 5
                              ? "h-full bg-rose-400"
                              : window.remainingPercent <= 20
                                ? "h-full bg-amber-400"
                                : "h-full bg-cyan-400"
                          }
                          style={{ width: `${window.remainingPercent}%` }}
                        />
                      </div>
                    ) : null}
                    <span className="whitespace-nowrap tabular-nums">
                      {resetText(reset, now)}
                    </span>
                    {stale ? (
                      <span className="rounded bg-amber-300/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
                        Outdated
                      </span>
                    ) : null}
                  </div>
                );
              })}
            <details>
              <summary className="w-fit cursor-pointer rounded text-slate-500 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/70">
                Details
              </summary>
              <div className="mt-2 space-y-2 break-words">
                <p>
                  {view.scope === "subscription" ? "Subscription" : "Account"}{" "}
                  limits
                  {" · "}shared across all activity
                </p>
                {view.windows.map((window, index) => (
                  <div key={`${window.label}:${index}`} className="space-y-1">
                    <p>
                      {window.label}
                      {" · "}
                      {window.usedPercent === null
                        ? "Used unknown"
                        : `${window.usedPercent}% used`}
                    </p>
                    {window.dimension ? (
                      <p>
                        {window.dimension === "rate_limit"
                          ? "Rate limit"
                          : "Plan quota"}
                        {window.unit && window.unit !== "unknown"
                          ? ` · ${window.unit}`
                          : ""}
                      </p>
                    ) : null}
                    <p>Reset: {instant(window.resetAt, local)}</p>
                    <p>As of: {instant(window.observedAt, local)}</p>
                  </div>
                ))}
              </div>
            </details>
          </>
        ) : (
          <p>
            {restricted
              ? statusText.restricted
              : unsupported
                ? statusText.unsupported
                : unavailable
                  ? null
                  : view
                    ? statusText[view.status]
                    : statusText.unknown}
          </p>
        )}
        {query.isError || query.data?.status === "unavailable" ? (
          <p role="status">Could not reload saved limits.</p>
        ) : null}
      </div>
      {context && !restricted && !unsupported ? (
        <Button
          variant="ghost"
          size="sm"
          className="size-8 min-h-8 rounded-lg p-0 text-slate-400"
          aria-label="Reload saved limits"
          title="Reload the saved snapshot. Does not contact the provider."
          disabled={query.isFetching}
          onClick={() => {
            if (reading.current) return;
            reading.current = true;
            void query.refetch().finally(() => {
              reading.current = false;
            });
          }}
        >
          <RefreshCw
            aria-hidden="true"
            className={`size-3.5${query.isFetching ? " motion-safe:animate-spin" : ""}`}
          />
        </Button>
      ) : null}
    </div>
  );
}
