// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AccountUsageLine, AccountUsageWarning } from "./account-usage-line";
import type { AccountUsageView } from "../../src/server/account-usage";

afterEach(cleanup);

const usage: AccountUsageView = {
  reviews: [
    {
      targetKey: "repo:cms7gpp4600k32ip3jyd5ym27",
      repositoryName: "777genius/alpha",
    },
    {
      targetKey: "repo:cms7gpp4600k32ip3jyd5ym27",
      repositoryName: "777genius/alpha",
    },
    { targetKey: "repo:second", repositoryName: "777genius/bravo" },
    { targetKey: "repo:third", repositoryName: "777genius/charlie" },
    { targetKey: "repo:fourth", repositoryName: "777genius/delta" },
    { targetKey: "repo:fifth", repositoryName: null },
  ],
  secretRepositories: [
    { repositoryName: "777genius/alpha", secretName: "API_KEY" },
    { repositoryName: "777genius/alpha", secretName: "TOKEN" },
    { repositoryName: null, secretName: "OTHER" },
  ],
  secretLevel: "profile",
};

describe("AccountUsageLine", () => {
  it("lists unique repository names only, without internal target keys", () => {
    const { container } = render(<AccountUsageLine usage={usage} />);
    expect(
      screen.getByText(
        "Selected for reviews: 777genius/alpha, 777genius/bravo +3 more",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "CI secrets (shared across the profile): 777genius/alpha, repository unavailable",
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("repo:");
  });
});

describe("AccountUsageWarning", () => {
  it("spells out the full deduplicated repository list", () => {
    const { container } = render(<AccountUsageWarning usage={usage} />);
    expect(container.textContent).toContain(
      "Selected for reviews: 777genius/alpha, 777genius/bravo, 777genius/charlie, 777genius/delta, repository unavailable.",
    );
    expect(container.textContent).not.toContain("repo:");
    expect(container.textContent).not.toContain(" · ");
  });
});
