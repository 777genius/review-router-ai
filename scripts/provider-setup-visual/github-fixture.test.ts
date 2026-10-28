import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";

it("blocks every external request and classifies only the exact Next GET probe separately", async () => {
  const parent = fileURLToPath(
    new URL("../../tmp/provider-setup-visual/", import.meta.url),
  );
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "network-boundary-"));
  const fixture = join(directory, "fixture.json");
  const log = join(directory, "network.jsonl");
  const originalFetch = vi.fn();
  try {
    await writeFile(
      fixture,
      JSON.stringify({
        organizations: [],
        installations: [],
        users: [],
        repositories: [],
        pullRequests: [],
      }),
    );
    vi.stubEnv("PROVIDER_VISUAL_GITHUB_FIXTURE", fixture);
    vi.stubEnv("PROVIDER_VISUAL_NETWORK_LOG", log);
    vi.stubGlobal("fetch", originalFetch);
    await import("./github-fixture.js");

    const probe = "https://registry.npmjs.org/-/package/next/dist-tags";
    for (const [url, method] of [
      [probe, "GET"],
      [probe, "POST"],
      [`${probe}?extra=1`, "GET"],
      [probe.replace("/next/", "/other/"), "GET"],
      [probe.replace("https:", "http:"), "GET"],
    ] as const)
      await expect(fetch(url, { method })).rejects.toThrow(
        "external network is closed",
      );

    expect(originalFetch).not.toHaveBeenCalled();
    const outcomes = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { outcome: string }).outcome);
    expect(outcomes).toEqual([
      "development_probe_blocked",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
    ]);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(directory, { recursive: true, force: true });
  }
});
