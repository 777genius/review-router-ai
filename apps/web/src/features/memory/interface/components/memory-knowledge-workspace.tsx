"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@reviewrouter/ui";
import type {
  MemoryKnowledgePage,
  MemoryUnconfirmedChange,
} from "../../application/memory-knowledge-view";
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
  const [unconfirmedChange, setUnconfirmedChange] =
    useState<MemoryUnconfirmedChange | null>(null);
  useEffect(() => setUnconfirmedChange(null), [initialData.workspaceId]);
  const currentChange =
    unconfirmedChange?.request.workspaceId === initialData.workspaceId
      ? unconfirmedChange
      : null;
  const navigate = (
    repositoryId: string | null,
    cursor: string | null,
    topicId: string | null = null,
  ) => {
    const next = new URLSearchParams(params.toString());
    if (repositoryId) next.set("memoryRepository", repositoryId);
    else next.delete("memoryRepository");
    if (cursor) next.set("memoryCursor", cursor);
    else next.delete("memoryCursor");
    if (topicId) next.set("memoryTopic", topicId);
    else next.delete("memoryTopic");
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return (
    <>
      {currentChange &&
      currentChange.request.repositoryId !== initialData.repositoryId ? (
        <div
          role="status"
          className="mb-5 flex flex-wrap items-center gap-3 text-sm text-amber-100"
        >
          <span>
            A request in another memory selection is still being checked.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(currentChange.request.repositoryId, null)}
          >
            Return to request
          </Button>
        </div>
      ) : null}
      <MemoryKnowledgeScreen
        key={`${initialData.workspaceId}:${initialData.repositoryId ?? "workspace"}:${initialData.cursor ?? "first"}:${initialData.topicId ?? "all"}`}
        initialData={initialData}
        onScopeChange={(repositoryId) => navigate(repositoryId, null)}
        onPageChange={(cursor) =>
          navigate(initialData.repositoryId, cursor, initialData.topicId)
        }
        onTopicChange={(topicId) =>
          navigate(initialData.repositoryId, null, topicId)
        }
        unconfirmedChange={currentChange}
        onUnconfirmedChange={(change, commandId) =>
          setUnconfirmedChange(
            (current) =>
              change ??
              (current?.request.commandId === commandId ? null : current),
          )
        }
      />
    </>
  );
}
