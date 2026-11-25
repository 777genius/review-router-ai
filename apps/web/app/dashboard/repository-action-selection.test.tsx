// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  RepositorySelectionProvider,
  RepositorySelectionToolbar,
  useRepositorySelection,
  type RepositorySelectionItem,
} from "./repository-action-selection";
afterEach(cleanup);
function Probe({ matching }: { readonly matching: readonly string[] }) {
  const selection = useRepositorySelection()!;
  return (
    <>
      <RepositorySelectionToolbar matchingIds={matching} />
      <output aria-label="Selected IDs">{selection.ids.join(",")}</output>
      <button onClick={() => selection.toggle("repo-1")}>Toggle first</button>
    </>
  );
}
const inventoryOf = (
  available: boolean,
  count = 125,
): readonly RepositorySelectionItem[] =>
  Array.from({ length: count }, (_, index) => ({
    repositoryId: `repo-${index + 1}`,
    fullName: `acme/repo-${index + 1}`,
    available,
  }));
it("captures all 125 matching IDs without an action cap and preserves hidden IDs across refresh", () => {
  const ids = inventoryOf(true).map((item) => item.repositoryId);
  const view = (matching = ids) => (
    <RepositorySelectionProvider
      workspaceId="workspace"
      inventory={inventoryOf(true)}
    >
      <Probe matching={matching} />
    </RepositorySelectionProvider>
  );
  const mounted = render(view());
  fireEvent.click(
    screen.getByRole("button", { name: "Select all 125 matching" }),
  );
  expect(
    screen.getByLabelText("Selected IDs").textContent?.split(","),
  ).toHaveLength(125);
  mounted.rerender(view(["repo-125"]));
  expect(
    screen.getByText("125 selected · 124 outside current search"),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Toggle first" }));
  expect(
    screen.getByLabelText("Selected IDs").textContent?.split(","),
  ).toHaveLength(124);
});
it("keeps selected IDs when inventory becomes unavailable and only clears on explicit intent or workspace change", () => {
  const view = (workspaceId: string, available: boolean) => (
    <RepositorySelectionProvider
      workspaceId={workspaceId}
      inventory={inventoryOf(available)}
    >
      <Probe matching={["repo-1"]} />
    </RepositorySelectionProvider>
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
it("drops repositories that left the inventory from the selection and its count", () => {
  const view = (count: number) => (
    <RepositorySelectionProvider
      workspaceId="workspace"
      inventory={inventoryOf(true, count)}
    >
      <Probe
        matching={inventoryOf(true, count).map((item) => item.repositoryId)}
      />
    </RepositorySelectionProvider>
  );
  const mounted = render(view(3));
  fireEvent.click(
    screen.getByRole("button", { name: "Select all 3 matching" }),
  );
  expect(screen.getByText("3 selected")).toBeTruthy();
  mounted.rerender(view(2));
  expect(screen.getByLabelText("Selected IDs").textContent).toBe(
    "repo-1,repo-2",
  );
  expect(screen.getByText("2 selected")).toBeTruthy();
  mounted.rerender(view(3));
  expect(screen.getByLabelText("Selected IDs").textContent).toBe(
    "repo-1,repo-2",
  );
});
