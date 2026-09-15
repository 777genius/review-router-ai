import type { Metadata } from "next";
import { createNoIndexPageMetadata } from "../../seo";
import { DashboardWorkspacePage } from "../dashboard-workspace-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createNoIndexPageMetadata({
  title: "Setup",
  description:
    "Private ReviewRouter setup for GitHub App connection, installation access, and hosted Codex sessions.",
});

export default async function DashboardSetupPage({
  searchParams,
}: {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}): Promise<React.ReactElement> {
  return (
    <DashboardWorkspacePage searchParams={searchParams} forcedSection="setup" />
  );
}
