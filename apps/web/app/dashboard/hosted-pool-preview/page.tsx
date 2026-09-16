import type React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createNoIndexPageMetadata } from "../../seo";
import { HostedPoolPreviewClient } from "../hosted-pool-preview-client";
import {
  hostedPoolPreviewScenarios,
  resolveHostedPoolPreviewScenario,
  type HostedPoolPreviewScenario,
} from "../hosted-pool-preview-fixtures";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createNoIndexPageMetadata({
  title: "ChatGPT accounts",
  description: "ChatGPT accounts ReviewRouter uses for hosted reviews.",
});

type HostedPoolPreviewPageProps = {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
};

const exampleLabels: Record<HostedPoolPreviewScenario, string> = {
  empty: "No accounts",
  waiting: "Connecting",
  enrolled: "Several accounts",
  paused: "Paused",
  reconnect: "Needs reconnect",
};

export default async function HostedPoolPreviewPage({
  searchParams,
}: HostedPoolPreviewPageProps): Promise<React.ReactElement> {
  if (process.env.REVIEW_ROUTER_ENABLE_HOSTED_POOL_PREVIEW !== "1") {
    notFound();
  }

  const params = searchParams ? await searchParams : {};
  const scenario = resolveHostedPoolPreviewScenario(readParam(params.state));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 md:py-10">
      <nav aria-label="Account examples" className="flex flex-wrap gap-2 px-1">
        {hostedPoolPreviewScenarios().map((item) => (
          <a
            key={item}
            href={previewHref(item)}
            className={
              item === scenario
                ? "rounded-full border border-cyan-200/35 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-50"
                : "rounded-full border border-cyan-200/10 px-3 py-1 text-xs font-semibold text-slate-400"
            }
          >
            {exampleLabels[item]}
          </a>
        ))}
      </nav>
      <HostedPoolPreviewClient scenario={scenario} />
    </main>
  );
}

function previewHref(scenario: HostedPoolPreviewScenario): string {
  return `/dashboard/hosted-pool-preview?state=${scenario}`;
}

function readParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}
