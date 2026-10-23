"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Badge,
  Button,
  DialogBackdrop,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  SelectField,
} from "@reviewrouter/ui";
import {
  MemoryDashboardApiError,
  memoryDashboardApi,
  memoryExportHref,
  memoryOperationKey,
  memoryPageKey,
  type MemoryDashboardApi,
} from "../../adapters/memory-dashboard-api";
import type {
  MemoryDashboardMutation,
  MemoryEntryView,
  MemoryKnowledgePage,
  MemoryOperationView,
} from "../../application/memory-knowledge-view";

type Dialog =
  | { readonly action: "save"; readonly entry: MemoryEntryView | null }
  | { readonly action: "retire" | "forget"; readonly entry: MemoryEntryView };
type Draft = { body: string; topics: string };
const pending = (state?: MemoryOperationView["state"]) =>
  state !== undefined && !["published", "completed", "failed"].includes(state);
const inputClass =
  "w-full rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300 focus:ring-1 focus:ring-cyan-300 disabled:opacity-60";

export function MemoryKnowledgeScreen({
  initialData,
  api = memoryDashboardApi,
  onScopeChange,
  onPageChange,
}: {
  readonly initialData: MemoryKnowledgePage;
  readonly api?: MemoryDashboardApi;
  readonly onScopeChange: (repositoryId: string | null) => void;
  readonly onPageChange: (cursor: string | null) => void;
}): React.ReactElement {
  const client = useQueryClient();
  const selection = {
    workspaceId: initialData.workspaceId,
    repositoryId: initialData.repositoryId,
  };
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [commandId, setCommandId] = useState<string | null>(null);
  const operation = useQuery({
    queryKey: memoryOperationKey(selection, commandId),
    queryFn: ({ signal }) =>
      api.progress({ ...selection, commandId: commandId! }, signal),
    enabled: commandId !== null,
    staleTime: 1_000,
    retry: 1,
    refetchInterval: (query) =>
      pending(query.state.data?.state) ? 2_000 : false,
  });
  const pageQuery = useQuery({
    queryKey: memoryPageKey(initialData),
    queryFn: ({ signal }) =>
      api.list({ ...selection, cursor: initialData.cursor }, signal),
    initialData,
    staleTime: 20_000,
    retry: 1,
    refetchInterval: (query) =>
      pending(operation.data?.state) ||
      query.state.data?.entries.some((entry) => entry.pendingCommandId)
        ? 3_000
        : false,
  });
  useEffect(() => {
    if (operation.data && !pending(operation.data.state))
      void client.invalidateQueries({
        queryKey: [
          "memory-knowledge",
          selection.workspaceId,
          selection.repositoryId,
        ],
      });
  }, [
    client,
    operation.data?.state,
    selection.workspaceId,
    selection.repositoryId,
  ]);
  const page = pageQuery.data;
  const busy = pending(operation.data?.state);
  const accepted = async (result: MemoryOperationView) => {
    client.setQueryData(memoryOperationKey(selection, result.id), result);
    setCommandId(result.id);
    setDialog(null);
    await client.invalidateQueries({
      queryKey: [
        "memory-knowledge",
        selection.workspaceId,
        selection.repositoryId,
      ],
    });
  };
  const activeCount = page.entries.filter(
    (entry) => entry.status === "active",
  ).length;
  return (
    <section
      id="dashboard-section-content"
      aria-label="Memory management"
      className="mx-auto w-full min-w-0 max-w-5xl pb-10 text-slate-100"
    >
      <div className="flex flex-wrap items-start justify-between gap-5 border-b border-white/10 pb-6">
        <div className="max-w-2xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
            Shared review knowledge
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Memory
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Keep the rules your team has approved for future reviews. Workspace
            rules are shared across repositories; repository rules apply to one
            project.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {page.canExport ? (
            <a
              href={memoryExportHref(selection)}
              className="inline-flex min-h-10 items-center rounded-xl border border-white/15 px-4 text-sm font-medium text-slate-200 transition hover:bg-white/5"
            >
              Export
            </a>
          ) : null}
          {page.canManage ? (
            <Button
              tone="accent"
              disabled={!page.writesEnabled || busy}
              onClick={() => setDialog({ action: "save", entry: null })}
            >
              Add memory
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-5 py-6">
        <div className="w-full sm:max-w-sm">
          <SelectField
            name="memory-scope"
            label="Show knowledge for"
            value={page.repositoryId ?? "workspace"}
            onValueChange={(value) =>
              onScopeChange(value === "workspace" ? null : value)
            }
            options={[
              ...(page.workspaceVisible
                ? [{ value: "workspace", label: "Workspace · shared rules" }]
                : []),
              ...page.repositories.map((repository) => ({
                value: repository.id,
                label: repository.label,
              })),
            ]}
          />
        </div>
        <p className="text-sm text-slate-400">
          {activeCount} active on this page{" "}
          <span aria-hidden="true" className="mx-2 text-slate-600">
            ·
          </span>{" "}
          {page.canManage ? "You can manage this scope" : "View only"}
        </p>
      </div>
      {page.availability !== "ready" || !page.writesEnabled ? (
        <Notice>
          {page.availability === "unavailable"
            ? "Memory is temporarily unavailable. Some text cannot be loaded. Existing reviews continue without memory when it is unavailable."
            : "Memory saving is turned off for this scope. You can still view available knowledge and remove entries you manage."}
        </Notice>
      ) : null}
      {pageQuery.isError ? (
        <Notice>
          We could not refresh this list. The last loaded view is shown.{" "}
          <button
            className="font-medium text-cyan-200 underline"
            onClick={() => void pageQuery.refetch()}
          >
            Try again
          </button>
        </Notice>
      ) : null}
      {commandId ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-100"
        >
          <span>
            {operation.data?.message ?? "Checking the status of your change…"}
            {operation.isError
              ? " Status is temporarily unavailable; your original request is preserved."
              : ""}
          </span>
          {operation.data && !pending(operation.data.state) ? (
            <button
              className="text-xs underline"
              onClick={() => setCommandId(null)}
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="border-y border-white/10">
        {page.entries.length === 0 ? (
          <div className="py-16 text-center">
            <h2 className="text-lg font-medium">No approved memory here yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
              Add a clear rule that will help reviewers understand how your team
              works.
            </p>
          </div>
        ) : (
          page.entries.map((entry) => (
            <article
              key={entry.id}
              className="flex min-w-0 flex-col gap-4 border-b border-white/10 py-6 last:border-b-0 sm:flex-row sm:justify-between sm:gap-7"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge
                    size="xs"
                    tone={entry.status === "active" ? "success" : "neutral"}
                  >
                    {entry.status === "active"
                      ? "Active"
                      : entry.status === "retired"
                        ? "Paused"
                        : entry.status === "forget_pending"
                          ? "Forgetting"
                          : entry.status === "forgotten"
                            ? "Forgotten"
                            : "Expired"}
                  </Badge>
                  <Badge size="xs">
                    {entry.kind === "observation"
                      ? "Historical observation"
                      : entry.kind === "exception"
                        ? "Explicit exception"
                        : "Rule"}
                  </Badge>
                  {entry.pendingCommandId ? (
                    <span className="text-xs text-amber-200">
                      Change processing
                    </span>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-7 text-slate-100">
                  {entry.body ??
                    (entry.unavailable === "unsettled"
                      ? "The approved text is still processing."
                      : entry.status === "forgotten"
                        ? "This memory has been forgotten."
                        : "The text is temporarily unavailable.")}
                </p>
                {entry.topics.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {entry.topics.map((topic) => (
                      <span
                        key={topic}
                        className="rounded-md bg-white/5 px-2 py-1 text-xs text-slate-300"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-slate-500">
                  {entry.sourceUrl ? (
                    <a
                      href={entry.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-slate-400 underline decoration-slate-600 underline-offset-2"
                    >
                      {entry.sourceLabel} ↗
                    </a>
                  ) : (
                    <span>{entry.sourceLabel}</span>
                  )}
                  {entry.statementAt ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Statement{" "}
                        <time dateTime={entry.statementAt}>
                          {dateLabel(entry.statementAt)}
                        </time>
                      </span>
                    </>
                  ) : null}
                  {entry.lastVerifiedAt ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Verified{" "}
                        <time dateTime={entry.lastVerifiedAt}>
                          {dateLabel(entry.lastVerifiedAt)}
                        </time>
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
              {page.canManage && entry.status !== "forgotten" ? (
                <div className="flex shrink-0 flex-wrap gap-1 self-start">
                  {entry.status === "active" ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={
                          !page.writesEnabled ||
                          busy ||
                          !!entry.pendingCommandId ||
                          entry.body === null
                        }
                        onClick={() => setDialog({ action: "save", entry })}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || !!entry.pendingCommandId}
                        onClick={() => setDialog({ action: "retire", entry })}
                      >
                        Pause
                      </Button>
                    </>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    tone="danger"
                    disabled={
                      busy ||
                      !!entry.pendingCommandId ||
                      entry.status === "forget_pending"
                    }
                    onClick={() => setDialog({ action: "forget", entry })}
                  >
                    Forget
                  </Button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
      {page.cursor || page.nextCursor ? (
        <nav
          aria-label="Memory pages"
          className="mt-5 flex justify-between gap-3"
        >
          {page.cursor ? (
            <Button variant="outline" onClick={() => onPageChange(null)}>
              First page
            </Button>
          ) : (
            <span />
          )}
          {page.nextCursor ? (
            <Button
              variant="outline"
              onClick={() => onPageChange(page.nextCursor)}
            >
              Next page
            </Button>
          ) : null}
        </nav>
      ) : null}
      <p className="mt-5 max-w-3xl text-xs leading-5 text-slate-500">
        Pausing removes a rule from new reviews. Forgetting also requests
        removal of its stored text. Historical observations describe an earlier
        point in time and do not establish a current rule.
      </p>
      {dialog ? (
        <MemoryChangeDialog
          key={`${dialog.action}:${dialog.entry?.id ?? "new"}`}
          dialog={dialog}
          selection={selection}
          api={api}
          onClose={() => setDialog(null)}
          onAccepted={accepted}
        />
      ) : null}
    </section>
  );
}

function MemoryChangeDialog({
  dialog,
  selection,
  api,
  onClose,
  onAccepted,
}: {
  readonly dialog: Dialog;
  readonly selection: { workspaceId: string; repositoryId: string | null };
  readonly api: MemoryDashboardApi;
  readonly onClose: () => void;
  readonly onAccepted: (operation: MemoryOperationView) => Promise<void>;
}): React.ReactElement {
  const form = useForm<Draft>({
    defaultValues: {
      body: dialog.entry?.body ?? "",
      topics: dialog.entry?.topics.join(", ") ?? "",
    },
  });
  // A transport failure may have happened after acceptance. Keep this exact
  // envelope and UUID for every retry; do not manufacture another approval.
  const request = useRef<MemoryDashboardMutation | null>(null);
  const mutation = useMutation({
    mutationFn: (input: MemoryDashboardMutation) => api.mutate(input),
    retry: false,
    onSuccess: onAccepted,
    onError: (error) => {
      if (
        error instanceof MemoryDashboardApiError &&
        [400, 403, 409].includes(error.status)
      )
        request.current = null;
    },
  });
  const locked = request.current !== null;
  const submit = form.handleSubmit((draft) => {
    if (!request.current) {
      request.current = {
        ...selection,
        commandId: crypto.randomUUID(),
        entryId: dialog.entry?.id ?? null,
        expectedRevision: dialog.entry?.revision ?? null,
        ...(dialog.action === "save"
          ? {
              action: "save",
              body: draft.body.trim(),
              topics: [
                ...new Set(
                  draft.topics
                    .split(",")
                    .map((topic) => topic.trim())
                    .filter(Boolean),
                ),
              ],
            }
          : { action: dialog.action }),
      };
    }
    mutation.mutate(request.current);
  });
  const title =
    dialog.action === "save"
      ? dialog.entry
        ? "Edit memory"
        : "Add memory"
      : dialog.action === "retire"
        ? "Pause this memory?"
        : "Forget this memory?";
  return (
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {dialog.action === "save"
              ? "Write a specific, approved rule for future reviews. Keep secrets and personal information out of memory."
              : dialog.action === "retire"
                ? "This memory will no longer be used in new reviews. Paused entries cannot be restored from this page."
                : "This removes the memory from new reviews and requests deletion of its stored text. Cleanup may take time. This cannot be undone."}
          </DialogDescription>
          <form onSubmit={submit} className="mt-5 space-y-4">
            {dialog.action === "save" ? (
              <>
                <label className="grid gap-2 text-sm font-medium">
                  Memory text
                  <textarea
                    rows={5}
                    maxLength={1_000}
                    disabled={locked}
                    className={inputClass}
                    {...form.register("body", {
                      required: "Enter a rule to remember.",
                      validate: (value) =>
                        value.trim().length > 0 || "Enter a rule to remember.",
                    })}
                  />
                </label>
                {form.formState.errors.body ? (
                  <p role="alert" className="text-sm text-red-200">
                    {form.formState.errors.body.message}
                  </p>
                ) : null}
                <label className="grid gap-2 text-sm font-medium">
                  Topics{" "}
                  <span className="text-xs font-normal text-slate-400">
                    Optional · comma separated, e.g. testing, database
                  </span>
                  <input
                    disabled={locked}
                    className={inputClass}
                    {...form.register("topics", {
                      validate: (value) => {
                        const topics = value
                          .split(",")
                          .map((topic) => topic.trim())
                          .filter(Boolean);
                        return (
                          (topics.length <= 20 &&
                            topics.every(
                              (topic) =>
                                /^[a-zA-Z0-9_-]{1,100}$/.test(topic) &&
                                !topic.startsWith("rr_"),
                            )) ||
                          "Use up to 20 short topics with letters, numbers, dashes or underscores."
                        );
                      },
                    })}
                  />
                </label>
                {form.formState.errors.topics ? (
                  <p role="alert" className="text-sm text-red-200">
                    {form.formState.errors.topics.message}
                  </p>
                ) : null}
              </>
            ) : (
              <blockquote className="border-l-2 border-white/15 pl-4 text-sm leading-6 text-slate-300">
                {dialog.entry.body ?? "The text is currently unavailable."}
              </blockquote>
            )}
            {mutation.isError ? (
              <p
                role="alert"
                className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm leading-6 text-amber-100"
              >
                {mutation.error instanceof Error
                  ? mutation.error.message
                  : "We could not confirm the outcome."}{" "}
                {locked
                  ? "Retry sends the same request. Your draft is locked until its outcome is known."
                  : "No change was accepted. Close this form and refresh before trying again."}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                variant="ghost"
                type="button"
                disabled={locked}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                tone={dialog.action === "forget" ? "danger" : "accent"}
                disabled={mutation.isPending}
              >
                {mutation.isPending
                  ? "Submitting…"
                  : mutation.isError
                    ? "Retry same request"
                    : dialog.action === "save"
                      ? "Submit memory"
                      : dialog.action === "retire"
                        ? "Pause memory"
                        : "Forget memory"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  );
}
function Notice({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <p
      role="status"
      className="mb-5 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm leading-6 text-amber-100"
    >
      {children}
    </p>
  );
}
function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
