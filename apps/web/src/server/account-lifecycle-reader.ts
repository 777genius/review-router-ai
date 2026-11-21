import * as c from "@agent-teams/account-gateway/contracts";
import type {
  LifecycleClient,
  LifecycleV3Client,
} from "@agent-teams/account-gateway/http";
export type AccountLifecycleRead = Omit<c.Account, "state"> & {
  state: c.Account["state"] | "suspended";
  resumeCustody?: "not_applicable" | "verified" | "attention_required";
  credential?: c.CredentialAttestation | undefined;
};
/** Reader negotiation is independent of RR write activation, so closing writes
 * never makes suspended accounts look active or hides their inventory. */
export function createAccountLifecycleReader(input: {
  contract?: "account-lifecycle/v2" | "account-lifecycle/v3";
  lifecycle: LifecycleClient | LifecycleV3Client;
  legacy: { get(accountRef: string): Promise<c.Account> };
}) {
  type Capability = Awaited<
    ReturnType<(LifecycleClient | LifecycleV3Client)["capability"]>
  >;
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
      if (input.contract === "account-lifecycle/v3")
        return c.lifecycleAccountV3.parse(
          await input.lifecycle.get(accountRef),
        );
      return (await compatible())
        ? c.lifecycleAccount.parse(await input.lifecycle.get(accountRef))
        : c.account.parse(await input.legacy.get(accountRef));
    },
  };
}
