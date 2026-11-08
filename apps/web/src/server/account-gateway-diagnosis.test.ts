import { expect, it } from "vitest";
import { GatewayError } from "@agent-teams/account-gateway/http";
import * as c from "@agent-teams/account-gateway/contracts";
import { diagnoseAccountGatewayFailure } from "./account-gateway-diagnosis";
import { accountDiagnosisMessage } from "../features/account-gateway/account-diagnosis";
const now = new Date("2026-11-04T22:00:00.000Z");
it("uses typed provider evidence rather than outer Gateway status or error text", () => {
  const diagnostic: c.SafeError = {
    code: "upstream_failure",
    traceRef: "fixture",
    effect: "effect_unknown",
    retry: { kind: "readback" },
    providerQuota: {
      provider: "openrouter",
      limit: 1000,
      remaining: 0,
      resetAt: "2026-11-05T00:00:00.000Z",
    },
  };
  const failure = diagnoseAccountGatewayFailure(
    new GatewayError(
      "safe_error",
      "effect_unknown",
      undefined,
      undefined,
      diagnostic,
      502,
    ),
    now,
  );
  expect(failure).toEqual({
    code: "quota_exhausted",
    source: "provider",
    httpStatus: 429,
    retryAt: "2026-11-05T00:00:00.000Z",
  });
  const nonExhausted = {
    ...diagnostic,
    providerQuota: {
      ...diagnostic.providerQuota!,
      remaining: 4,
    },
  };
  expect(
    diagnoseAccountGatewayFailure(
      new GatewayError(
        "safe_error",
        "effect_unknown",
        undefined,
        undefined,
        nonExhausted,
        502,
      ),
      now,
    ),
  ).toEqual({ code: "unavailable", source: "gateway", httpStatus: 502 });
  expect(accountDiagnosisMessage(failure)).toContain(
    "provider's quota is exhausted",
  );
  expect(accountDiagnosisMessage(failure)).toContain("2026-11-05 00:00:00 UTC");
  expect(
    diagnoseAccountGatewayFailure(
      new GatewayError(
        "invalid_response",
        "effect_unknown",
        undefined,
        undefined,
        undefined,
        502,
      ),
      now,
    ),
  ).toEqual({ code: "unavailable", source: "gateway", httpStatus: 502 });
  expect(
    diagnoseAccountGatewayFailure(
      {
        status: 429,
        message: "quota exhausted private-secret",
        providerQuota: diagnostic.providerQuota,
      },
      now,
    ),
  ).toEqual({ code: "unknown", source: "unknown" });
});
it("does not publish malformed diagnostics or unbounded retry hints", () => {
  const diagnostic: c.SafeError = {
    code: "upstream_failure",
    traceRef: "fixture",
    effect: "effect_unknown",
    retry: { kind: "readback" },
    providerQuota: {
      provider: "openrouter",
      limit: 1,
      remaining: 0,
      resetAt: "2099-01-01T00:00:00.000Z",
    },
  };
  expect(
    diagnoseAccountGatewayFailure(
      new GatewayError(
        "safe_error",
        "effect_unknown",
        undefined,
        undefined,
        diagnostic,
        502,
      ),
      now,
    ),
  ).not.toHaveProperty("retryAt");
  Reflect.set(diagnostic, "rawProviderError", "private-secret");
  expect(
    diagnoseAccountGatewayFailure(
      new GatewayError(
        "safe_error",
        "effect_unknown",
        undefined,
        undefined,
        diagnostic,
        502,
      ),
      now,
    ),
  ).toEqual({ code: "unavailable", source: "gateway", httpStatus: 502 });
  expect(
    accountDiagnosisMessage({
      code: "unknown",
      source: "unknown",
      message: "private-secret",
    }),
  ).not.toContain("private-secret");
});
