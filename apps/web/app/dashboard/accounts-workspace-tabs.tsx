"use client";

import { Tabs } from "@base-ui/react/tabs";
import { createContext, useContext, useState, type ReactNode } from "react";
const OwnAccountsView = createContext<(() => void) | null>(null);
export const useOwnAccountsView = () => useContext(OwnAccountsView);

export function AccountsWorkspaceTabs({
  available,
  own,
}: {
  readonly available: ReactNode;
  readonly own: ReactNode;
}): React.ReactElement {
  const [view, setView] = useState("available");
  return (
    <OwnAccountsView.Provider value={() => setView("own")}>
      <Tabs.Root value={view} onValueChange={setView}>
        <Tabs.List
          aria-label="Разделы подключений"
          className="flex gap-4 overflow-x-auto border-b border-cyan-200/15"
        >
          <AccountsWorkspaceTab value="available">
            Доступные в этом workspace
          </AccountsWorkspaceTab>
          <AccountsWorkspaceTab value="own">
            Мои подключения
          </AccountsWorkspaceTab>
        </Tabs.List>
        <Tabs.Panel value="available" className="pt-5">
          {available}
        </Tabs.Panel>
        <Tabs.Panel value="own" className="pt-5">
          {own}
        </Tabs.Panel>
      </Tabs.Root>
    </OwnAccountsView.Provider>
  );
}

function AccountsWorkspaceTab({
  value,
  children,
}: {
  readonly value: string;
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <Tabs.Tab
      value={value}
      className={({ active }) =>
        [
          "min-h-11 shrink-0 border-b-2 px-1 py-3 text-sm font-semibold",
          active
            ? "border-cyan-200 text-cyan-50"
            : "border-transparent text-slate-300 hover:text-cyan-50",
        ].join(" ")
      }
    >
      {children}
    </Tabs.Tab>
  );
}
