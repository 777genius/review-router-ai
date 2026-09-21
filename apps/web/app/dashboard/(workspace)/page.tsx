import type { Metadata } from "next";
import { createNoIndexPageMetadata } from "../../seo";
import { DashboardWorkspacePage } from "../dashboard-workspace-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createNoIndexPageMetadata({
  title: "Dashboard",
  description:
    "Private ReviewRouter dashboard for repository setup, review policy, health, and audit metadata.",
});

export default async function DashboardPage({
  searchParams,
}: {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}): Promise<React.ReactElement> {
  return <DashboardWorkspacePage searchParams={searchParams} />;
}
