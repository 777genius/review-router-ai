// Public Token Plan options. Availability comes from the server's qualified
// profile binding, not from the fact that an endpoint appears in vendor docs.
// https://mimo.mi.com/docs/tokenplan/subscription
export const mimoTokenPlanEndpoints = [
  { label: "Singapore", baseURL: "https://token-plan-sgp.xiaomimimo.com/v1" },
  { label: "China", baseURL: "https://token-plan-cn.xiaomimimo.com/v1" },
  { label: "Europe", baseURL: "https://token-plan-ams.xiaomimimo.com/v1" },
] as const;

export function canonicalMimoBaseURL(value: string): string | undefined {
  const normalized = value.trim().replace(/\/$/, "");
  return mimoTokenPlanEndpoints.find(
    (endpoint) => endpoint.baseURL === normalized,
  )?.baseURL;
}

// Friendly suggestions, not unique identifiers. A visible page is deliberately
// not treated as a complete inventory; the chosen label is captured in the intent.
export function suggestedAccountLabel(
  provider: string,
  visibleLabels: readonly string[] = [],
) {
  const labels = new Set(visibleLabels);
  let number = 1;
  while (labels.has(`${provider} Account ${number}`)) number++;
  return `${provider} Account ${number}`;
}

// Source-owned console destinations, never supplied by capability payloads.
export function subscriptionKeyURL(provider: string): string | undefined {
  switch (provider) {
    case "kimi":
      return "https://www.kimi.com/code/console";
    case "glm":
      return "https://z.ai/manage-apikey/apikey-list";
    case "minimax":
      return "https://platform.minimax.io/console/plan";
    default:
      return undefined;
  }
}
