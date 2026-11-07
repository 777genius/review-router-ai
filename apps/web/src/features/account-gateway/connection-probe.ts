import type { AccountDiagnosis } from "./account-diagnosis";
export type ConnectionProbeRequest = {
  context: string;
  workspaceId: string;
  bindingId: string;
  model: string;
  nonce: string;
};
export const connectionProbeStages = [
  "authorizing",
  "connecting",
  "requesting",
  "receiving",
  "validating",
  "closing",
] as const;
export type ConnectionProbeStage = (typeof connectionProbeStages)[number];
export type ConnectionProbeEvent =
  | { type: "progress"; stage: ConnectionProbeStage }
  | { type: "result"; ok: true; elapsedMs: number; model: string }
  | {
      type: "result";
      ok: false;
      diagnosis?: AccountDiagnosis | undefined;
      code:
        | "denied"
        | "unavailable"
        | "invalid_response"
        | "timeout"
        | "cancelled"
        | "busy"
        | "rate_limited"
        | "cleanup_pending";
    };

export function connectionProbeDiagnosis(
  code: Extract<ConnectionProbeEvent, { ok: false }>["code"],
): AccountDiagnosis {
  const meanings: Record<typeof code, AccountDiagnosis> = {
    denied: { code: "access_denied", source: "application" },
    unavailable: { code: "unavailable", source: "gateway" },
    invalid_response: { code: "invalid_response", source: "provider" },
    timeout: { code: "timeout", source: "network" },
    cancelled: { code: "cancelled", source: "application" },
    busy: { code: "busy", source: "gateway" },
    rate_limited: { code: "rate_limited", source: "application" },
    cleanup_pending: { code: "cleanup_pending", source: "gateway" },
  };
  return meanings[code];
}
