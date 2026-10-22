"use client";

import { createContext, useEffect, useRef, useState } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { Button } from "@reviewrouter/ui";
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
  unknown: "Account limits: no observations yet",
  unsupported: "Account limits: this profile does not report limits",
  unavailable: "Account limits: source unavailable",
  restricted: "Account limits are visible to the owner",
};

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
        Account limits unavailable while the connection changes
      </p>
    );
  const now = clock ?? (view ? Date.parse(view.fetchedAt) : 0);
  const denied =
    query.data &&
    query.data.status !== "ok" &&
    query.data.status !== "unavailable";
  return (
    <div
      className="mt-2 min-w-0 space-y-1 text-xs text-slate-400"
      aria-label="Account limits"
    >
      {view?.status === "snapshot" ? (
        <>
          <p>
            {view.scope === "subscription" ? "Subscription" : "Account"} limits
            · shared across all activity
          </p>
          {view.windows.map((window, index) => {
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
                className="min-w-0 space-y-1 break-words"
              >
                <p>
                  {window.label} ·{" "}
                  {window.usedPercent === null
                    ? "used unknown; remaining unknown"
                    : `used ${window.usedPercent}%; remaining ${window.remainingPercent ?? "unknown"}%`}
                  {stale ? " · Last known observation (stale)" : ""}
                </p>
                {window.progressPercent !== null ? (
                  <div
                    role="progressbar"
                    aria-label={`${window.label} used`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={window.progressPercent}
                    aria-valuetext={`${window.usedPercent}% used`}
                    className="h-1 w-full max-w-56 overflow-hidden rounded bg-slate-700"
                  >
                    <div
                      className="h-full bg-cyan-400"
                      style={{ width: `${window.progressPercent}%` }}
                    />
                  </div>
                ) : null}
                <p>
                  Reset: {instant(window.resetAt, local)}
                  {elapsed
                    ? " · Awaiting an observation after reset"
                    : Number.isFinite(reset)
                      ? ` · in ${Math.ceil((reset - now) / 60_000)} min`
                      : ""}
                </p>
                <p>As of: {instant(window.observedAt, local)}</p>
              </div>
            );
          })}
        </>
      ) : (
        <p>
          {denied
            ? "Account limits are visible to the owner"
            : changed && expectedStatus === "restricted"
              ? statusText.restricted
              : view
                ? statusText[view.status]
                : "Account limits: no observations yet"}
        </p>
      )}
      {query.isError || query.data?.status === "unavailable" ? (
        <p role="status">
          Saved limits could not be read. Last known observations may be stale.
        </p>
      ) : null}
      {context && view?.status !== "restricted" && !denied ? (
        <Button
          variant="ghost"
          size="sm"
          className="min-h-9 max-w-full whitespace-normal px-0 text-xs"
          disabled={query.isFetching}
          onClick={() => {
            if (reading.current) return;
            reading.current = true;
            void query.refetch().finally(() => {
              reading.current = false;
            });
          }}
        >
          Read saved limits
        </Button>
      ) : null}
    </div>
  );
}
