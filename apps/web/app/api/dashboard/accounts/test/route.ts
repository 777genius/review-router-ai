import { productionPersonalAccounts } from "../../../../../src/server/personal-account-composition";
import { createConnectionProbeHandler } from "../../../../../src/server/gateway-connection-probe-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
export const POST = createConnectionProbeHandler(
  productionPersonalAccounts,
  process.env.REVIEW_ROUTER_PUBLIC_WEB_URL ??
    process.env.REVIEW_ROUTER_WEB_URL ??
    process.env.NEXTAUTH_URL,
);
