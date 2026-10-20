"use client";

import { Tabs } from "@base-ui/react/tabs";
import { createContext, useContext, useState, type ReactNode } from "react";
import { accountsCopy } from "./accounts-copy";
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
          aria-label="Connection views"
          className="flex gap-2 overflow-x-auto"
        >
          <AccountsWorkspaceTab value="available">
            {accountsCopy.available}
          </AccountsWorkspaceTab>
          <AccountsWorkspaceTab value="own">
            {accountsCopy.own}
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
          "min-h-11 shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors",
          active
            ? "border-cyan-200/50 bg-cyan-200/[0.13] text-cyan-50"
            : "border-white/[0.09] bg-white/[0.05] text-slate-200 hover:border-cyan-200/35 hover:bg-white/[0.09] hover:text-cyan-50",
        ].join(" ")
      }
    >
      {children}
    </Tabs.Tab>
  );
}
