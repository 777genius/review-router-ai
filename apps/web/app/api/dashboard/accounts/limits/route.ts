import { z } from "zod";
import * as c from "@agent-teams/account-gateway/contracts";
import { productionPersonalAccounts } from "../../../../../src/server/personal-account-composition";
import { accountsServerAdapter } from "../../../../../src/server/account-gateway-accounts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};
const reply = (value: unknown) => Response.json(value, { headers });
const querySchema = z.strictObject({
  context: z.string().min(1).max(2048),
  connectionId: z
    .string()
    .refine((value) => c.reference.safeParse(value).success),
  workspaceId: z
    .string()
    .refine((value) => c.reference.safeParse(value).success)
    .optional(),
});
/** Reads the stored native snapshot only. Browser IDs never select a remote owner. */
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => query.getAll(key).length !== 1))
      return reply({ status: "invalid" });
    const input = querySchema.parse(Object.fromEntries(query));
    if (input.context.startsWith("personal-")) {
      const service = await productionPersonalAccounts();
      if (!service || service.scope !== input.context)
        return reply({ status: "denied" });
      const result = await service
        .limits(input.workspaceId, !!input.workspaceId)
        .read(input.connectionId);
      const current = await productionPersonalAccounts();
      return reply(
        current?.scope === input.context ? result : { status: "denied" },
      );
    }
    // The signed dashboard context already binds its workspace. An extra selector
    // would create two competing authorities and is rejected on this path.
    if (input.workspaceId) return reply({ status: "invalid" });
    return reply(
      await (
        await accountsServerAdapter()
      ).limits(input.context, input.connectionId),
    );
  } catch (error) {
    return reply({
      status: error instanceof z.ZodError ? "invalid" : "denied",
    });
  }
}
