/** Reviewed operator command; no HTTP exposure or schema change. */
import {
  constants,
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { createPrismaClient } from "../packages/platform/db/src/index";
import { RedriveUsageSource } from "../packages/features/provider-usage/src/application/redrive-usage-source";
import { PrismaUsageSourceRedrive } from "../packages/features/provider-usage/src/infrastructure/prisma-usage-source-redrive";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--request-file")
    throw new Error("usage_redrive_request_file_required");
  const fd = openSync(args[1]!, constants.O_RDONLY | constants.O_NOFOLLOW);
  let request: string;
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > 8192
    )
      throw new Error("usage_redrive_request_file_custody");
    request = readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
  const input = JSON.parse(request) as {
    operationId: string;
    operatorWorkspaceId: string;
    actorId: string;
    workspaceId: string;
    sourceInstance: string;
    expectedFence: string;
    expectedDeadLetteredAt: string;
    reason: string;
  };
  if (!/^(0|[1-9][0-9]{0,18})$/.test(input.expectedFence))
    throw new Error("usage_redrive_input_invalid");
  const prisma = createPrismaClient({ poolMax: 1 });
  try {
    const command = new RedriveUsageSource(
      new PrismaUsageSourceRedrive(
        prisma,
        process.env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
      ),
    );
    const receipt = await command.execute({
      ...input,
      expectedFence: BigInt(input.expectedFence),
      expectedDeadLetteredAt: new Date(input.expectedDeadLetteredAt),
    });
    // No source cursors, capabilities, provider payloads or credentials leave here.
    console.log(JSON.stringify(receipt));
  } finally {
    await prisma.$disconnect();
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  main().catch((error: unknown) => {
    const code =
      error instanceof Error && /^usage_[a-z_]+$/.test(error.message)
        ? error.message
        : "usage_redrive_failed_read_same_operation_receipt";
    console.error(
      JSON.stringify({ status: "STOP", code, replayOperationUnchanged: true }),
    );
    process.exitCode = 1;
  });
