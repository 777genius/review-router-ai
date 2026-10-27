// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  RepositorySetupDisclosureToggle,
  RepositorySetupReadyGate,
  RepositorySetupRowDisclosureController,
} from "./repository-setup-optimistic-status";
import {
  providerSetupConfirmedEvent,
  providerSetupConfirmedEventName,
  setupPullRequestMergedEvent,
} from "./repository-setup-optimistic-events";

afterEach(() => {
  cleanup();
});

describe("RepositorySetupDisclosureToggle", () => {
  it.each(["unknown", "update_required"] as const)(
    "does not turn %s runtime support into Ready after a provider confirmation",
    async (runtimeCompatibility) => {
      render(
        <>
          <RepositorySetupDisclosureToggle
            repositoryId="repo_1"
            disclosureId="setup_repo_1"
            currentStep="setup_pr"
            runtimeCompatibility={runtimeCompatibility}
            expectedProviderAuthModes={["openrouter_api_key"]}
          />
          <RepositorySetupReadyGate
            repositoryId="repo_1"
            currentStep="setup_pr"
            runtimeCompatibility={runtimeCompatibility}
            expectedProviderAuthModes={["openrouter_api_key"]}
          >
            <div>Configured policy editor</div>
          </RepositorySetupReadyGate>
        </>,
      );
      window.dispatchEvent(
        setupPullRequestMergedEvent({
          repositoryId: "repo_1",
        }),
      );
      window.dispatchEvent(
        providerSetupConfirmedEvent({
          repositoryId: "repo_1",
          repositoryFullName: "acme/repo",
          providerKind: "openrouter",
          authMode: "openrouter_api_key",
        }),
      );
      await waitFor(() => expect(screen.getByText("1/4")).toBeTruthy());
      expect(screen.queryByText("Configured policy editor")).toBeNull();
    },
  );
  it.each([
    ["openrouter_api_key", "setup_pr", "1/4"],
    ["openrouter_api_key", "merge_setup_pr", "2/4"],
    ["claude_code_oauth", "setup_pr", "1/4"],
    ["claude_code_oauth", "merge_setup_pr", "2/4"],
  ] as const)(
    "keeps the pill and settings gated for %s at %s until workflow merge",
    (authMode, step, progress) => {
      const view = () => (
        <>
          <RepositorySetupDisclosureToggle
            repositoryId="repo_1"
            disclosureId="setup_repo_1"
            currentStep={step}
            expectedProviderAuthModes={[authMode]}
          />
          <RepositorySetupReadyGate
            repositoryId="repo_1"
            currentStep={step}
            expectedProviderAuthModes={[authMode]}
          >
            <button type="button">Edit settings</button>
          </RepositorySetupReadyGate>
        </>
      );
      const confirmed = () =>
        providerSetupConfirmedEvent({
          repositoryId: "repo_1",
          repositoryFullName: "777genius/example",
          authMode,
        });
      const rendered = render(view());

      fireEvent(window, confirmed());
      expect(screen.getByText(progress)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Edit settings" }),
      ).toBeNull();

      // Refreshing with the same authoritative workflow step must stay pending.
      rendered.rerender(view());
      expect(screen.getByText(progress)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Edit settings" }),
      ).toBeNull();

      // Both events can arrive before React renders or the server props refresh.
      act(() => {
        window.dispatchEvent(
          setupPullRequestMergedEvent({ repositoryId: "repo_1" }),
        );
        window.dispatchEvent(confirmed());
      });
      expect(screen.getByText("4/4")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Edit settings" }),
      ).toBeTruthy();
    },
  );

  it("requires current Gateway authority readiness despite a provider confirmation event", async () => {
    const view = (ready: boolean) => (
      <>
        <RepositorySetupDisclosureToggle
          repositoryId="repo_1"
          disclosureId="setup_repo_1"
          currentStep={ready ? "ready" : "provider"}
          expectedProviderAuthModes={["codex_account_gateway"]}
          gatewayReviewV2Ready={ready}
        />
        <RepositorySetupReadyGate
          repositoryId="repo_1"
          currentStep={ready ? "ready" : "provider"}
          expectedProviderAuthModes={["codex_account_gateway"]}
          gatewayReviewV2Ready={ready}
        >
          <div>Configured policy editor</div>
        </RepositorySetupReadyGate>
      </>
    );
    const rendered = render(view(false));
    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
        providerKind: "codex",
        authMode: "codex_account_gateway",
      }),
    );
    await waitFor(() => expect(screen.getByText("3/4")).toBeTruthy());
    expect(screen.queryByText("Configured policy editor")).toBeNull();
    rendered.rerender(view(true));
    await waitFor(() => expect(screen.getByText("4/4")).toBeTruthy());
    expect(screen.getByText("Configured policy editor")).toBeTruthy();
  });
  it("updates to complete when provider setup is confirmed for the repository", async () => {
    render(
      <RepositorySetupDisclosureToggle
        repositoryId="repo_1"
        disclosureId="setup_repo_1"
        currentStep="provider"
      />,
    );

    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("4/4")).toBeTruthy();
    });
  });

  it("ignores malformed provider setup events", () => {
    render(
      <RepositorySetupDisclosureToggle
        repositoryId="repo_1"
        disclosureId="setup_repo_1"
        currentStep="provider"
      />,
    );

    window.dispatchEvent(new Event(providerSetupConfirmedEventName));

    expect(screen.getByText("3/4")).toBeTruthy();
  });

  it("updates to provider setup when setup PR merge is confirmed", async () => {
    render(
      <RepositorySetupDisclosureToggle
        repositoryId="repo_1"
        disclosureId="setup_repo_1"
        currentStep="merge_setup_pr"
      />,
    );

    window.dispatchEvent(
      setupPullRequestMergedEvent({ repositoryId: "repo_1" }),
    );

    await waitFor(() => {
      expect(screen.getByText("3/4")).toBeTruthy();
    });
  });
});

