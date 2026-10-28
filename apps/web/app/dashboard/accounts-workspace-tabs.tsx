"use client";

import { Tabs } from "@base-ui/react/tabs";
import { createContext, useContext, useState, type ReactNode } from "react";
import { accountsCopy } from "./accounts-copy";
import { GitHubAccountAvatar } from "../github-account-avatar";
export const OwnAccountsViewContext = createContext<(() => void) | null>(null);
export const useOwnAccountsView = () => useContext(OwnAccountsViewContext);

export function AccountsWorkspaceTabs({
  available,
  own,
  viewer,
  initialView = "available",
}: {
  readonly available: ReactNode;
  readonly own: ReactNode;
  readonly viewer?: Readonly<{
    login: string | null;
    avatarUrl: string | null;
  }>;
  readonly initialView?: "available" | "own";
}): React.ReactElement {
  const [view, setView] = useState(initialView);
  return (
    <OwnAccountsViewContext.Provider value={() => setView("own")}>
      <Tabs.Root value={view} onValueChange={setView}>
        <Tabs.List
          aria-label="Connection scope"
          className="flex gap-1 overflow-x-auto border-b border-white/[0.10]"
        >
          <AccountsWorkspaceTab value="available">
            {accountsCopy.available}
          </AccountsWorkspaceTab>
          <AccountsWorkspaceTab value="own">
            <span className="inline-flex items-center gap-2">
              {viewer?.login ? (
                <GitHubAccountAvatar
                  login={viewer.login}
                  avatarUrl={viewer.avatarUrl}
                  size="sm"
                  altText=""
                />
              ) : null}
              {viewer?.login
                ? `All ${viewer.login} connections`
                : accountsCopy.own}
            </span>
          </AccountsWorkspaceTab>
        </Tabs.List>
        <Tabs.Panel value="available" className="pt-5">
          <p className="mb-4 text-sm text-slate-400">
            {accountsCopy.availableDescription}{" "}
            <button
              type="button"
              className="text-cyan-200 underline underline-offset-2"
              onClick={() => setView("own")}
            >
              Use one of my connections
            </button>
          </p>
          {available}
        </Tabs.Panel>
        <Tabs.Panel value="own" className="pt-5">
          <p className="mb-4 text-sm text-slate-400">
            {accountsCopy.ownDescription}
          </p>
          {own}
        </Tabs.Panel>
      </Tabs.Root>
    </OwnAccountsViewContext.Provider>
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
          "-mb-px min-h-11 shrink-0 border-b-2 px-3 pb-2 pt-1.5 text-sm font-semibold transition-colors",
          active
            ? "border-cyan-300/80 text-cyan-50"
            : "border-transparent text-slate-200 hover:border-white/30 hover:text-cyan-50",
        ].join(" ")
      }
    >
      {children}
    </Tabs.Tab>
  );
}
