"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { MemoryKnowledgePage } from "../../application/memory-knowledge-view";
import { MemoryKnowledgeScreen } from "./memory-knowledge-screen";

/** Scope and pagination are URL state, so links and server authorization agree. */
export function MemoryKnowledgeWorkspace({
  initialData,
}: {
  readonly initialData: MemoryKnowledgePage;
}): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const navigate = (repositoryId: string | null, cursor: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (repositoryId) next.set("memoryRepository", repositoryId);
    else next.delete("memoryRepository");
    if (cursor) next.set("memoryCursor", cursor);
    else next.delete("memoryCursor");
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <MemoryKnowledgeScreen
      key={`${initialData.workspaceId}:${initialData.repositoryId ?? "workspace"}:${initialData.cursor ?? "first"}`}
      initialData={initialData}
      onScopeChange={(repositoryId) => navigate(repositoryId, null)}
      onPageChange={(cursor) => navigate(initialData.repositoryId, cursor)}
    />
  );
}
