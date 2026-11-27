import { pathToFileURL } from "node:url";
import { readGitHubAppPrivateKey } from "@reviewrouter/platform-config";
import { createPrismaClient } from "@reviewrouter/platform-db";
import { GitHubAppWebhookRedeliveryClient } from "./github/github-app-webhook-redelivery-client.js";
import {
  runKnownWebhookRecovery,
  validateWebhookRecoveryCommand,
  type WebhookRecoveryCommand,
} from "./github/github-webhook-recovery.js";

export function parseWebhookRecoveryArguments(argv: readonly string[]): WebhookRecoveryCommand {
  const [mode, ...flags] = argv;
  if (mode !== "inspect" && mode !== "request" && mode !== "reconcile")
    throw new Error("webhook_recovery_command_invalid");
  const options = new Map<string, string>();
  for (let index = 0; index < flags.length; index += 2) {
    const name = flags[index];
    const value = flags[index + 1];
    if (
      (name !== "--delivery-guid" && name !== "--github-delivery-id") ||
      !value || value.startsWith("--") || options.has(name)
    ) throw new Error("webhook_recovery_arguments_invalid");
    options.set(name, value);
  }
  const deliveryGuid = options.get("--delivery-guid");
  const numericId = options.get("--github-delivery-id");
  if (!deliveryGuid || !numericId || !/^[1-9][0-9]{0,15}$/u.test(numericId))
    throw new Error("webhook_recovery_arguments_invalid");
  const command: WebhookRecoveryCommand = {
    mode, deliveryGuid, githubDeliveryId: BigInt(numericId),
  };
  validateWebhookRecoveryCommand(command);
  return command;
}

async function main(): Promise<void> {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    process.stdout.write(
      "Usage: pnpm webhook:recover inspect|request|reconcile --delivery-guid GUID --github-delivery-id ID\n" +
      "inspect is read-only. request reserves at most one POST. reconcile never sends a POST.\n" +
      "Recovery requires a known fenced receipt, matching GitHub App credentials and DATABASE_URL.\n",
    );
    return;
  }
  const command = parseWebhookRecoveryArguments(process.argv.slice(2));
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = readGitHubAppPrivateKey(process.env);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!appId || !privateKey || !databaseUrl)
    throw new Error("webhook_recovery_config_invalid");
  const client = GitHubAppWebhookRedeliveryClient.fromTrustedConfig({ appId, privateKey });
  const prisma = createPrismaClient({ databaseUrl });
  try {
    const result = await runKnownWebhookRecovery(command, { prisma, client });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = ["eligible", "processed", "confirmed"].includes(result.state) ? 0 : 2;
  } finally {
    await prisma.$disconnect();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch(() => {
    // Do not print private-key, database or network errors containing credentials.
    process.stderr.write("webhook_recovery_failed: verify command, trusted App configuration and database access\n");
    process.exitCode = 1;
  });
}
