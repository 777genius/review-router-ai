import { expect, it } from "vitest";
import { GET } from "./route";

it("keeps the installed v2 query strict while canonical v1 retains legacy queries", async () => {
  const invalid = GET(
    new Request(
      "https://reviewrouter.test/review-banner/v2.svg?state=complete",
    ),
  );
  expect(invalid.status).toBe(400);
  expect(invalid.headers.get("cache-control")).toBe("no-store");
  expect(await invalid.text()).toBe("Invalid banner parameters");
});
