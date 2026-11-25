import { LOOPBACK_HOSTNAMES } from "./contracts.ts";

/** Compile fixture routes without reading accounts or changing their state. */
export async function warmAccountsRoutes(
  appUrl: string | undefined,
): Promise<readonly string[]> {
  if (!appUrl)
    throw new Error("accounts_reference_e2e_route_warmup_app_url_missing");
  const origin = new URL(appUrl);
  if (
    origin.protocol !== "http:" ||
    !LOOPBACK_HOSTNAMES.has(origin.hostname) ||
    origin.username ||
    origin.password
  )
    throw new Error("accounts_reference_e2e_route_warmup_requires_loopback");
  const signal = AbortSignal.timeout(120_000);
  const checks: string[] = [];
  for (const route of ["access", "limits"] as const) {
    const response = await fetch(
      new URL(`/api/dashboard/accounts/${route}`, origin),
      { redirect: "error", signal },
    );
    const result: unknown = await response.json();
    if (
      response.status !== 200 ||
      JSON.stringify(result) !== '{"status":"invalid"}'
    )
      throw new Error(`accounts_reference_e2e_${route}_route_warmup_failed`);
    checks.push(`accounts-${route}-route-warmed`);
  }
  return checks;
}
