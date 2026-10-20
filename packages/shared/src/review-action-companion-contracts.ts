/** Bearer-authorized read-only companion, outside the V2 command envelope. */
export const providerApiCheckoutCompanionContract = Object.freeze({
  path: "/api/action/v2/provider-api/checkout",
  providerApiAuthMode: "openrouter-api",
  workflowSchemaVersion: 2,
} as const);
