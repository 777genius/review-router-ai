import type { UsageIdentity } from "@reviewrouter/features-provider-usage";
/** Already persisted RR identity, containing no Gateway account/native capability. */
export function gatewayUsageReceipt(identity: UsageIdentity): string {
  if (
    identity.route !== "gateway" ||
    !/^gw-[a-f0-9]{64}$/.test(identity.callId)
  )
    throw new Error("usage_receipt_invalid");
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, identity }));
  if (bytes.length > 6144) throw new Error("usage_receipt_too_large");
  return bytes.toString("base64url");
}
