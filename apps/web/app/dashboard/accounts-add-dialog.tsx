"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, Dialog, SelectField } from "@reviewrouter/ui";
import { accountsCopy } from "./accounts-copy";

export function AccountsAddDialog({
  own,
  personalConnect,
  organizationConnect,
  workspaceName,
}: {
  own: ReactNode;
  personalConnect: ReactNode;
  organizationConnect: ReactNode;
  workspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("personal");
  const cancel = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next)
          popup.current
            ?.querySelectorAll<HTMLInputElement>(
              'input[type="password"], input[name="callbackURL"]',
            )
            .forEach((field) => {
              field.value = "";
            });
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
          className={
            path === "existing" ? "w-[min(92vw,44rem)]" : "w-[min(92vw,36rem)]"
          }
        >
          <Dialog.Title>{accountsCopy.add}</Dialog.Title>
          <Dialog.Description>
            Choose your provider and connect securely.
          </Dialog.Description>
          <div className="my-4 max-w-sm">
            <SelectField
              name="connectionOwnership"
              label="Owner"
              defaultValue="personal"
              onValueChange={(next) => {
                popup.current
                  ?.querySelectorAll<HTMLInputElement>(
                    'input[type="password"], input[name="callbackURL"]',
                  )
                  .forEach((field) => {
                    field.value = "";
                  });
                setPath(next);
              }}
              options={[
                {
                  value: "personal",
                  label: "You · personal account",
                },
                { value: "existing", label: "Use my connection" },
                {
                  value: "organization",
                  label: `${workspaceName} · organization account`,
                },
              ]}
            />
          </div>
          <div hidden={path !== "existing"}>
            <p className="mb-3 text-sm text-slate-400">
              Choose “Access” on your connection to grant {workspaceName}{" "}
              access.
            </p>
            {own}
          </div>
          <div hidden={path !== "organization"}>
            <p className="mb-4 text-sm text-slate-400">
              Managed by {workspaceName}. Review availability depends on
              workspace access and model selection.
            </p>
            {organizationConnect}
          </div>
          <div hidden={path !== "personal"}>
            <p className="mb-4 text-sm text-slate-400">
              Saved in My connections. Use workspace access to enable reviews
              here.
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
  );
}
