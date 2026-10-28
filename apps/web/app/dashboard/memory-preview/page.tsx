import type { ReactElement } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemoryKnowledgePreview } from "../../../src/features/memory/interface/components/memory-knowledge-preview";
import { createNoIndexPageMetadata } from "../../seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createNoIndexPageMetadata({
  title: "Memory Preview",
  description:
    "Preview approved review knowledge in the ReviewRouter memory dashboard.",
});

export default function MemoryPreviewPage(): ReactElement {
  if (process.env.REVIEW_ROUTER_ENABLE_MEMORY_PREVIEW !== "1") {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 md:py-10">
      <MemoryKnowledgePreview />
    </main>
  );
}
