import {
  projectAccountLimits,
  type AccountLimitsSnapshot,
  type AccountLimitsView,
} from "../../domain/account-limits";
import type {
  AccountLimitsReader,
  AccountLimitsTarget,
} from "../ports/account-limits-reader";

export type AccountLimitsAuthorization = {
  readonly target: AccountLimitsTarget;
  /** Opaque host-generated scope/generation fence, safe for browser display. */
  readonly displayToken: string;
};

/** Host authorization must freshly check ownership, membership, source state and epoch. */
export async function readAccountLimits(input: {
  readonly reader: AccountLimitsReader;
  readonly authorize: () => Promise<AccountLimitsAuthorization | null>;
  readonly now: () => Date;
  readonly previous?: AccountLimitsSnapshot;
}): Promise<AccountLimitsView> {
  const before = await input.authorize();
  const context = () => {
    const now = input.now();
    return {
      now,
      fetchedAt: now.toISOString(),
      displayToken: before?.displayToken ?? "restricted",
    };
  };
  const restricted = (): AccountLimitsView => ({
    fetchedAt: input.now().toISOString(),
    displayToken: "restricted",
    refreshAvailable: false,
    status: "restricted",
    reason: "owner_only",
  });
  if (!before) return restricted();
  const result = await input.reader.read(before.target).catch(() => ({
    status: "unavailable" as const,
    reason: "source_unavailable" as const,
  }));
  const after = await input.authorize();
  if (
    !after ||
    before.displayToken !== after.displayToken ||
    before.target.ownerRef !== after.target.ownerRef ||
    before.target.accountRef !== after.target.accountRef ||
    before.target.profileId !== after.target.profileId ||
    before.target.expectedAuthorizationEpoch !==
      after.target.expectedAuthorizationEpoch
  )
    return restricted();
  if (
    result.status === "snapshot" &&
    input.previous &&
    result.physicalGeneration === input.previous.physicalGeneration &&
    result.principalVersion === input.previous.principalVersion &&
    result.revision < input.previous.revision
  ) {
    return projectAccountLimits(
      { status: "unavailable", reason: "revision_regressed" },
      context(),
    );
  }
  return projectAccountLimits(result, context());
}
