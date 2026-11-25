#!/usr/bin/env node
// Preserve the established subprocess entrypoint; policy implementation is strict TypeScript.
import { writeSync } from "node:fs";
import { relative, resolve } from "node:path";
import { checkArchitectureBoundaries } from "./architecture-boundaries/check.ts";

const root = process.env.REVIEWROUTER_ARCHITECTURE_ROOT
  ? resolve(process.env.REVIEWROUTER_ARCHITECTURE_ROOT)
  : new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const { checkedFiles, violations } = await checkArchitectureBoundaries(root);

if (violations.length > 0) {
  writeSync(
    2,
    `Architecture boundary violations found:\n${violations
      .map(
        (violation) =>
          `- ${relative(root, violation.file)} imports ${violation.imported}: ${violation.reason}`,
      )
      .join(
        "\n",
      )}\nMove framework/SDK/database code to infrastructure or interface adapters and expose a port to application code.\n`,
  );
  process.exitCode = 1;
} else {
  writeSync(
    1,
    `Architecture boundary check passed for ${checkedFiles} domain/application files.\n`,
  );
}
