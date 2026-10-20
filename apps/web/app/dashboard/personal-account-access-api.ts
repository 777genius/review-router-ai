"use client";

import type {
  PersonalAccountsApi,
  PersonalAccountsResult,
  PersonalAccessSummaryPage,
  OwnAccountGrantPage,
  PersonalOrganizationPage,
} from "../../src/features/account-gateway/personal-accounts";

// Opening Access reads current authority through GET. Keep mutations and original
// operation readback on their existing adapters; no intent is created here.
export function personalAccountAccessReads(
  context: string,
): Pick<
  PersonalAccountsApi,
  "listAccessSummaries" | "listOwnGrants" | "listEligibleOrganizations"
> {
  async function read<T>(
    view: string,
    request: unknown,
  ): Promise<PersonalAccountsResult<T>> {
    try {
      const query = new URLSearchParams({
        context,
        view,
        request: JSON.stringify(request),
      });
      const response = await fetch(`/api/dashboard/accounts/access?${query}`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return { status: "unavailable" };
      const result = (await response.json()) as PersonalAccountsResult<T>;
      if (
        !["ok", "denied", "conflict", "invalid", "unavailable"].includes(
          result?.status,
        )
      )
        return { status: "unavailable" };
      return result;
    } catch {
      return { status: "unavailable" };
    }
  }
  return {
    listAccessSummaries: (request) =>
      read<PersonalAccessSummaryPage>("summaries", request),
    listOwnGrants: (request) => read<OwnAccountGrantPage>("grants", request),
    listEligibleOrganizations: (request) =>
      read<PersonalOrganizationPage>("organizations", request),
  };
}
