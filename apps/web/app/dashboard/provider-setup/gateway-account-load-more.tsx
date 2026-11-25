"use client";

import { Button } from "@reviewrouter/ui";

export function GatewayAccountLoadMore({
  canLoadMore,
  loading,
  onLoadMore,
}: {
  readonly canLoadMore: boolean;
  readonly loading: boolean;
  readonly onLoadMore: () => void;
}): React.ReactElement | null {
  if (!canLoadMore) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-fit"
      disabled={loading}
      onClick={onLoadMore}
    >
      Load more accounts
    </Button>
  );
}
