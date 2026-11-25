import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  assertOpaqueReference,
  ProviderAccountError,
} from "./domain/provider-account";

export const gatewayProbeAccessPath =
  "/internal/dashboard/gateway-probe-access";
export const gatewayProbeTimeoutMs = 90000;
export const gatewayProbeLimits = Object.freeze({
  requests: 1,
  requestBytes: 4096,
  outputBytes: 262144,
  tokens: 1024,
  concurrency: 1,
});
export function gatewayProbeId(kind: string, bindingId: string, nonce: string) {
  return `rr-probe-${kind}-${createHash("sha256").update(`${bindingId}\0${nonce}`).digest("hex")}`;
}
export type GatewayProbeAccessRequest = {
  userId: string;
  workspaceId: string;
  bindingId: string;
  model: string;
  nonce: string;
  deadline: string;
};
export function captureGatewayProbeAccessRequest(
  raw: unknown,
): GatewayProbeAccessRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ProviderAccountError("invalid_input");
  const value = raw as Record<string, unknown>;
  const keys = [
    "userId",
    "workspaceId",
    "bindingId",
    "model",
    "nonce",
    "deadline",
  ];
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof value[key] !== "string")
  )
    throw new ProviderAccountError("invalid_input");
  const result = {
    userId: value.userId as string,
    workspaceId: value.workspaceId as string,
    bindingId: value.bindingId as string,
    model: value.model as string,
    nonce: value.nonce as string,
    deadline: value.deadline as string,
  };
  for (const id of [result.userId, result.workspaceId, result.bindingId])
    assertOpaqueReference(id);
  if (
    !result.model ||
    result.model.length > 256 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result.nonce,
    ) ||
    result.deadline.length > 32 ||
    !Number.isFinite(Date.parse(result.deadline)) ||
    new Date(result.deadline).toISOString() !== result.deadline
  )
    throw new ProviderAccountError("invalid_input");
  return result;
}
/** Private web→API proof. It authenticates only this bounded diagnostic purpose,
 * never a review run, arbitrary Prepare, provider credential or browser request. */
export function signGatewayProbeAccess(
  request: GatewayProbeAccessRequest,
  secret: string,
) {
  if (secret.length < 16) throw new ProviderAccountError("invalid_input");
  return createHmac("sha256", secret)
    .update("rr-dashboard-gateway-probe-v1\0")
    .update(JSON.stringify(captureGatewayProbeAccessRequest(request)))
    .digest("hex");
}
export function verifyGatewayProbeAccess(
  request: GatewayProbeAccessRequest,
  signature: unknown,
  secret: string,
) {
  if (
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    secret.length < 16
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(signGatewayProbeAccess(request, secret), "hex"),
  );
}
