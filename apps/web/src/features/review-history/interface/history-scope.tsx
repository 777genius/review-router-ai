"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  historyScopeKey,
  historyDeniedSeedKey,
  historyHadDenialKey,
  historySeedKey,
  isHistoryAccessFailure,
} from "../adapters/history-api";

type Scope = {
  actorId: string;
  workspaceId: string;
  seedId: string;
  denied: boolean;
  seedTrusted: boolean;
  request: <T>(read: () => Promise<T>) => Promise<T>;
};
const Context = createContext<Scope | null>(null);
export function HistoryScope({
  actorId,
  workspaceId,
  seedId,
  children,
}: Omit<Scope, "denied" | "seedTrusted" | "request"> & {
  children: ReactNode;
}) {
  const client = useQueryClient();
  const rejectedSeed =
    client.getQueryData(historyDeniedSeedKey(actorId, workspaceId, seedId)) ===
    true;
  const [denied, setDenied] = useState(rejectedSeed);
  const [seedTrusted, setSeedTrusted] = useState(
    () =>
      client.getQueryData(historyHadDenialKey(actorId, workspaceId)) !== true,
  );
  const active = useRef(true);
  const rejected = useRef(rejectedSeed);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      // Strict Mode replays effects without departing the instance.
      queueMicrotask(() => {
        if (active.current) return;
        const queryKey = historySeedKey(actorId, workspaceId, seedId);
        void client.cancelQueries({ queryKey });
        client.removeQueries({ queryKey });
      });
    };
  }, [actorId, workspaceId, seedId, client]);
  const request = useCallback(
    async <T,>(read: () => Promise<T>): Promise<T> => {
      try {
        const data = await read();
        if (!active.current || rejected.current)
          throw new DOMException("Request cancelled", "AbortError");
        setSeedTrusted(true);
        return data;
      } catch (error) {
        if (
          active.current &&
          !rejected.current &&
          isHistoryAccessFailure(error)
        ) {
          rejected.current = true;
          setDenied(true);
          // Cached RSC navigation may mount this same seed again. Retain only a
          // boolean for the QueryClient lifetime; a fresh SSR seed remains valid.
          const deniedKey = historyDeniedSeedKey(actorId, workspaceId, seedId);
          client.setQueryDefaults(deniedKey, { gcTime: Infinity });
          client.setQueryData(deniedKey, true);
          const scopeDeniedKey = historyHadDenialKey(actorId, workspaceId);
          client.setQueryDefaults(scopeDeniedKey, { gcTime: Infinity });
          client.setQueryData(scopeDeniedKey, true);
          const queryKey = historyScopeKey(actorId, workspaceId);
          void client.cancelQueries({ queryKey });
          client.removeQueries({ queryKey });
        }
        throw error;
      }
    },
    [actorId, workspaceId, seedId, client],
  );
  const value = useMemo(
    () => ({ actorId, workspaceId, seedId, denied, seedTrusted, request }),
    [actorId, workspaceId, seedId, denied, seedTrusted, request],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useHistoryScope() {
  const scope = useContext(Context);
  if (!scope) throw new Error("History scope is required");
  return scope;
}
