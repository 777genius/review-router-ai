import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkWebHostCms,
  createFileSystemView,
} from "./check-web-host-cms-profile";

// Process entry point of the deterministic WEB Host CMS gate (ADR-030). It always checks the repository this file
// lives in and always reports: a real PASS line on valid source, the violation list and exit code 1 otherwise.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const violations = checkWebHostCms(createFileSystemView(root));

if (violations.length > 0) {
  process.stderr.write(
    `WEB Host CMS profile violations:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    "WEB Host CMS profile check passed (source/profile only; the installed gate is operator-run).\n",
  );
}
