// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { WorkspaceReviewSettings } from "@reviewrouter/features-review-config";
import {
  readRepositoryReviewSettingsForm,
  readWorkspaceReviewSettingsForm,
} from "./dashboard-action-form-readers";
import {
  clearRepositoryReviewConfigClientAction,
  saveWorkspaceReviewConfigClientAction,
} from "./actions";
import {
  RepositoryPolicyEditor,
  ReviewSettingsForm,
  WorkspaceReviewSettingsForm,
} from "./repository-policy-editor";

const routerMock = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("sonner", () => ({
  toast: { custom: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("./actions", () => ({
  clearRepositoryReviewConfigClientAction: vi.fn(),
  saveRepositoryReviewConfigClientAction: vi.fn(),
  saveWorkspaceReviewConfigClientAction: vi.fn(),
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

const settings: WorkspaceReviewSettings = {
  execution: { providerMaxParallel: 1, inlineMinAgreement: 1 },
  blockingPolicy: { failOnSeverity: "critical" },
  limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
  reviewLanguage: null,
  investigationRollout: {
    recordingEnabled: false,
    shadowEnabled: false,
    contextCriticEnabled: false,
    verifiedCleanEnabled: false,
    crossRevisionReplayEnabled: false,
    productionEffectsEnabled: false,
  },
};

const repository = {
  id: "repo_1",
  fullName: "test/disposable",
  selected: true,
  archived: false,
};

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

function pageText(): string {
  return document.body.textContent?.replace(/\s+/g, " ") ?? "";
}

function form(): HTMLFormElement {
  return document.querySelector("form")!;
}

function addOverrideField(label: string | RegExp): void {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "+ Add field to override" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

describe("review settings forms", () => {
  it("never submits a provider, so an old page cannot revert one", () => {
    render(
      <ReviewSettingsForm
        action={vi.fn()}
        settings={settings}
        providerCount={1}
        hiddenFields={[]}
        mutationsEnabled
        submitLabel="Save"
      />,
    );
    const names = [...new FormData(form()).keys()];
    expect(
      names.some(
        (name) => name.startsWith("provider") && name !== "providerMaxParallel",
      ),
    ).toBe(false);
    expect(readWorkspaceReviewSettingsForm(new FormData(form()))).toEqual({
      ...settings,
      updatePrDescription: true,
    });
    // One provider has nothing to run in parallel or agree on.
    expect(screen.queryByLabelText("Max parallel providers")).toBeNull();
  });

  it("enables PR description updates by default and persists an explicit opt-out", () => {
    render(
      <ReviewSettingsForm
        action={vi.fn()}
        settings={settings}
        providerCount={1}
        primaryAuthMode="claude_code_oauth"
        hiddenFields={[]}
        mutationsEnabled
        submitLabel="Save"
      />,
    );
    const toggle = screen.getByRole("checkbox", {
      name: "Update PR description",
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(pageText()).toContain(
      "AI PR descriptions are unavailable for this provider.",
    );
    fireEvent.click(toggle);
    expect(
      readWorkspaceReviewSettingsForm(new FormData(form())).updatePrDescription,
    ).toBe(false);
  });

  it("inherits the PR description opt-out and saves only explicit repository overrides", () => {
    render(
      <ReviewSettingsForm
        action={vi.fn()}
        settings={{ ...settings, updatePrDescription: false }}
        overrides={{}}
        providerCount={1}
        hiddenFields={[]}
        mutationsEnabled
        submitLabel="Save"
      />,
    );
    const toggle = screen.getByRole("checkbox", {
      name: "Update PR description",
    }) as HTMLInputElement;
    const saved = () => readRepositoryReviewSettingsForm(new FormData(form()));
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
    expect(saved()).toEqual({});
    addOverrideField("Update Pr Description");
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);
    expect(saved()).toEqual({ updatePrDescription: true });
    fireEvent.change(
      form().querySelector('select[name="policyMode.updatePrDescription"]')!,
      { target: { value: "inherit" } },
    );
    expect(toggle.disabled).toBe(true);
    expect(saved()).toEqual({});
  });

  it("keeps explicit zero and false overrides and removes them when reset to inherit", () => {
    render(
      <ReviewSettingsForm
        action={vi.fn()}
        settings={{
          ...settings,
          limits: { ...settings.limits, inlineMaxComments: 0 },
        }}
        overrides={{
          limits: { inlineMaxComments: 0 },
          investigationRollout: { productionEffectsEnabled: false },
        }}
        providerCount={1}
        hiddenFields={[]}
        mutationsEnabled
        submitLabel="Save"
      />,
    );
    const zeroMode = form().querySelector<HTMLSelectElement>(
      '[name="policyMode.limits.inlineMaxComments"]',
    )!;
    const falseMode = form().querySelector<HTMLSelectElement>(
      '[name="policyMode.investigationRollout.productionEffectsEnabled"]',
    )!;
    expect(readRepositoryReviewSettingsForm(new FormData(form()))).toEqual({
      limits: { inlineMaxComments: 0 },
      investigationRollout: { productionEffectsEnabled: false },
    });
    fireEvent.change(zeroMode, { target: { value: "inherit" } });
    fireEvent.change(falseMode, { target: { value: "inherit" } });
    expect(readRepositoryReviewSettingsForm(new FormData(form()))).toEqual({});
  });

  it("offers execution limits only where more than one provider runs", () => {
    const view = render(
      <ReviewSettingsForm
        action={vi.fn()}
        settings={settings}
        overrides={{}}
        providerCount={1}
        hiddenFields={[]}
        mutationsEnabled
        submitLabel="Save"
      />,
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "+ Add field to override" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Inline Min Agreement" }),
    ).toBeNull();
    view.unmount();
    render(
      <ReviewSettingsForm
        action={vi.fn()}
        settings={{
          ...settings,
          execution: { providerMaxParallel: 2, inlineMinAgreement: 2 },
        }}
        providerCount={2}
        hiddenFields={[]}
        mutationsEnabled
        submitLabel="Save"
      />,
    );
    expect(
      readWorkspaceReviewSettingsForm(new FormData(form())).execution,
    ).toEqual({ providerMaxParallel: 2, inlineMinAgreement: 2 });
  });

  it("preserves configured investigation rollout values in submissions", () => {
    const enabled = Object.fromEntries(
      Object.keys(settings.investigationRollout).map((name) => [name, true]),
    ) as WorkspaceReviewSettings["investigationRollout"];
    render(
      <ReviewSettingsForm
        action={vi.fn()}
        settings={{ ...settings, investigationRollout: enabled }}
        providerCount={1}
        hiddenFields={[]}
        mutationsEnabled
        submitLabel="Save"
      />,
    );
    expect(
      readWorkspaceReviewSettingsForm(new FormData(form()))
        .investigationRollout,
    ).toEqual(enabled);
  });

  it("requires confirmation before replacing retired settings and retains raw CAS", async () => {
    vi.mocked(clearRepositoryReviewConfigClientAction).mockResolvedValue({
      params: { notice: "repository_review_config_cleared" },
    });
    const editor = (version: number) => (
      <RepositoryPolicyEditor
        workspaceId="workspace_1"
        repository={repository}
        settings={settings}
        overrides={null}
        legacy
        expectedVersion={version}
        providerCount={1}
        mutationsEnabled
      />
    );
    const { rerender } = render(editor(11));
    fireEvent.click(screen.getByRole("button", { name: /Edit settings/ }));
    expect(
      screen.getByRole("button", { name: "Replace retired settings" }),
    ).toBeTruthy();
    expect(new FormData(form()).get("policyExpectedVersion")).toBe("11");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Replace retired settings with the workspace settings",
      }),
    );
    expect(clearRepositoryReviewConfigClientAction).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    // A refresh while this confirmation is open must not authorize a newer head.
    rerender(editor(12));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove all overrides" }),
    );
    await waitFor(() =>
      expect(clearRepositoryReviewConfigClientAction).toHaveBeenCalledOnce(),
    );
    expect(
      vi
        .mocked(clearRepositoryReviewConfigClientAction)
        .mock.calls[0]![0].get("policyExpectedVersion"),
    ).toBe("11");
  });

  it("says that removing overrides keeps the repository's provider", () => {
    render(
      <RepositoryPolicyEditor
        workspaceId="workspace_1"
        repository={repository}
        settings={settings}
        overrides={{ limits: { inlineMaxComments: 2 } }}
        legacy={false}
        expectedVersion={3}
        providerCount={1}
        mutationsEnabled
      />,
    );
    expect(pageText()).toContain("1 option overridden");
    fireEvent.click(screen.getByRole("button", { name: /Edit settings/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove all repository overrides…" }),
    );
    expect(pageText()).toContain("Its provider does not change.");
  });

  it("preserves the unsaved review language after a failed save and retries it", async () => {
    vi.mocked(saveWorkspaceReviewConfigClientAction)
      .mockResolvedValueOnce({ params: { error: "dashboard_action_stale" } })
      .mockResolvedValueOnce({ params: { notice: "review_config_saved" } });
    render(
      <WorkspaceReviewSettingsForm
        workspaceId="workspace_1"
        expectedVersion={1}
        settings={settings}
        providerCount={1}
        mutationsEnabled
      />,
    );
    const language = document.querySelector<HTMLInputElement>(
      'input[name="reviewLanguage"]',
    )!;
    fireEvent.change(language, { target: { value: "Ukrainian" } });
    const save = () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Save workspace settings" }),
      );
    save();
    await waitFor(() =>
      expect(saveWorkspaceReviewConfigClientAction).toHaveBeenCalledOnce(),
    );
    await waitFor(() =>
      expect(toast.custom).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          id: expect.stringContaining("danger|Action needs attention|"),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Save workspace settings" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(language.value).toBe("Ukrainian");
    expect(routerMock.refresh).not.toHaveBeenCalled();
    save();
    await waitFor(() =>
      expect(saveWorkspaceReviewConfigClientAction).toHaveBeenCalledTimes(2),
    );
    expect(
      vi
        .mocked(saveWorkspaceReviewConfigClientAction)
        .mock.calls[1]![0].get("reviewLanguage"),
    ).toBe("Ukrainian");
  });
});
