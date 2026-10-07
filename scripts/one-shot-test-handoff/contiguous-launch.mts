import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export type Phase =
  | "ready"
  | "assignment"
  | "observe"
  | "mint"
  | "compose"
  | "probe"
  | "owner";
export type Command = Readonly<{ executable: string; args: readonly string[] }>;
export type Execute = (command: Command, stdin?: string) => Promise<string>;
export interface PreparedLaunch {
  repository: "777genius/reviewrouter-e2e-prod-20260529-000305";
  workflowId: 285170467;
  expectedRunNumber: number;
  head: string;
  expectedJobName: "codex-review / one-shot TEST125 transport";
  expectedStepName: string; // exact immutable workflow transfer STEP supplied before READY
  intent: { path: string; sha256: string };
  // Trusted, independently reviewed future command argv, not request input.
  // observe: existing native CLI observe over stdin; mint: existing PROD direct
  // psql -X -qAt -v ON_ERROR_STOP=1 -f pinned SQL | pinned mint, with pipefail.
  observe: Command;
  mint: Command;
  compose: Command;
  // Nonconnecting, bounded existing readiness probe; ONLY terminal0 permits owner.
  probe: Command;
  owner: { node: string; path: string; sha256: string };
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("metadata_invalid");
  return value as Record<string, unknown>;
};
const json = (text: string): Record<string, unknown> =>
  object(JSON.parse(text));
const command = (executable: string, ...args: string[]): Command => ({
  executable,
  args,
});

/** No shell interpolation, no stderr forwarding, no body/inventory output.
 * Output is bounded metadata only; inventory NEVER transits this process. */
export const execute: Execute = (cmd, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd.executable, [...cmd.args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const fail = () => {
      if (!settled) {
        settled = true;
        reject(Error("command_unconfirmed"));
      }
    };
    child.stderr.resume();
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return; // drain/discard later output, never accumulate after rejection
      bytes += chunk.length;
      if (bytes > 393_216) {
        child.stdout.resume();
        fail();
        return;
      }
      chunks.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        fail();
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(stdin);
  });

export async function authenticateAssignment(
  plan: PreparedLaunch,
  run: Execute,
  clock: () => number = Date.now,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let pinnedRunId: number | undefined;
  while (true) {
    if (pinnedRunId === undefined) {
      const listing = json(
        await run(
          command(
            "gh",
            "api",
            `repos/${plan.repository}/actions/workflows/${plan.workflowId}/runs?event=pull_request&per_page=5`,
          ),
        ),
      );
      if (!Array.isArray(listing.workflow_runs))
        throw Error("assignment_invalid");
      const selected = listing.workflow_runs
        .map(object)
        .filter((r) => r.run_number === plan.expectedRunNumber);
      if (selected.length > 1) throw Error("assignment_invalid");
      const selectedRun = selected[0];
      if (selectedRun) {
        if (
          selectedRun.head_sha !== plan.head ||
          selectedRun.run_attempt !== 1 ||
          selectedRun.status === "completed" ||
          typeof selectedRun.id !== "number" ||
          !Number.isSafeInteger(selectedRun.id)
        )
          throw Error("assignment_invalid");
        pinnedRunId = selectedRun.id;
      }
    }
    if (pinnedRunId !== undefined) {
      const runId = String(pinnedRunId);
      // Exact authenticated full API objects consumed unchanged by existing observe guards.
      const actualRun = json(
        await run(
          command(
            "gh",
            "api",
            `repos/${plan.repository}/actions/runs/${runId}`,
          ),
        ),
      );
      if (
        actualRun.id !== pinnedRunId ||
        actualRun.run_number !== plan.expectedRunNumber ||
        actualRun.workflow_id !== plan.workflowId ||
        actualRun.head_sha !== plan.head ||
        actualRun.run_attempt !== 1 ||
        actualRun.status === "completed"
      )
        throw Error("assignment_invalid");
      const jobs = json(
        await run(
          command(
            "gh",
            "api",
            `repos/${plan.repository}/actions/runs/${runId}/attempts/1/jobs?per_page=100`,
          ),
        ),
      );
      if (!Array.isArray(jobs.jobs) || jobs.jobs.length > 20)
        throw Error("assignment_invalid");
      const matching = jobs.jobs
        .map(object)
        .filter((j) => j.name === plan.expectedJobName);
      if (matching.length > 1) throw Error("assignment_invalid");
      const job = matching[0];
      if (job?.status === "completed") throw Error("assignment_invalid");
      if (
        actualRun.status === "in_progress" &&
        job?.status === "in_progress" &&
        Number.isSafeInteger(job.runner_id) &&
        Number(job.runner_id) > 0
      ) {
        if (!Array.isArray(job.steps)) throw Error("assignment_invalid");
        const steps = job.steps
          .map(object)
          .filter((step) => step.name === plan.expectedStepName);
        if (steps.length !== 1) throw Error("assignment_invalid");
        const step = steps[0]!;
        if (step.status === "completed") throw Error("assignment_invalid");
        if (step.status !== "in_progress") {
          await wait(2000);
          continue;
        }
        const startedAt = Date.parse(String(step.started_at));
        if (!Number.isFinite(startedAt) || clock() >= startedAt + 120_000)
          throw Error("original_window_elapsed");
        const pr = json(
          await run(command("gh", "api", `repos/${plan.repository}/pulls/4`)),
        );
        return {
          payload: {
            intent: plan.intent,
            run: actualRun,
            jobs: jobs.jobs,
            currentPullRequest: pr,
          },
          deadline: startedAt + 120_000,
        };
      }
    }
    await wait(2000); // only authenticated read-only assignment discovery; never repeat a mutation
  }
}

