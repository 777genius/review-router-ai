"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, Dialog, SelectField } from "@reviewrouter/ui";
import { accountsCopy } from "./accounts-copy";
import {
  OwnAccountsViewContext,
  useOwnAccountsView,
} from "./accounts-workspace-tabs";

export function AccountsAddDialog({
  personalConnect,
  organizationConnect,
  workspaceName,
  initiallyOpen = false,
  initialOwnership = "personal",
}: {
  personalConnect: ReactNode;
  organizationConnect: ReactNode;
  workspaceName: string;
  initiallyOpen?: boolean;
  initialOwnership?: "personal" | "organization";
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [path, setPath] = useState(initialOwnership);
  const cancel = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const showOwnConnections = useOwnAccountsView();
  function clearUnsubmittedCredentials() {
    popup.current
      ?.querySelectorAll<HTMLInputElement>(
        'input[type="password"], input[name="callbackURL"], input[name="authorizationCode"]',
      )
      .forEach((field) => {
        field.value = "";
      });
  }
  function showOwnConnectionsFromDialog() {
    clearUnsubmittedCredentials();
    setOpen(false);
    showOwnConnections?.();
  }
  return (
    <OwnAccountsViewContext.Provider
      value={showOwnConnections ? showOwnConnectionsFromDialog : null}
    >
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) clearUnsubmittedCredentials();
          setOpen(next);
        }}
      >
        <Dialog.Trigger render={<Button variant="outline" />}>
          {accountsCopy.add}
        </Dialog.Trigger>
        <Dialog.Portal keepMounted>
          <Dialog.Backdrop />
          <Dialog.Popup
            ref={popup}
            initialFocus={cancel}
            className="w-[min(92vw,36rem)]"
          >
            <Dialog.Title>{accountsCopy.add}</Dialog.Title>
            <Dialog.Description>
              Choose your provider and connect securely.
            </Dialog.Description>
            {showOwnConnections ? (
              <Button
                variant="ghost"
                className="mt-3"
                onClick={showOwnConnectionsFromDialog}
              >
                Use an existing connection
              </Button>
            ) : null}
            <div className="my-4 max-w-sm">
              <SelectField
                name="connectionOwnership"
                label="Owner"
                value={path}
                onValueChange={(next) => {
                  clearUnsubmittedCredentials();
                  if (next === "personal" || next === "organization")
                    setPath(next);
                }}
                options={[
                  {
                    value: "personal",
                    label: "You · personal account",
                  },
                  {
                    value: "organization",
                    label: `${workspaceName} · organization account`,
                  },
                ]}
              />
            </div>
            <div hidden={path !== "organization"}>
              <p className="mb-4 text-sm text-slate-400">
                Owned by {workspaceName}. Workspace admins manage this
                connection.
              </p>
              {organizationConnect}
            </div>
            <div hidden={path !== "personal"}>
              <p className="mb-4 text-sm text-slate-400">
                You own this connection. After connecting, choose Access to
                enable it for {workspaceName}.
              </p>
              {personalConnect}
            </div>
            <Dialog.Footer>
              <Dialog.Close render={<Button ref={cancel} variant="outline" />}>
                Close
              </Dialog.Close>
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </OwnAccountsViewContext.Provider>
  );
}
