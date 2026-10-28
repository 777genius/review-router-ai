import { z } from "zod";
import * as c from "@agent-teams/account-gateway/contracts";
import { productionPersonalAccounts } from "../../../../../src/server/personal-account-composition";
import { productionAccountLifecycle } from "../../../../../src/server/account-lifecycle-composition";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const reference = z
  .string()
  .refine((value) => c.reference.safeParse(value).success);
const limit = z.number().int().min(1).max(100);
const sources = z.array(reference).min(1).max(100);
const requests = {
  lifecycle: z.union([
    z.strictObject({ workspaceId: reference, operationId: reference }),
    z.strictObject({ workspaceId: reference, nonce: z.string().uuid() }),
  ]),
  summaries: z.strictObject({ sourceIds: sources }),
  grants: z.strictObject({
    sourceId: reference,
    afterBindingId: reference.optional(),
    limit,
  }),
  organizations: z.strictObject({
    sourceIds: sources,
    afterWorkspaceId: reference.optional(),
    limit,
  }),
};
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};
const reply = (value: unknown) => Response.json(value, { headers });
/** Bounded private observations. Sharing reads only DB. Lifecycle may persist
 * exact original Gateway GET facts under CAS; it never reserves, claims, sends
 * account ingress, or delivers a fence through this GET. */
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    if (
      [...query.keys()].some(
        (key) => !["context", "view", "request"].includes(key),
      ) ||
      ["context", "view", "request"].some(
        (key) => query.getAll(key).length !== 1,
      )
    )
      return reply({ status: "invalid" });
    const context = z.string().min(1).max(256).parse(query.get("context"));
    const view = z
      .enum(["summaries", "grants", "organizations", "lifecycle"])
      .parse(query.get("view"));
    const raw = z.string().max(16384).parse(query.get("request"));
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return reply({ status: "invalid" });
    }
    const service = await productionPersonalAccounts();
    if (!service || context !== service.scope)
      return reply({ status: "denied" });
    let result: unknown;
    if (view === "lifecycle") {
      const parsed = requests.lifecycle.parse(input);
      const lifecycle = await productionAccountLifecycle(parsed.workspaceId);
      const value =
        "nonce" in parsed
          ? await lifecycle.readByNonce(parsed.nonce)
          : await lifecycle.read(parsed.workspaceId, parsed.operationId);
      result = { status: "ok", value };
    } else if (view === "summaries")
      result = await service.sharing.listAccessSummaries(
        requests.summaries.parse(input),
      );
    else if (view === "grants") {
      const parsed = requests.grants.parse(input);
      result = await service.sharing.listOwnGrants({
        sourceId: parsed.sourceId,
        limit: parsed.limit,
        ...(parsed.afterBindingId === undefined
          ? {}
          : { afterBindingId: parsed.afterBindingId }),
      });
    } else {
      const parsed = requests.organizations.parse(input);
      result = await service.sharing.listEligibleOrganizations({
        sourceIds: parsed.sourceIds,
        limit: parsed.limit,
        ...(parsed.afterWorkspaceId === undefined
          ? {}
          : { afterWorkspaceId: parsed.afterWorkspaceId }),
      });
    }
    const current = await productionPersonalAccounts();
    if (!current || current.scope !== context)
      return reply({ status: "denied" });
    return reply(result);
  } catch (error) {
    if (error instanceof z.ZodError) return reply({ status: "invalid" });
    if (
      error instanceof ProviderAccountError &&
      error.code === "workspace_forbidden"
    )
      return reply({ status: "denied" });
    return reply({ status: "unavailable" });
  }
}
