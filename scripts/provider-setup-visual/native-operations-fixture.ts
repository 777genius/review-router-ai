import type { IncomingMessage } from "node:http";
import {
  VISUAL_NATIVE_COMPLETION,
  VISUAL_NATIVE_DOCUMENT,
  VISUAL_NATIVE_PROFILE,
  VISUAL_NATIVE_SECRET,
  visualNativeMethods,
} from "./native-catalog-fixture.js";

type Account = {
  accountRef: string;
  ownerRef: string;
  profileId: string;
  displayName: string;
  state: "active";
  metadataRevision: number;
  authorizationEpoch: number;
};
type Receipt = {
  operation: Record<string, unknown>;
  connection: {
    connection: Record<string, unknown>;
    method: (typeof visualNativeMethods)[number];
    credential?: Record<string, string>;
  };
};

/** No credential values are retained: only receipts, account DTOs and boolean evidence. */
export function createNativeOperationsFixture() {
  const receipts = new Map<string, Receipt>();
  const targets = new Map<string, Account>();
  const accounts = new Map<string, Account>();
  const authorizedDevices = new Set<string>();
  const effects: {
    action: string;
    methodId: string;
    inputAccepted: boolean;
  }[] = [];
  let discoveryAvailable = true;
  const apply = (operationId: string, receipt: Receipt) => {
    const account = targets.get(operationId)!;
    accounts.set(account.accountRef, account);
    receipt.operation = {
      operationRef: operationId,
      state: "applied",
      result: {
        kind: "account",
        accountRef: account.accountRef,
        metadataRevision: account.metadataRevision,
        authorizationEpoch: account.authorizationEpoch,
      },
    };
    receipt.connection.credential = {
      credentialKind: "native",
      credentialPolicy: receipt.connection.method.allowedCredentialPolicies[0]!,
      refreshPolicy: "native",
    };
    return receipt;
  };
  return {
    get discoveryAvailable() {
      return discoveryAvailable;
    },
    setDiscoveryAvailable(value: boolean) {
      discoveryAvailable = value;
    },
    evidence: () => structuredClone(effects),
    accounts: () => [...accounts.values()],
    authorizeDevice(displayName: string) {
      const pending = [...targets].filter(
        ([operationId, account]) =>
          account.displayName === displayName &&
          receipts.get(operationId)?.connection.method.methodId === "device" &&
          receipts.get(operationId)?.operation.state === "pending",
      );
      if (pending.length !== 1)
        throw new Error("expected one exact pending device authorization");
      authorizedDevices.add(pending[0]![0]);
    },
    async handle(
      request: IncomingMessage,
      path: string,
      send: (status: number, body: unknown) => void,
    ): Promise<boolean> {
      if (request.method === "GET" && path.startsWith("/v3/operations/")) {
        const receipt = receipts.get(
          decodeURIComponent(path.slice("/v3/operations/".length)),
        );
        send(receipt ? 200 : 404, receipt ?? { error: "not_found" });
        return true;
      }
      if (
        request.method !== "POST" ||
        !path.startsWith("/v3/accounts/connections/")
      )
        return false;
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      const input = JSON.parse(raw) as Record<string, unknown>;
      const operationId = String(input.operationId);
      if (path.endsWith("/begin")) {
        const connection = input.connection as Record<string, unknown>;
        const method = visualNativeMethods.find(
          (row) =>
            row.methodId === connection.methodId && row.methodId !== "future",
        );
        if (
          !discoveryAvailable ||
          !method ||
          connection.profileId !== VISUAL_NATIVE_PROFILE ||
          connection.methodRevision !== method.revision ||
          connection.configurationGeneration !== method.configurationGeneration
        ) {
          send(409, { error: "binding_unavailable" });
          return true;
        }
        const fields = input.inputFields as Record<string, unknown>;
        const inputAccepted =
          method.methodId !== "structured" ||
          (fields.project === "visual-project" &&
            fields.region === "eu" &&
            fields.document === VISUAL_NATIVE_DOCUMENT &&
            fields.secret === VISUAL_NATIVE_SECRET);
        effects.push({
          action: "begin",
          methodId: method.methodId,
          inputAccepted,
        });
        if (!inputAccepted) {
          send(400, { error: "invalid_input" });
          return true;
        }
        if (receipts.has(operationId)) {
          send(200, receipts.get(operationId));
          return true;
        }
        const receipt: Receipt = {
          operation: { operationRef: operationId, state: "pending" },
          connection: { connection, method },
        };
        receipts.set(operationId, receipt);
        targets.set(operationId, {
          accountRef: `visual-native-account-${receipts.size}`,
          ownerRef: String(input.ownerRef),
          profileId: VISUAL_NATIVE_PROFILE,
          displayName: String(input.displayName),
          state: "active",
          metadataRevision: 1,
          authorizationEpoch: 1,
        });
        if (method.methodId === "structured")
          send(200, apply(operationId, receipt));
        else
          send(202, {
            ...receipt,
            challenge:
              method.methodId === "browser"
                ? {
                    kind: "browser",
                    authorizationURL:
                      "https://identity.example.invalid/authorize?handoff=transient-once",
                  }
                : {
                    kind: "device",
                    userCode: "VISUAL-CODE",
                    verificationURL: "https://identity.example.invalid/device",
                    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
                    intervalSeconds: 3,
                  },
          });
        return true;
      }
      const receipt = receipts.get(operationId);
      const target = targets.get(operationId);
      if (!receipt || target?.ownerRef !== input.ownerRef) {
        send(404, { error: "not_found" });
        return true;
      }
      const methodId = receipt.connection.method.methodId;
      if (path.endsWith("/submit")) {
        const fields = input.inputFields as Record<string, unknown>;
        const inputAccepted =
          methodId === "browser" &&
          fields.completion === VISUAL_NATIVE_COMPLETION;
        effects.push({ action: "submit", methodId, inputAccepted });
        send(
          inputAccepted ? 200 : 400,
          inputAccepted
            ? apply(operationId, receipt)
            : { error: "invalid_input" },
        );
        return true;
      }
      if (path.endsWith("/poll")) {
        effects.push({
          action: "poll",
          methodId,
          inputAccepted: methodId === "device",
        });
        send(
          200,
          methodId === "device" && authorizedDevices.has(operationId)
            ? apply(operationId, receipt)
            : receipt,
        );
        return true;
      }
      return false;
    },
  };
}

export type NativeOperationsFixture = ReturnType<
  typeof createNativeOperationsFixture
>;
