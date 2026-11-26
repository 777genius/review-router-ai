import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  VISUAL_CONNECTIONS,
  VISUAL_USERS,
  VISUAL_WORKSPACES,
} from "./fixture-contract.js";
import { VISUAL_NATIVE_PROFILE } from "./native-catalog-fixture.js";

/** Reuses the existing PG ownership and bindings, changing only the provider. */
export const NATIVE_VISIBILITY = {
  personal: {
    connection: VISUAL_CONNECTIONS.adminPersonal,
    label: "Native personal connection",
    email: "native-personal-owner@example.invalid",
  },
  organization: {
    connection: VISUAL_CONNECTIONS.mainOrg,
    label: "Native workspace connection",
    email: "native-workspace-admin@example.invalid",
  },
} as const;

/** Read-only HTTP fixture. RR's production PG authorization chooses the reads. */
export function createNativeVisibilityFixture() {
  let active = false;
  const reads: Array<{
    realm: "management" | "consumer-control";
    ownerRef: string;
    accountRefs: string[];
  }> = [];
  const rows = Object.values(VISUAL_CONNECTIONS).map((connection) => {
    const native = Object.values(NATIVE_VISIBILITY).find(
      (value) => value.connection.id === connection.id,
    );
    const personal = connection.owner.kind === "user";
    const ownerId = personal
      ? VISUAL_USERS[connection.owner.user].id
      : VISUAL_WORKSPACES[connection.workspace].id;
    const ownerRef = `${personal ? "rru" : "rrw"}_${createHash("sha256")
      .update(
        `${personal ? "rr-user-owner-v1" : "rr-workspace-owner-v1"}\0${ownerId}`,
      )
      .digest("hex")}`;
    const account = {
      accountRef: connection.gatewayAccountRef,
      ownerRef,
      profileId: native ? VISUAL_NATIVE_PROFILE : connection.profileRef,
      displayName: native?.label ?? connection.displayName,
      state: "active" as const,
      metadataRevision: 1,
      authorizationEpoch: 1,
    };
    return {
      account,
      email: native?.email,
      lifecycle: {
        ...account,
        authKind: native ? "native" : "api_key",
        resumeCustody: "not_applicable",
        ...(native
          ? {
              credential: {
                credentialKind: "native",
                credentialPolicy: "cloud_identity",
                refreshPolicy: "none",
              },
            }
          : {}),
      },
    };
  });
  const capability = {
    contract: "account-gateway/account-lifecycle/v3",
    clientContract: "account-gateway-client/account-lifecycle/v3",
    writeGate: "disabled",
    operations: ["suspend", "resume"],
    custody: {
      contract: "native-retained-custody/v2",
      api_key: "native-attestation-required",
      oauth: "native-attestation-required",
      native: "native-attestation-required",
    },
  };
  return {
    get active() {
      return active;
    },
    setActive(value: boolean) {
      active = value;
    },
    reads: () => structuredClone(reads),
    async handle(
      request: IncomingMessage,
      path: string,
      realm: "management" | "consumer-control",
      send: (status: number, body: unknown) => void,
    ): Promise<boolean> {
      if (!active) return false;
      if (request.method === "GET") {
        if (path === "/v3/capabilities/account-lifecycle") {
          send(200, capability);
          return true;
        }
        const lifecycle = path.startsWith("/v3/");
        if (["/v1/accounts", "/v3/accounts"].includes(path)) {
          const owner = new URL(
            request.url!,
            "http://127.0.0.1",
          ).searchParams.get("ownerRef");
          send(200, {
            accounts: rows
              .filter((row) => row.account.ownerRef === owner)
              .map((row) => (lifecycle ? row.lifecycle : row.account)),
          });
          return true;
        }
        const row = rows.find(
          (value) =>
            path ===
            `/v${lifecycle ? 3 : 1}/accounts/${value.account.accountRef}`,
        );
        if (row) {
          send(200, lifecycle ? row.lifecycle : row.account);
          return true;
        }
      }
      if (request.method !== "POST" || path !== "/v2/account-info/read")
        return false;
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const input = metadataRequest(body);
      if (!input) {
        send(400, { error: "invalid_metadata_request" });
        return true;
      }
      reads.push({
        realm,
        ownerRef: input.ownerRef,
        accountRefs: [...input.accountRefs],
      });
      const selected = input.accountRefs.map((ref) =>
        rows.find((row) => row.account.accountRef === ref),
      );
      if (
        selected.some(
          (row) => !row || row.account.ownerRef !== input.ownerRef,
        ) ||
        // Workspace inventory uses management for owned personal rows too.
        // Consumer-control metadata remains restricted to personal owners.
        (input.ownerRef.startsWith("rrw_") && realm !== "management")
      ) {
        send(403, { error: "account_unavailable" });
        return true;
      }
      send(200, {
        contract: "account-info/v2",
        accounts: selected.map((row) => ({
          accountRef: row!.account.accountRef,
          metadataRevision: 1,
          authorizationEpoch: 1,
          info: row!.email
            ? {
                status: "available",
                infoRevision: "native-visibility-1",
                fields: {
                  email: {
                    status: "known",
                    value: row!.email,
                    source: "provider_api",
                    observedAt: new Date().toISOString(),
                    freshness: "current",
                  },
                  accountLabel: { status: "unknown" },
                  subscription: { status: "unknown" },
                  credentialExpiresAt: { status: "unknown" },
                  trainingUsage: { status: "unknown" },
                },
              }
            : { status: "unsupported" },
        })),
      });
      return true;
    },
  };
}

function metadataRequest(body: string) {
  try {
    const value: unknown = JSON.parse(body);
    if (
      value === null ||
      typeof value !== "object" ||
      !("ownerRef" in value) ||
      typeof value.ownerRef !== "string" ||
      !("accountRefs" in value) ||
      !Array.isArray(value.accountRefs) ||
      value.accountRefs.length < 1 ||
      value.accountRefs.length > 50 ||
      !value.accountRefs.every(
        (ref: unknown): ref is string => typeof ref === "string",
      )
    )
      return null;
    return { ownerRef: value.ownerRef, accountRefs: value.accountRefs };
  } catch {
    return null;
  }
}

export type NativeVisibilityFixture = ReturnType<
  typeof createNativeVisibilityFixture
>;
