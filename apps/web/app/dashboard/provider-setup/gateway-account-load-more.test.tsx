// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GatewayAccountLoadMore } from "./gateway-account-load-more";

afterEach(cleanup);

it("exposes the existing account-page continuation and calls it once", () => {
  const loadMore = vi.fn();
  const view = render(
    <GatewayAccountLoadMore
      canLoadMore
      loading={false}
      onLoadMore={loadMore}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Load more accounts" }));
  expect(loadMore).toHaveBeenCalledTimes(1);
  view.rerender(
    <GatewayAccountLoadMore canLoadMore loading onLoadMore={loadMore} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Load more accounts" }));
  expect(loadMore).toHaveBeenCalledTimes(1);
  view.rerender(
    <GatewayAccountLoadMore
      canLoadMore={false}
      loading={false}
      onLoadMore={loadMore}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Load more accounts" }),
  ).toBeNull();
});
