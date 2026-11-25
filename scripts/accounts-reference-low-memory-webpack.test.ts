import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { install } = vi.hoisted(() => ({ install: vi.fn() }));
vi.mock("./lib/next-browser-test-compiler.ts", () => ({
  installLowMemoryNextConfig: install,
}));

const databaseUrl =
  "postgresql://fixture:password@127.0.0.1:5432/review_router_accounts_reference_e2e_test?schema=public";

beforeEach(() => {
  vi.resetModules();
  install.mockClear();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DATABASE_URL", databaseUrl);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it("installs the shared compiler policy only for the disposable development fixture", async () => {
  await import("./accounts-reference-e2e/src/low-memory-webpack.ts");
  expect(install).toHaveBeenCalledOnce();
  expect(install).toHaveBeenCalledWith({ onApplied: expect.any(Function) });
});

it("rejects production before installing a compiler override", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await expect(
    import("./accounts-reference-e2e/src/low-memory-webpack.ts"),
  ).rejects.toThrow(
    "accounts_reference_e2e_low_memory_webpack_requires_development",
  );
  expect(install).not.toHaveBeenCalled();
});

it.each([
  ["", "accounts_reference_e2e_test_database_url_invalid"],
  [
    databaseUrl.replace("127.0.0.1", "database.example.com"),
    "accounts_reference_e2e_test_database_url_must_be_loopback",
  ],
  [
    databaseUrl.replace("review_router_accounts_reference_e2e_test", "other"),
    "accounts_reference_e2e_test_database_name_must_be_review_router_accounts_reference_e2e_test",
  ],
])("rejects a database outside the owned fixture: %s", async (url, error) => {
  vi.stubEnv("DATABASE_URL", url);
  await expect(
    import("./accounts-reference-e2e/src/low-memory-webpack.ts"),
  ).rejects.toThrow(error);
  expect(install).not.toHaveBeenCalled();
});
