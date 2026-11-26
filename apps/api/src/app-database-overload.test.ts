import { describe, expect, it } from "vitest";
import { createApiApp } from "./app.js";

describe("API database overload boundary", () => {
  it("returns a retryable sanitized 503 and preserves unrelated errors", async () => {
    const app = await createApiApp({
      healthDependencies: [],
      reviewActionV2Env: {},
    });
    const failures = [
      new Error("timeout exceeded when trying to connect"),
      Object.assign(
        new Error(
          "Transaction API error: Unable to start a transaction in the given time.",
        ),
        { code: "P2028" },
      ),
      Object.assign(
        new Error("Transaction already closed: execution expired"),
        { code: "P2028" },
      ),
      new Error("upstream request timeout"),
      Object.assign(new Error("bad input"), { statusCode: 400 }),
    ];
    failures.forEach((failure, index) => {
      app.get(`/database-failure-${index}`, async () => {
        throw failure;
      });
    });
    try {
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      for (const index of [0, 1]) {
        const response = await fetch(`${address}/database-failure-${index}`);
        expect(response.status).toBe(503);
        expect(response.headers.get("retry-after")).toBe("1");
        expect(await response.json()).toEqual({
          error: "database_unavailable",
        });
      }
      for (const [index, status] of [
        [2, 500],
        [3, 500],
        [4, 400],
      ]) {
        const response = await fetch(`${address}/database-failure-${index}`);
        expect(response.status).toBe(status);
        expect(response.headers.get("retry-after")).toBeNull();
      }
    } finally {
      await app.close();
    }
  });
});