export async function contiguousLaunch(
  plan: PreparedLaunch,
  ports: {
    execute: Execute;
    assignment: (
      plan: PreparedLaunch,
    ) => Promise<{ payload: unknown; deadline: number }>;
    clock: () => number;
    phase?: (phase: Phase) => void;
  },
): Promise<void> {
  let phase: Phase = "ready";
  try {
    ports.phase?.(phase);
    await ports.execute(
      command("gh", "pr", "ready", "4", "--repo", plan.repository),
    );
    phase = "assignment";
    ports.phase?.(phase);
    const assignment = await ports.assignment(plan);
    const enter = (next: Phase) => {
      if (ports.clock() >= assignment.deadline)
        throw Error("original_window_elapsed");
      phase = next;
      ports.phase?.(phase);
    };
    enter("observe");
    await ports.execute(plan.observe, JSON.stringify(assignment.payload));
    enter("mint");
    const receipt = json(await ports.execute(plan.mint));
    // Supported mint returns ONLY reference + approvalId/expiresAt, not packet body.
    if (
      typeof receipt.approvalId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(receipt.approvalId) ||
      typeof receipt.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(receipt.expiresAt)) ||
      Date.parse(receipt.expiresAt) <= ports.clock() ||
      Date.parse(receipt.expiresAt) > ports.clock() + 900_000
    )
      throw Error("mint_reference_invalid");
    enter("compose");
    await ports.execute(plan.compose);
    enter("probe");
    await ports.execute(plan.probe);
    enter("owner");
    await ports.execute(
      command(
        plan.owner.node,
        plan.owner.path,
        receipt.approvalId,
        receipt.expiresAt,
      ),
    );
  } catch {
    // Neither retry, terminate a claimed native operation, remove files nor reconnect.
    throw Error(`contiguous_launch_unconfirmed_${phase}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 3) throw Error("prepared_plan_required");
    const plan = JSON.parse(
      await readFile(process.argv[2]!, "utf8"),
    ) as PreparedLaunch;
    // Main prepares/reviews this nonsecret local plan before READY; no future tuple is supplied here.
    if (
      plan.repository !== "777genius/reviewrouter-e2e-prod-20260529-000305" ||
      plan.workflowId !== 285170467 ||
      !Number.isSafeInteger(plan.expectedRunNumber) ||
      plan.expectedRunNumber <= 0 ||
      !/^[a-f0-9]{40}$/.test(plan.head) ||
      plan.expectedJobName !== "codex-review / one-shot TEST125 transport" ||
      typeof plan.expectedStepName !== "string" ||
      !plan.expectedStepName.trim()
    )
      throw Error("prepared_plan_invalid");
    const ownerPath = await realpath(plan.owner.path);
    const ownerStat = await lstat(ownerPath);
    if (
      ownerPath !== plan.owner.path ||
      !ownerStat.isFile() ||
      ownerStat.nlink !== 1 ||
      createHash("sha256")
        .update(await readFile(ownerPath))
        .digest("hex") !== plan.owner.sha256
    )
      throw Error("owner_pin_invalid");
    for (const cmd of [plan.observe, plan.mint, plan.compose, plan.probe]) {
      if (
        !cmd ||
        typeof cmd.executable !== "string" ||
        !cmd.executable ||
        !Array.isArray(cmd.args) ||
        !cmd.args.every((arg) => typeof arg === "string")
      )
        throw Error("prepared_command_invalid");
    }
    const currentPr = json(
      await execute(command("gh", "api", `repos/${plan.repository}/pulls/4`)),
    );
    if (
      currentPr.draft !== true ||
      currentPr.state !== "open" ||
      object(currentPr.head).sha !== plan.head
    )
      throw Error("prepared_pr_invalid");
    await contiguousLaunch(plan, {
      execute,
      assignment: (p) => authenticateAssignment(p, execute),
      clock: Date.now,
      phase: (phase) => console.error(`newtest_contiguous_phase_${phase}`),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error &&
      /^contiguous_launch_unconfirmed_(ready|assignment|observe|mint|compose|probe|owner)$/.test(
        error.message,
      )
        ? error.message
        : "contiguous_launch_preparation_unconfirmed";
    console.error(message);
    process.exitCode = 1;
  }
}
