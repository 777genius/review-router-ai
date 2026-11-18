import { expect, test } from "vitest";
import type {
  AccountsPage,
  AccountsResult,
  AccountView,
} from "../../src/server/account-gateway-accounts";
import {
  ownConnectionWorkspaceUse,
  overviewOwnRows,
} from "./account-workspace-use";

const row = (
  sourceId: string | undefined,
  fencePending = false,
): AccountView => ({
  connectionId: `binding-${sourceId ?? "other"}`,
  ...(sourceId ? { sourceId } : {}),
  label: "Connection",
  profileId: "codex",
  profileLabel: "Codex",
  state: "active",
  gatewayRevision: 1,
  mirrorRevision: 1,
  binding: { id: "binding", revision: 1, state: "active", fencePending },
});
const ok = (
  accounts: AccountView[],
  nextCursor: string | null = null,
): AccountsResult<AccountsPage> => ({
  status: "ok",
  value: { accounts, profiles: [], nextCursor },
});
const overview = (...pages: AccountsResult<AccountsPage>[]) =>
  overviewOwnRows({ pages, pageParams: pages.map(() => null) });

test.each([
  {
    name: "a listed own connection is used",
    input: overview(ok([row("mine"), row(undefined)])),
    expected: "used",
  },
  {
    // Update key and Reconnect leave the binding active while it waits for a
    // fence; it is still used here.
    name: "a binding waiting for a fence is still used",
    input: overview(ok([row("mine", true)])),
    expected: "used",
  },
  {
    name: "a fully loaded overview without the connection is not added",
    input: overview(ok([row("someone-else-owned")])),
    expected: "not_added",
  },
  {
    name: "a further page keeps the state unknown",
    input: overview(ok([], "next")),
    expected: "unknown",
  },
  {
    name: "a failed page keeps the state unknown",
    input: overview(ok([]), { status: "unavailable" }),
    expected: "unknown",
  },
  {
    name: "a listed connection stays used even beside a failed page",
    input: overview(ok([row("mine")]), { status: "unavailable" }),
    expected: "used",
  },
  { name: "no overview yet is unknown", input: null, expected: "unknown" },
  {
    // The owner's summary names this workspace although the overview cannot
    // use the binding: never claim "not added" and offer to add it again.
    name: "a binding the overview leaves out makes no claim",
    input: overview(ok([])),
    namedInAccessSummary: true,
    expected: "unknown",
  },
  {
    name: "an access summary still loading or failed makes no claim",
    input: overview(ok([])),
    namedInAccessSummary: undefined,
    expected: "unknown",
  },
])("$name", (testCase) => {
  const named =
    "namedInAccessSummary" in testCase ? testCase.namedInAccessSummary : false;
  expect(ownConnectionWorkspaceUse("mine", testCase.input, named)).toBe(
    testCase.expected,
  );
});
