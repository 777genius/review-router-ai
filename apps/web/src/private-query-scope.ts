"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

type Identity = {
  namespace: "review-statistics" | "provider-usage";
  actorId: string;
  workspaceId: string;
  seedId: string;
  effectiveAccess?: "admin" | "member" | undefined;
};
export const privateScopeKey = (scope: Omit<Identity, "seedId">) =>
  [
    scope.namespace,
    scope.actorId,
    scope.workspaceId,
    ...(scope.effectiveAccess ? [scope.effectiveAccess] : []),
  ] as const;
export const privateSeedKey = (scope: Identity) =>
  [...privateScopeKey(scope), scope.seedId] as const;
const deniedKey = (scope: Identity) =>
  ["private-query-denied-seed", ...privateSeedKey(scope)] as const;
const hadDenialKey = (scope: Identity) =>
  [
    "private-query-had-denial",
    scope.namespace,
    scope.actorId,
    scope.workspaceId,
  ] as const;
const recoveryKey = (
  scope: Pick<Identity, "namespace" | "actorId" | "workspaceId">,
) =>
  [
    "private-query-recovery",
    scope.namespace,
    scope.actorId,
    scope.workspaceId,
  ] as const;

/** Only trust markers and request lifetime; feature adapters own HTTP and query policy. */
export function usePrivateQueryScope(
  identity: Identity,
  isAccessFailure: (error: unknown) => boolean,
  isScopeMismatch: (error: unknown) => boolean,
) {
  const client = useQueryClient();
  const { namespace, actorId, workspaceId, seedId, effectiveAccess } = identity;
  const [denied, setDenied] = useState(
    () => client.getQueryData(deniedKey(identity)) === true,
  );
  const [seedTrusted, setSeedTrusted] = useState(
    () => client.getQueryData(hadDenialKey(identity)) !== true,
  );
  const active = useRef(true);
  const rejected = useRef(denied);
  const isActive = useCallback(() => active.current && !rejected.current, []);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      queueMicrotask(() => {
        if (active.current) return; // React Strict Mode effect replay.
        const queryKey = privateSeedKey({
          namespace,
          actorId,
          workspaceId,
          seedId,
          effectiveAccess,
        });
        void client.cancelQueries({ queryKey });
        client.removeQueries({ queryKey });
      });
    };
  }, [namespace, actorId, workspaceId, seedId, effectiveAccess, client]);
  const rejectAccess = useCallback(() => {
    if (!active.current || rejected.current) return false;
    rejected.current = true;
    setDenied(true);
    const scope = { namespace, actorId, workspaceId, seedId, effectiveAccess };
    for (const key of [deniedKey(scope), hadDenialKey(scope)]) {
      client.setQueryDefaults(key, { gcTime: Infinity });
      client.setQueryData(key, true);
    }
    const queryKey = privateScopeKey(scope);
    void client.cancelQueries({ queryKey });
    client.removeQueries({ queryKey });
    return true;
  }, [namespace, actorId, workspaceId, seedId, effectiveAccess, client]);
  const request = useCallback(
    async <T>(
      read: () => Promise<T>,
      onRejected?: (error: unknown) => void,
    ): Promise<T> => {
      try {
        const data = await read();
        if (!active.current || rejected.current)
          throw new DOMException("Request cancelled", "AbortError");
        setSeedTrusted(true);
        client.removeQueries({
          queryKey: recoveryKey({ namespace, actorId, workspaceId }),
          exact: true,
        });
        return data;
      } catch (error) {
        if (
          isAccessFailure(error) &&
          rejectAccess() &&
          isScopeMismatch(error) &&
          onRejected
        ) {
          const key = recoveryKey({ namespace, actorId, workspaceId });
          if (client.getQueryData(key) !== true) {
            client.setQueryDefaults(key, { gcTime: Infinity });
            client.setQueryData(key, true);
            onRejected(error);
          }
        }
        throw error;
      }
    },
    [
      isAccessFailure,
      isScopeMismatch,
      rejectAccess,
      client,
      namespace,
      actorId,
      workspaceId,
    ],
  );
  return { denied, seedTrusted, rejectAccess, request, isActive };
}
