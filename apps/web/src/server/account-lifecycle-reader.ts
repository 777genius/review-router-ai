import * as c from "@agent-teams/account-gateway/contracts";
import type { LifecycleClient } from "@agent-teams/account-gateway/http";
export type AccountLifecycleRead = Omit<c.Account, "state"> & {
  state: c.Account["state"] | "suspended";
  resumeCustody?: "not_applicable" | "verified" | "attention_required";
};
/** Reader negotiation is independent of RR write activation, so closing writes
 * never makes suspended accounts look active or hides their inventory. */
export function createAccountLifecycleReader(input: {
  lifecycle: LifecycleClient;
  legacy: { get(accountRef: string): Promise<c.Account> };
}) {
  type Capability = Awaited<ReturnType<LifecycleClient["capability"]>>;
  let capability: Promise<Capability | null> | undefined;
  const discover = () =>
    (capability ??= input.lifecycle.capability().catch(() => {
      capability = undefined;
      return null;
    }));
  const compatible = async () => (await discover()) !== null;
  const writable = async () => (await discover())?.writeGate === "enabled";
  return {
    compatible,
    writable,
    async get(accountRef: string): Promise<AccountLifecycleRead> {
      return (await compatible())
        ? c.lifecycleAccount.parse(await input.lifecycle.get(accountRef))
        : c.account.parse(await input.legacy.get(accountRef));
    },
  };
}
