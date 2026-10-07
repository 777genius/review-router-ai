import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "./production-migration-db-access.mjs";

describe("production migration runner network access", () => {
  it("allows only the runner IPv4 and removes only its own entry", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rr-migration-ip-"));
    const state = join(directory, "state.json");
    let list = [{ cidrBlock: "10.0.0.0/8", description: "existing" }];
    const calls: string[] = [];
    const fetchImpl = async (
      url: string,
      options?: { method?: string; body?: string },
    ) => {
      if (url.includes("ipify"))
        return { ok: true, json: async () => ({ ip: "203.0.113.7" }) };
      if (options?.method === "PATCH") {
        list = JSON.parse(options.body!).ipAllowList;
        calls.push("patch");
        return { ok: true };
      }
      return { ok: true, json: async () => ({ ipAllowList: list }) };
    };
    const env = {
      RENDER_API_KEY: "test-only",
      RENDER_POSTGRES_ID: "dpg-da32ipmk1f9s73dttm90-a",
      RENDER_ALLOWLIST_BACKUP_PATH: state,
      GITHUB_RUN_ID: "7001",
    };
    try {
      await run("open", env, fetchImpl);
      expect(list).toContainEqual({
        cidrBlock: "203.0.113.7/32",
        description: "rr-additive-migration-7001",
      });
      expect(JSON.parse(readFileSync(state, "utf8")).added).toBe(true);
      list.push({ cidrBlock: "192.0.2.1/32", description: "other-operator" });
      await run("restore", env, fetchImpl);
      expect(list).toEqual([
        { cidrBlock: "10.0.0.0/8", description: "existing" },
        { cidrBlock: "192.0.2.1/32", description: "other-operator" },
      ]);
      expect(calls).toEqual(["patch", "patch"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
