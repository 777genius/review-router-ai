import {
  activateGatewaySession,
  gatewaySessionMaxLifetimeMs,
  openGatewaySession,
  type GatewaySession,
} from "../../domain/gateway-session";
import {
  ContextAttestationPersistenceStatus,
  type ContextAttestationClockPort,
  type ContextAttestationIdentityPort,
  type ContextAttestationStorePort,
  type TrustedGatewaySessionOpeningFactsPort,
} from "../ports/context-attestation-ports";

export enum OpenContextGatewaySessionStatus {
  Opened = "opened",
  Idempotent = "idempotent",
  Denied = "denied",
  Conflict = "conflict",
}

export type OpenContextGatewaySessionResult = Readonly<{
  status: OpenContextGatewaySessionStatus;
  session: GatewaySession | null;
}>;

export class OpenContextGatewaySession {
  constructor(
    private readonly dependencies: Readonly<{
      openingFacts: TrustedGatewaySessionOpeningFactsPort;
      store: ContextAttestationStorePort;
      identities: ContextAttestationIdentityPort;
      clock: ContextAttestationClockPort;
    }>,
  ) {}

  async execute(command: {
    readonly attemptId: string;
    readonly leaseCapabilityId: string;
    readonly confinementEvidenceId: string;
  }): Promise<OpenContextGatewaySessionResult> {
    const facts =
      await this.dependencies.openingFacts.resolveOpeningFacts(command);
    if (!facts) return result(OpenContextGatewaySessionStatus.Denied, null);
    if (
      !Number.isSafeInteger(facts.sessionLifetimeMs) ||
      facts.sessionLifetimeMs <= 0 ||
      facts.sessionLifetimeMs > gatewaySessionMaxLifetimeMs
    ) {
      return result(OpenContextGatewaySessionStatus.Denied, null);
    }
    const nowMs = this.dependencies.clock.nowMs();
    if (
      facts.sessionExpiresAtLimitMs !== undefined &&
      (!Number.isSafeInteger(facts.sessionExpiresAtLimitMs) ||
        facts.sessionExpiresAtLimitMs <= nowMs)
    ) {
      return result(OpenContextGatewaySessionStatus.Denied, null);
    }
    const { sessionLifetimeMs, sessionExpiresAtLimitMs, ...sessionFacts } =
      facts;
    const session = activateGatewaySession(
      openGatewaySession({
        sessionId: this.dependencies.identities.nextGatewaySessionId(),
        ...sessionFacts,
        openedAtMs: nowMs,
        expiresAtMs: Math.min(
          nowMs + sessionLifetimeMs,
          sessionExpiresAtLimitMs ?? Number.MAX_SAFE_INTEGER,
        ),
      }),
      nowMs,
    );
    const persisted = await this.dependencies.store.openSession(
      session,
      facts.sessionExpiresAtLimitMs === undefined
        ? undefined
        : {
            sessionLifetimeMs: facts.sessionLifetimeMs,
            expiresAtLimitMs: facts.sessionExpiresAtLimitMs,
          },
    );
    switch (persisted.status) {
      case ContextAttestationPersistenceStatus.Created:
        return result(OpenContextGatewaySessionStatus.Opened, persisted.value);
      case ContextAttestationPersistenceStatus.Idempotent:
        return result(
          OpenContextGatewaySessionStatus.Idempotent,
          persisted.value,
        );
      case ContextAttestationPersistenceStatus.Conflict:
        return result(OpenContextGatewaySessionStatus.Conflict, null);
    }
  }
}

function result(
  status: OpenContextGatewaySessionStatus,
  session: GatewaySession | null,
): OpenContextGatewaySessionResult {
  return Object.freeze({ status, session });
}
