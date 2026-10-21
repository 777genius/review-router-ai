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
