// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Button, Dialog, SelectField } from "@reviewrouter/ui";
import { AccountsAddDialog } from "./accounts-add-dialog";
import { AccountActionsMenu, AccountMenuItem } from "./account-actions-menu";

afterEach(cleanup);

function Connect() {
  return (
    <AccountActionsMenu
      label="Connect account"
      triggerContent="Connect account"
    >
      <Dialog.Root>
        <AccountMenuItem>
          <Dialog.Trigger render={<Button />}>
            Connect with API key
          </Dialog.Trigger>
        </AccountMenuItem>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup>
            <Dialog.Title>Connect with API key</Dialog.Title>
            <SelectField
              name="profile"
              label="Provider profile"
              defaultValue="mimo"
              options={[
                { value: "mimo", label: "MiMo" },
                { value: "openrouter", label: "OpenRouter" },
              ]}
            />
            <Dialog.Close render={<Button />}>Cancel</Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </AccountActionsMenu>
  );
}

test("keeps connection actions inside the owner modal and returns to it after the key form", async () => {
  render(
    <AccountsAddDialog
      workspaceName="Test workspace"
      own={<p>Existing connections</p>}
      personalConnect={<Connect />}
      organizationConnect={<Connect />}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  const owner = await screen.findByRole("dialog", { name: "Add account" });
  fireEvent.keyDown(
    within(owner).getByRole("button", { name: "Connect account" }),
    { key: "ArrowDown" },
  );
  const menu = await screen.findByRole("menu");
  // A body portal escapes Base UI's modal focus/inert boundary even at z70.
  expect(owner.contains(menu)).toBe(true);
  fireEvent.click(
    within(menu).getByRole("menuitem", { name: "Connect with API key" }),
  );
  const form = await screen.findByRole("dialog", {
    name: "Connect with API key",
  });
  const provider = within(form).getByRole("combobox", {
    name: "Provider profile",
  });
  fireEvent.click(provider);
  const option = await screen.findByRole("option", { name: "OpenRouter" });
  fireEvent.mouseMove(option);
  fireEvent.click(option);
  await waitFor(() => expect(provider.textContent).toContain("OpenRouter"));
  fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Connect with API key" }),
    ).toBeNull(),
  );
  expect(screen.getByRole("dialog", { name: "Add account" })).toBe(owner);
});

test("keeps standalone account actions portaled outside their trigger container", async () => {
  const view = render(<Connect />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Connect account" }), {
    key: "ArrowDown",
  });
  expect(view.container.contains(await screen.findByRole("menu"))).toBe(false);
});
