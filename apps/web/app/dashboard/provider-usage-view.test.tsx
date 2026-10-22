// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProviderUsageView } from "./provider-usage-view";
import type { ProviderUsageReport } from "./provider-usage-model";
import { fetchProviderUsage } from "./provider-usage-api";
vi.mock("./provider-usage-api", async () => {
  const original = await vi.importActual<typeof import("./provider-usage-api")>(
    "./provider-usage-api",
  );
  return { ...original, fetchProviderUsage: vi.fn() };
});
afterEach(cleanup);
const report: ProviderUsageReport = {
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-21T00:00:00.000Z",
  asOf: "2026-10-21T00:00:00.000Z",
  coveredFrom: null,
  sourceLag: "unknown",
  sources: [],
  deliveryCoverage: [],
  unattributed: null,
  rows: [
    {
      id: "row",
      provider: "openai",
      model: "test-model",
      day: "2026-10-20",
      route: "direct",
      purpose: "review",
      runId: "run",
      granularity: "call",
      total: null,
      completeness: "unknown",
      cost: null,
      authority: null,
      durationMs: null,
      ttftMs: null,
    },
  ],
  attempts: 101,
  logicalRuns: 2,
  unknown: 1,
  partial: 0,
  unboundedSummaries: 0,
  hasMore: true,
  nextCursor: "row",
  groups: [],
  totals: {
    tokens: {
      inputTotal: 900,
      outputTotal: 100,
      total: 1000,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    },
    unknownTokenValues: 6,
    partialCount: 0,
    unknownCount: 1,
    providerAttempts: 101,
    logicalRuns: 2,
    reportedSummaries: 0,
    diagnosticCount: 1,
    costs: [
      { amount: "0.5", currency: "USD", basis: "estimated" },
      { amount: "0.4", currency: "EUR", basis: "source_reported" },
    ],
    unknownCostCount: 1,
  },
};
function Harness({ workspaceId = "workspace" }: { workspaceId?: string }) {
  return (
    <QueryClientProvider client={client}>
      <ProviderUsageView
        key={workspaceId}
        workspaceId={workspaceId}
        initialReport={report}
      />
    </QueryClientProvider>
  );
}
let client: QueryClient;
describe("provider usage interactive report", () => {
  it("hydrates full-window totals and keeps unknown and currency authorities visible", () => {
    client = new QueryClient();
    render(<Harness />);
    expect(screen.getByText(/101 measured attempts/)).toBeTruthy();
    expect(screen.getByText("Provider, model and UTC day totals")).toBeTruthy();
    expect(screen.getByText(/Period known token subtotal: 1,000/)).toBeTruthy();
    expect(
      screen.getByText(/0.5 USD \(estimated\).*0.4 EUR \(source_reported\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Account limits are shown in Accounts/),
    ).toBeTruthy();
    expect(
      screen.getByText(/totals cover the entire selected period/),
    ).toBeTruthy();
  });
  it("sends typed route filters through the adapter and clears foreign workspace cache", async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["provider-usage", "foreign", {}], report);
    vi.mocked(fetchProviderUsage).mockResolvedValue(report);
    const view = render(<Harness />);
    fireEvent.change(screen.getByLabelText("Usage route"), {
      target: { value: "gateway" },
    });
    await waitFor(() =>
      expect(fetchProviderUsage).toHaveBeenCalledWith(
        "workspace",
        expect.objectContaining({ route: "gateway" }),
        expect.any(AbortSignal),
      ),
    );
    expect(
      client.getQueryData(["provider-usage", "foreign", {}]),
    ).toBeUndefined();
    view.rerender(<Harness workspaceId="other" />);
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: ["provider-usage", "workspace"] }),
    ).toHaveLength(0);
  });
});
