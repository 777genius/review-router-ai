import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  createAccountDisplayAuthorization,
  equalScope,
  owned,
  type Scope,
  type Source,
} from "./account-metadata/authorization";
import {
  readAccountLimits,
  type AccountLimitsReader,
  type AccountLimitsRefresher,
  type AccountLimitsView,
} from "@reviewrouter/features-provider-accounts";
import {
  AccountDiagnosisError,
  type AccountDiagnosis,
} from "../features/account-gateway/account-diagnosis";
import type { AccountsResult, AccountView } from "./account-gateway-accounts";

export type AccountLimitsService = ReturnType<
  typeof createAccountLimitsService
>;

/** Resolves local IDs under live authorization. The native reader is cached-only. */
export function createAccountLimitsService(input: {
  prisma: PrismaClient;
  reader: AccountLimitsReader;
  refresher?: AccountLimitsRefresher;
  secret: string;
  authorize(): Promise<Scope>;
  ownerRef(
    owner:
      | { kind: "user"; userId: string }
      | { kind: "workspace"; workspaceId: string },
  ): string;
  operatorWorkspaceId?: string;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  const view = (
    status: "restricted" | "unknown" | "unavailable",
    displayToken = "restricted",
  ): AccountLimitsView => ({
    status,
    displayToken,
    fetchedAt: now().toISOString(),
    refreshAvailable: false,
    reason:
      status === "restricted"
        ? "owner_only"
        : status === "unknown"
          ? "missing_snapshot"
          : "source_unavailable",
  });
  const fingerprint = (scope: Scope, source: Source) =>
    createHmac("sha256", input.secret)
      .update(
        JSON.stringify(["account-limits-v1", scope, source], (_key, value) =>
          typeof value === "bigint" ? String(value) : value,
        ),
      )
      .digest("base64url");
  const { resolve } = createAccountDisplayAuthorization(input);
  async function observe(
    connectionId: string,
    explicitRefresh: boolean,
  ): Promise<AccountsResult<AccountLimitsView>> {
    try {
      const scope = await input.authorize();
      const source = (await resolve(scope, [connectionId]))[0];
      if (!source) return { status: "denied" };
      if (!owned(scope, source))
        return { status: "ok", value: view("restricted") };
      const token = fingerprint(scope, source);
      if (explicitRefresh && source.state !== "active")
        return { status: "denied" };
      // A reconnect/delete intent invalidates the prior generation immediately.
      if (
        source.pendingSourceOperationId ||
        !["active", "suspended"].includes(source.state)
      )
        return { status: "ok", value: view("unknown", token) };
      const epoch = Number(source.authorizationEpochMirror);
      if (
        source.authorizationEpochMirror === null ||
        !Number.isSafeInteger(epoch) ||
        epoch < 1 ||
        !source.profileRef
      )
        return { status: "ok", value: view("unavailable", token) };
      let refreshAvailable = false;
      let refreshDiagnosis: AccountDiagnosis | undefined;
      const value = await readAccountLimits({
        reader: {
          async read(target) {
            const supported =
              source.state === "active" && input.refresher
                ? input.refresher.supports(target.profileId).catch((error) => {
                    if (explicitRefresh)
                      refreshDiagnosis =
                        error instanceof AccountDiagnosisError
                          ? error.diagnosis
                          : { code: "unavailable", source: "network" };
                    return false;
                  })
                : Promise.resolve(false);
            if (!explicitRefresh) {
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                // Optional discovery must not consume the cached page's deadline.
                const [result, available] = await Promise.all([
                  input.reader.read(target),
                  Promise.race([
                    supported,
                    new Promise<boolean>((resolve) => {
                      timer = setTimeout(() => resolve(false), 250);
                    }),
                  ]),
                ]);
                refreshAvailable = available;
                return result;
              } finally {
                if (timer) clearTimeout(timer);
              }
            }
            refreshAvailable = await supported;
            if (!refreshAvailable || !input.refresher)
              return { status: "unsupported", reason: "unsupported_profile" };
            // Capability negotiation is awaited I/O too: fence immediately before
            // the explicit effect, then readAccountLimits fences its result again.
            if (!(await authorizeObservation()))
              return { status: "unknown", reason: "generation_changed" };
            try {
              return await input.refresher.refresh(target);
            } catch (error) {
              if (error instanceof AccountDiagnosisError)
                refreshDiagnosis = error.diagnosis;
              return { status: "unavailable", reason: "source_unavailable" };
            }
          },
        },
        now,
        authorize: authorizeObservation,
      });
      async function authorizeObservation() {
        const currentScope = await input.authorize();
        if (!equalScope(scope, currentScope)) return null;
        const current = (await resolve(currentScope, [connectionId]))[0];
        if (
          !current ||
          !owned(currentScope, current) ||
          fingerprint(currentScope, current) !== token
        )
          return null;
        return {
          displayToken: token,
          target: {
            ownerRef: input.ownerRef(
              current.ownerUserId
                ? { kind: "user", userId: current.ownerUserId }
                : {
                    kind: "workspace",
                    workspaceId: current.ownerWorkspaceId!,
                  },
            ),
            accountRef: current.gatewayAccountRef,
            profileId: current.profileRef!,
            expectedAuthorizationEpoch: epoch,
          },
        };
      }
      // Ownership was established above. A later scope/lifetime fence is an
      // authorization failure, not evidence that this viewer is a recipient.
      if (value.status === "restricted") return { status: "denied" };
      // Release a safe source diagnosis only after the same live authority fence.
      if (refreshDiagnosis)
        return { status: "unavailable", diagnosis: refreshDiagnosis };
      return { status: "ok", value: { ...value, refreshAvailable } };
    } catch {
      // Session/DB failure and transport diagnostics never become browser labels.
      return { status: "denied" };
    }
  }
  const read = (connectionId: string) => observe(connectionId, false);
  const refresh = (connectionId: string) => observe(connectionId, true);
  async function page<T extends AccountView>(
    accounts: readonly T[],
  ): Promise<T[]> {
    const rows = accounts.map((account) => ({
      ...account,
      limits: view("unavailable"),
    }));
    let cursor = 0;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = Promise.all(
      Array.from({ length: Math.min(4, rows.length) }, async () => {
        while (!closed && cursor < rows.length) {
          const index = cursor++;
          const result = await read(rows[index]!.connectionId);
          if (!closed && result.status === "ok")
            rows[index]!.limits = result.value;
        }
      }),
    );
    try {
      await Promise.race([
        work,
        new Promise<void>((done) => {
          timer = setTimeout(done, 3000);
        }),
      ]);
    } finally {
      closed = true;
      if (timer) clearTimeout(timer);
    }
    // A fast row may finish before another row consumes the page deadline.
    // Revalidate numeric projections and refresh authority before releasing the batch.
    const protectedRows = rows.filter(
      (row) => row.limits.status === "snapshot" || row.limits.refreshAvailable,
    );
    if (protectedRows.length) {
      try {
        const currentScope = await input.authorize();
        // One final SQL observation for the whole batch avoids holding an early
        // row's successful validation while another row's validation is awaited.
        const currentRows = await resolve(
          currentScope,
          protectedRows.map((row) => row.connectionId),
        );
        for (const row of protectedRows) {
          const current = currentRows.find(
            (source) =>
              source.id === row.connectionId ||
              source.bindingId === row.connectionId,
          );
          if (
            !current ||
            !owned(currentScope, current) ||
            fingerprint(currentScope, current) !== row.limits.displayToken
          )
            row.limits = view("unavailable");
        }
      } catch {
        for (const row of protectedRows) row.limits = view("unavailable");
      }
    }
    return rows;
  }
  return { read, refresh, page };
}
