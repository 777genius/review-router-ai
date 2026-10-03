import assert from "node:assert/strict";
import { test } from "vitest";
import { createNewtestContextGateway } from "./rr-v4-one-shot-NEWTEST-gateway.js";

type GatewayInput = Parameters<typeof createNewtestContextGateway>[0];

function probePath(path: string) {
  return createNewtestContextGateway({
    repositoryGitHubId: "1252762369",
    // Deliberately invalid admission: this fixture must never open a gateway.
    session: {} as GatewayInput["session"],
    registeredRelease: {} as GatewayInput["registeredRelease"],
    gatewaySessionSecret: new Uint8Array(32),
    measuredGatewayEntrypointSha256: "0".repeat(64),
    allowedPaths: [path],
    objects: {
      read: async () => {
        throw new Error("unexpected_git_object_read");
      },
    },
  });
}

test("NEWTEST gateway rejects control characters before admission or Git access", async () => {
  for (const code of [
    ...Array.from({ length: 32 }, (_, value) => value),
    0x7f,
    0x5c,
  ]) {
    await assert.rejects(probePath(`src/a${String.fromCharCode(code)}.ts`), {
      message: "newtest_gateway_path_invalid",
    });
  }
  for (const path of [
    "src/plain.ts",
    "src/é.ts",
    "src/😀.ts",
    "src/a\u0080.ts",
  ]) {
    await assert.rejects(probePath(path), {
      message: "newtest_gateway_admission_denied",
    });
  }
});