describe("RepositorySetupReadyGate", () => {
  it("shows ready-only children when provider setup is confirmed", async () => {
    render(
      <RepositorySetupReadyGate repositoryId="repo_1" currentStep="provider">
        <button type="button">Edit settings</button>
      </RepositorySetupReadyGate>,
    );

    expect(screen.queryByRole("button", { name: "Edit settings" })).toBeNull();

    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Edit settings" }),
      ).toBeTruthy();
    });
  });

  it("ignores provider setup confirmations that do not match effective auth", () => {
    render(
      <RepositorySetupReadyGate
        repositoryId="repo_1"
        currentStep="provider"
        expectedProviderAuthModes={["codex_subscription_oauth_rotating"]}
      >
        <button type="button">Edit settings</button>
      </RepositorySetupReadyGate>,
    );

    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
        providerKind: "openrouter",
        authMode: "openrouter_api_key",
      }),
    );

    expect(screen.queryByRole("button", { name: "Edit settings" })).toBeNull();
  });

  it("does not complete multi-auth setup after a single provider confirmation", () => {
    render(
      <RepositorySetupReadyGate
        repositoryId="repo_1"
        currentStep="provider"
        expectedProviderAuthModes={["openrouter_api_key", "claude_code_oauth"]}
      >
        <button type="button">Edit settings</button>
      </RepositorySetupReadyGate>,
    );

    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
        providerKind: "openrouter",
        authMode: "openrouter_api_key",
      }),
    );

    expect(screen.queryByRole("button", { name: "Edit settings" })).toBeNull();
  });

  it("completes multi-auth setup after all expected provider confirmations", async () => {
    render(
      <RepositorySetupReadyGate
        repositoryId="repo_1"
        currentStep="provider"
        expectedProviderAuthModes={["openrouter_api_key", "claude_code_oauth"]}
      >
        <button type="button">Edit settings</button>
      </RepositorySetupReadyGate>,
    );

    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
        providerKind: "openrouter",
        authMode: "openrouter_api_key",
      }),
    );
    expect(screen.queryByRole("button", { name: "Edit settings" })).toBeNull();

    window.dispatchEvent(
      providerSetupConfirmedEvent({
        repositoryId: "repo_1",
        repositoryFullName: "777genius/example",
        providerKind: "claude",
        authMode: "claude_code_oauth",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Edit settings" }),
      ).toBeTruthy();
    });
  });
});

describe("RepositorySetupRowDisclosureController", () => {
  it("toggles setup details when the repository row is clicked", () => {
    render(
      <>
        <RepositorySetupRowDisclosureController />
        <div data-repository-setup-row data-disclosure-id="setup_repo_1">
          <input id="setup_repo_1" type="checkbox" />
          <span>Repository row</span>
        </div>
      </>,
    );

    fireEvent.click(screen.getByText("Repository row"));

    expect(
      (document.getElementById("setup_repo_1") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("keeps nested links from toggling setup details", () => {
    render(
      <>
        <RepositorySetupRowDisclosureController />
        <div data-repository-setup-row data-disclosure-id="setup_repo_1">
          <input id="setup_repo_1" type="checkbox" />
          <a href="https://github.com/777genius/example">Repository link</a>
        </div>
      </>,
    );

    const link = screen.getByRole("link", { name: "Repository link" });
    link.addEventListener("click", (event) => event.preventDefault());

    fireEvent.click(link);

    expect(
      (document.getElementById("setup_repo_1") as HTMLInputElement).checked,
    ).toBe(false);
  });
});
