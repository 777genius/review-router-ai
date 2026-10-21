// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  RepositoryActionSelectionProvider,
  useRepositoryActionSelection,
} from "./gateway-repository-batch-controls";
import {
  RepositorySelectionToolbar,
  useRepositorySelection,
} from "./repository-action-selection";
afterEach(cleanup);
function Probe({ matching }: { readonly matching: readonly string[] }) {
  const neutral = useRepositorySelection()!;
  const gateway = useRepositoryActionSelection()!;
  return (
    <>
      <RepositorySelectionToolbar matchingIds={matching} />
      <output aria-label="Selected IDs">{neutral.ids.join(",")}</output>
      <output aria-label="Gateway versions">
        {gateway.selected
          .map((item) => `${item.repositoryId}:${item.expectedVersion}`)
          .join(",")}
      </output>
      <button onClick={() => neutral.toggle("repo-1")}>Toggle first</button>
      <button onClick={() => gateway.toggle(gateway.inventory[124]!)}>
        Gateway toggle last
      </button>
    </>
  );
}
it("captures all 125 matching IDs without a Gateway cap, preserves hidden IDs and selected CAS versions across refresh", () => {
  const ids = Array.from({ length: 125 }, (_, index) => `repo-${index + 1}`);
  const inventory = ids.map((repositoryId) => ({
    repositoryId,
    fullName: repositoryId,
    eligible: true,
    expectedVersion: 1,
  }));
  const view = (version: number, matching = ids) => (
    <RepositoryActionSelectionProvider
      workspaceId="workspace"
      inventory={inventory.map((item) => ({
        ...item,
        expectedVersion: version,
      }))}
    >
      <Probe matching={matching} />
    </RepositoryActionSelectionProvider>
  );
  const mounted = render(view(1));
  fireEvent.click(
    screen.getByRole("button", { name: "Select all 125 matching" }),
  );
  expect(
    screen.getByLabelText("Selected IDs").textContent?.split(","),
  ).toHaveLength(125);
  expect(screen.getByLabelText("Gateway versions").textContent).toContain(
    "repo-1:1",
  );
  mounted.rerender(view(2, ["repo-125"]));
  expect(
    screen.getByText("125 selected · 124 outside current search"),
  ).toBeTruthy();
  expect(screen.getByLabelText("Gateway versions").textContent).toContain(
    "repo-1:1",
  );
  fireEvent.click(screen.getByRole("button", { name: "Toggle first" }));
  fireEvent.click(screen.getByRole("button", { name: "Toggle first" }));
  expect(screen.getByLabelText("Gateway versions").textContent).toContain(
    "repo-1:2",
  );
});
it("keeps selected IDs when inventory becomes unavailable and only clears on explicit intent or workspace change", () => {
  const inventory = [
    {
      repositoryId: "repo-1",
      fullName: "one",
      eligible: true,
      expectedVersion: 1,
    },
    ...Array.from({ length: 124 }, (_, index) => ({
      repositoryId: `repo-${index + 2}`,
      fullName: "other",
      eligible: true,
      expectedVersion: 1,
    })),
  ];
  const view = (workspaceId: string, eligible: boolean) => (
    <RepositoryActionSelectionProvider
      workspaceId={workspaceId}
      inventory={inventory.map((item) => ({ ...item, eligible }))}
    >
      <Probe matching={["repo-1"]} />
    </RepositoryActionSelectionProvider>
  );
  const mounted = render(view("a", true));
  fireEvent.click(
    screen.getByRole("button", { name: "Select all 1 matching" }),
  );
  mounted.rerender(view("a", false));
  expect(screen.getByLabelText("Selected IDs").textContent).toBe("repo-1");
  mounted.rerender(view("b", true));
  expect(screen.getByLabelText("Selected IDs").textContent).toBe("");
});
