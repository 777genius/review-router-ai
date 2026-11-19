"use server";

import { z } from "zod";
import { reference } from "@agent-teams/account-gateway/contracts";
import type {
  AccountLimitsView,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";

const requestSchema = z.strictObject({
  context: z.string().min(1).max(2048),
  connectionId: reference,
  workspaceId: reference.optional(),
});
/** Next Server Action supplies the same-origin CSRF boundary for this effect. */
export async function refreshAccountLimitsAction(request: {
  context: string;
  connectionId: string;
  workspaceId?: string;
}): Promise<AccountsResult<AccountLimitsView>> {
  try {
    const input = requestSchema.parse(request);
    if (input.context.startsWith("personal-")) {
      const { productionPersonalAccounts } =
        await import("../../src/server/personal-account-composition");
      const service = await productionPersonalAccounts();
      if (!service || service.scope !== input.context)
        return { status: "denied" };
      const result = await service
        .limits(input.workspaceId, !!input.workspaceId)
        .refresh(input.connectionId);
      const current = await productionPersonalAccounts();
      return current?.scope === input.context ? result : { status: "denied" };
    }
    // The signed context itself binds its workspace, without a second selector.
    if (input.workspaceId)
      return {
        status: "invalid",
        diagnosis: { code: "invalid_request", source: "application" },
      };
    const { accountsServerAdapter } =
      await import("../../src/server/account-gateway-accounts");
    return await (
      await accountsServerAdapter()
    ).refreshLimits(input.context, input.connectionId);
  } catch (error) {
    return error instanceof z.ZodError
      ? {
          status: "invalid",
          diagnosis: { code: "invalid_request", source: "application" },
        }
      : { status: "denied" };
  }
}
