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
  title: "Hosted pool preview",
  description:
    "No-index ReviewRouter hosted Codex pool accounts preview with deterministic fixtures.",
});

type HostedPoolPreviewPageProps = {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
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
      <section className="rounded-[1.5rem] border border-cyan-200/10 bg-slate-950/62 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
          Hosted Codex pool
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-cyan-50">
          ChatGPT accounts preview
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          Deterministic UI fixture for design QA. It uses only synthetic account
          labels and keeps the production dashboard auth path unchanged.
        </p>
        <nav className="mt-4 flex flex-wrap gap-2">
          {hostedPoolPreviewScenarios().map((item) => (
            <a
              key={item}
              href={previewHref(item)}
              className={
                item === scenario
                  ? "rounded-full border border-cyan-200/35 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-50"
                  : "rounded-full border border-cyan-200/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
              }
            >
              {item}
            </a>
          ))}
        </nav>
      </section>
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
