import { installLowMemoryNextConfig } from "../../lib/next-browser-test-compiler.ts";
import { assertExplicitTestDatabaseUrl } from "./cli.ts";

if (process.env.NODE_ENV !== "development") {
  throw new Error(
    "accounts_reference_e2e_low_memory_webpack_requires_development",
  );
}
assertExplicitTestDatabaseUrl(process.env.DATABASE_URL ?? "");

installLowMemoryNextConfig({
  onApplied(isServer) {
    console.log(
      "Accounts E2E compiler profile applied",
      JSON.stringify({
        profile: "low-memory-webpack",
        target: isServer ? "server" : "client",
        pid: process.pid,
        cache: false,
        debuggerSourceMaps: false,
        webpackMemoryOptimizations: true,
      }),
    );
  },
});
