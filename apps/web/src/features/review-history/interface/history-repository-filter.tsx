"use client";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, SearchSelectField } from "@reviewrouter/ui";
import type {
  HistoryRepositoryPage,
  HistoryRepositoryOption,
} from "@reviewrouter/features-review-history/contracts";
import {
  fetchHistoryRepositories,
  historyRepositoriesKey,
  isHistoryAccessFailure,
} from "../adapters/history-api";
import { useHistoryScope } from "./history-scope";

export function HistoryRepositoryFilter({
  value,
  initialPage,
  initialValue,
  onChange,
}: {
  value: string | null;
  initialValue: string | null;
  initialPage: HistoryRepositoryPage | null;
  onChange: (value: string | null) => void;
}) {
  const scope = useHistoryScope();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [queryText, setQueryText] = useState("");
  const chosen = useRef<HistoryRepositoryOption | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQueryText(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useInfiniteQuery({
    queryKey: historyRepositoriesKey(
      scope.actorId,
      scope.workspaceId,
      scope.seedId,
      queryText,
      value,
    ),
    queryFn: ({ pageParam, signal }) =>
      scope.request(() =>
        fetchHistoryRepositories(
          scope.workspaceId,
          queryText,
          value,
          pageParam,
          signal,
        ),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    ...(!scope.denied &&
    scope.seedTrusted &&
    initialPage &&
    queryText === "" &&
    value === initialValue
      ? { initialData: { pages: [initialPage], pageParams: [undefined] } }
      : {}),
    enabled: open && !scope.denied,
    staleTime: 30_000,
    retry: (failures, error) => !isHistoryAccessFailure(error) && failures < 1,
  });
  const pages = scope.denied ? [] : (query.data?.pages ?? []);
  const repositories = [
    ...new Map(
      pages.flatMap((page) => page.items).map((item) => [item.id, item]),
    ).values(),
  ];
  const selected =
    pages[0]?.selected ??
    (scope.seedTrusted && value === initialValue
      ? initialPage?.selected
      : null) ??
    repositories.find((item) => item.id === value) ??
    (chosen.current?.id === value ? chosen.current : null);
  return (
    <SearchSelectField
      label="Repository"
      value={{
        value: scope.denied ? "" : (value ?? ""),
        label: scope.denied
          ? "Repository unavailable"
          : value
            ? (selected?.fullName ?? "Selected repository")
            : "All repositories",
      }}
      options={[
        { value: "", label: "All repositories" },
        ...repositories.map((item) => ({
          value: item.id,
          label: item.fullName,
        })),
      ]}
      search={search}
      onSearchChange={setSearch}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
      onValueChange={(option) => {
        chosen.current = option.value
          ? { id: option.value, fullName: option.label }
          : null;
        onChange(option.value || null);
        setSearch("");
      }}
      disabled={scope.denied}
      loading={query.isFetching || search !== queryText}
      hasMore={query.hasNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      message={
        query.isError ? (
          <>
            Repositories could not be loaded.{" "}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void query.refetch()}
            >
              Try loading again
            </Button>
          </>
        ) : repositories.length === 0 && query.data ? (
          "No repositories match this search."
        ) : null
      }
    />
  );
}
