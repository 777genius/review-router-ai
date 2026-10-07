import type { Metadata } from "next";
import { createNoIndexPageMetadata } from "../../../seo";
import { DashboardWorkspacePage } from "../../dashboard-workspace-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createNoIndexPageMetadata({
  title: "Accounts",
  description:
    "We encrypt ChatGPT accounts for hosted reviews. Sessions stay on ReviewRouter servers and never go to the browser.",
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
