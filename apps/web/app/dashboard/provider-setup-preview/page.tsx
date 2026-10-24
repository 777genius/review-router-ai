import type React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createNoIndexPageMetadata } from "../../seo";
import {
  ProviderSetupPreviewClient,
  type ProviderSetupPreviewState,
} from "../provider-setup/provider-setup-preview-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createNoIndexPageMetadata({
  title: "Provider setup preview",
  description: "Fixture view of the provider setup dialog.",
});

type ProviderSetupPreviewPageProps = {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
};

/** Fixture-only visual review of the provider dialog; off unless enabled. */
export default async function ProviderSetupPreviewPage({
  searchParams,
}: ProviderSetupPreviewPageProps): Promise<React.ReactElement> {
  if (process.env.REVIEW_ROUTER_ENABLE_PROVIDER_SETUP_PREVIEW !== "1")
    notFound();
  const params = searchParams ? await searchParams : {};
  const state: ProviderSetupPreviewState =
    params.state === "no-default" ? "no-default" : "default";
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 md:py-10">
      <ProviderSetupPreviewClient state={state} />
    </main>
  );
}
