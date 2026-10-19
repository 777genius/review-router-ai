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
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setPath("personal");
      }}
    >
      <Dialog.Trigger render={<Button variant="outline" />}>
        {accountsCopy.add}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup initialFocus={cancel} className="w-[min(92vw,44rem)]">
          <Dialog.Title>{accountsCopy.add}</Dialog.Title>
          <Dialog.Description>
            Выберите подключение и его владельца. Доступ организации не передаёт
            владение и не меняет выбор в Models.
          </Dialog.Description>
          <div className="my-4">
            <SelectField
              name="connectionOwnership"
              label="Способ добавления"
              defaultValue="personal"
              onValueChange={setPath}
              options={[
                {
                  value: "personal",
                  label: "Подключить новое · личное, принадлежит вам",
                },
                { value: "existing", label: "Использовать мое подключение" },
                {
                  value: "organization",
                  label: `Подключить новое · принадлежит ${workspaceName}`,
                },
              ]}
            />
          </div>
          {path === "existing" ? (
            <>
              <p className="mb-3 text-sm text-slate-400">
                Нажмите «Доступ» в строке подключения и добавьте {workspaceName}
                . Уже выданный доступ показан отдельно.
              </p>
              {own}
            </>
          ) : path === "organization" ? (
            <>
              <p className="mb-3 text-sm">
                Владелец — {workspaceName}. Подключением управляют
                администраторы организации.
              </p>
              {organizationConnect}
            </>
          ) : (
            <>
              <p className="mb-3 text-sm">
                Владелец — вы. Затем выдайте организации доступ через «Доступ».
                Создание подключения и выдача доступа — разные действия.
              </p>
              {personalConnect}
            </>
          )}
          <Dialog.Footer>
            <Button
              ref={cancel}
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Закрыть
            </Button>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
