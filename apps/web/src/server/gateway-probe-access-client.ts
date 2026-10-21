import * as c from "@agent-teams/account-gateway/contracts";
import {
  GatewayError,
  type ConsumerControlClient,
} from "@agent-teams/account-gateway/http";
import {
  captureGatewayProbeAccessRequest,
  gatewayProbeAccessPath,
  signGatewayProbeAccess,
  type GatewayProbeAccessRequest,
} from "@reviewrouter/features-provider-accounts/gateway-probe";
import { z } from "zod";
const envelope = z.strictObject({
  operation: c.preparationOperation,
  bearer: z.string().regex(/^[A-Za-z0-9._~-]{16,1024}$/),
  admission: c.admission,
});

export function gatewayProbeAccessClient(
  settings: { origin: string; secret: string },
  input: Omit<GatewayProbeAccessRequest, "deadline">,
): Pick<ConsumerControlClient, "runAccess"> {
  const origin = new URL(settings.origin);
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("probe_api_configuration_invalid");
  return {
    async runAccess(intent, options) {
      const request = captureGatewayProbeAccessRequest({
        ...input,
        deadline: intent.deadline,
      });
      const response = await fetch(new URL(gatewayProbeAccessPath, origin), {
        method: "POST",
        redirect: "manual",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-reviewrouter-probe-proof": signGatewayProbeAccess(
            request,
            settings.secret,
          ),
        },
        body: JSON.stringify(request),
        signal: options?.signal ?? AbortSignal.timeout(15000),
      });
      if (!response.ok || !response.body)
        throw new GatewayError(
          "safe_error",
          "not_dispatched",
          intent.operationId,
        );
      const reader = response.body.getReader();
      let body = "",
        size = 0;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65536) throw new Error("probe_api_response_invalid");
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      return envelope.parse(JSON.parse(body));
    },
  };
}
