import assert from "node:assert/strict";
import { test } from "vitest";
import {
  authenticateAssignment,
  contiguousLaunch,
  execute,
  type Phase,
  type PreparedLaunch,
} from "./contiguous-launch.mts";

// Synthetic injected transport only; no child processes, real files, gh, DB or network.
const now = 1_800_000_000_000;
const plan: PreparedLaunch = {
  repository: "777genius/reviewrouter-e2e-prod-20260529-000305",
  workflowId: 285170467,
  expectedRunNumber: 999,
  head: "a".repeat(40),
  expectedJobName: "codex-review / one-shot TEST125 transport",
  expectedStepName: "synthetic transfer STEP",
  intent: { path: "/synthetic/intent.json", sha256: "b".repeat(64) },
  observe: { executable: "observe", args: [] },
  mint: { executable: "mint", args: [] },
  compose: { executable: "compose", args: [] },
  probe: { executable: "probe", args: [] },
  owner: {
    node: "owner",
    path: "/synthetic/owner.mjs",
    sha256: "c".repeat(64),
  },
};
function harness(
  failure?: Phase,
  invalidMint = false,
  deadline = now + 120_000,
) {
  const calls: Phase[] = [];
  const phases: Phase[] = [];
  const inputs: Array<string | undefined> = [];
  const ports = {
    clock: () => now,
    phase: (phase: Phase) => {
      phases.push(phase);
    },
    assignment: async () => {
      calls.push("assignment");
      if (failure === "assignment") throw Error("synthetic");
      return { payload: { authenticated: "synthetic" }, deadline };
    },
    execute: async (
      command: { executable: string; args: readonly string[] },
      stdin?: string,
    ) => {
      const phase =
        command.executable === "gh" ? "ready" : (command.executable as Phase);
      calls.push(phase);
      inputs.push(stdin);
      if (phase === failure) throw Error("synthetic_nonzero_exit");
      if (phase === "mint")
        return invalidMint
          ? "{}"
          : JSON.stringify({
              path: "/synthetic/packet.json",
              sha256: "d".repeat(64),
              approvalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              expiresAt: new Date(now + 900_000).toISOString(),
            });
      if (phase === "owner")
        assert.deepEqual(command.args, [
          plan.owner.path,
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          new Date(now + 900_000).toISOString(),
        ]);
      return "";
    },
  };
  return { calls, phases, inputs, ports };
}
for (const failure of [
  "ready",
  "assignment",
  "observe",
  "mint",
  "compose",
  "probe",
] as const) {
  test(`stop at ${failure}; no owner or phase retry`, async () => {
    const h = harness(failure);
    await assert.rejects(
      contiguousLaunch(plan, h.ports),
      new RegExp(`unconfirmed_${failure}$`),
    );
    const all: Phase[] = [
      "ready",
      "assignment",
      "observe",
      "mint",
      "compose",
      "probe",
      "owner",
    ];
    assert.deepEqual(h.calls, all.slice(0, all.indexOf(failure) + 1));
    assert.equal(h.calls.includes("owner"), false);
  });
}
test("contiguous success: one phase each; stdin JSON and pinned owner arguments", async () => {
  const h = harness();
  await contiguousLaunch(plan, h.ports);
  assert.deepEqual(h.calls, [
    "ready",
    "assignment",
    "observe",
    "mint",
    "compose",
    "probe",
    "owner",
  ]);
  assert.deepEqual(h.phases, h.calls);
  assert.equal(h.inputs[1], JSON.stringify({ authenticated: "synthetic" }));
  assert.equal(
    h.inputs
      .filter((_, index) => index !== 1)
      .every((value) => value === undefined),
    true,
  );
});
test("invalid mint reference stops before Compose", async () => {
  const h = harness(undefined, true);
  await assert.rejects(contiguousLaunch(plan, h.ports), /unconfirmed_mint$/);
  assert.deepEqual(h.calls, ["ready", "assignment", "observe", "mint"]);
});
test("expired original window does not observe or mint", async () => {
  const h = harness(undefined, false, now);
  await assert.rejects(
    contiguousLaunch(plan, h.ports),
    /unconfirmed_assignment$/,
  );
  assert.deepEqual(h.calls, ["ready", "assignment"]);
});
test("owner failure is terminal, never reconnects", async () => {
  const h = harness("owner");
  await assert.rejects(contiguousLaunch(plan, h.ports), /unconfirmed_owner$/);
  assert.equal(h.calls.filter((phase) => phase === "owner").length, 1);
});
test("authenticated assignment uses exact transfer STEP deadline, not job/observation", async () => {
  const apiCalls: string[] = [];
  const run = {
    id: 123,
    run_number: 999,
    run_attempt: 1,
    workflow_id: plan.workflowId,
    head_sha: plan.head,
    status: "in_progress",
  };
  const api = async (cmd: { args: readonly string[] }) => {
    const endpoint = cmd.args[1]!;
    apiCalls.push(endpoint);
    if (endpoint.includes("workflows/"))
      return JSON.stringify({ workflow_runs: [run] });
    if (endpoint.includes("/jobs?"))
      return JSON.stringify({
        jobs: [
          {
            name: plan.expectedJobName,
            runner_id: 456,
            status: "in_progress",
            started_at: new Date(now - 110_000).toISOString(),
            steps: [
              {
                name: plan.expectedStepName,
                status: "in_progress",
                started_at: new Date(now - 60_000).toISOString(),
              },
            ],
          },
        ],
      });
    if (endpoint.includes("/pulls/")) return JSON.stringify({ number: 4 });
    return JSON.stringify(run);
  };
  const result = await authenticateAssignment(
    plan,
    api,
    () => now,
    async () => {
      throw Error("unexpected_poll");
    },
  );
  assert.equal(result.deadline, now + 60_000);
  assert.equal(apiCalls.length, 4);
  assert.equal(
    apiCalls.every((path) => path.startsWith(`repos/${plan.repository}/`)),
    true,
  );
  assert.deepEqual(result.payload.run, run);
});
for (const override of [{ head_sha: "e".repeat(40) }, { run_attempt: 2 }]) {
  test(`authenticated discovery rejects ${Object.keys(override)[0]} before later phases`, async () => {
    let calls = 0;
    await assert.rejects(
      authenticateAssignment(
        plan,
        async () => {
          calls++;
          return JSON.stringify({
            workflow_runs: [
              {
                id: 123,
                run_number: 999,
                run_attempt: 1,
                head_sha: plan.head,
                status: "in_progress",
                ...override,
              },
            ],
          });
        },
        () => now,
        async () => {
          throw Error("unexpected_poll");
        },
      ),
      /assignment_invalid/,
    );
    assert.equal(calls, 1);
  });
}
test("actual synthetic subprocess receives JSON stdin and nonzero exit is terminal", async () => {
  const input = JSON.stringify({ synthetic: "public_TEST_metadata" });
  const result = await execute(
    {
      executable: process.execPath,
      args: [
        "-e",
        "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const v=JSON.parse(s);process.stdout.write(JSON.stringify({received:v.synthetic}));});",
      ],
    },
    input,
  );
  assert.deepEqual(JSON.parse(result), { received: "public_TEST_metadata" });
  await assert.rejects(
    execute({ executable: process.execPath, args: ["-e", "process.exit(7)"] }),
    /command_unconfirmed/,
  );
});
test("long queue pins authenticated run; ONE READY then exact original STEP deadline", async () => {
  let clock = now;
  let waits = 0;
  let listings = 0;
  let deadline: number | undefined;
  const h = harness();
  h.ports.clock = () => clock;
  const api = async (cmd: { args: readonly string[] }) => {
    const endpoint = cmd.args[1]!;
    const running = waits === 3;
    const run = {
      id: 123,
      run_number: 999,
      run_attempt: 1,
      workflow_id: plan.workflowId,
      head_sha: plan.head,
      status: running ? "in_progress" : "queued",
    };
    if (endpoint.includes("workflows/")) {
      listings++;
      assert.equal(
        listings,
        1,
        "never rediscover/adopt a different run after pinning",
      );
      return JSON.stringify({ workflow_runs: [run] });
    }
    if (endpoint.includes("/jobs?"))
      return JSON.stringify({
        jobs: running
          ? [
              {
                name: plan.expectedJobName,
                runner_id: 456,
                status: "in_progress",
                steps: [
                  {
                    name: plan.expectedStepName,
                    status: "in_progress",
                    started_at: new Date(clock).toISOString(),
                  },
                ],
              },
            ]
          : [],
      });
    if (endpoint.includes("/pulls/")) return JSON.stringify({ number: 4 });
    assert.equal(endpoint, `repos/${plan.repository}/actions/runs/123`);
    return JSON.stringify(run);
  };
  const assignment = async () => {
    h.calls.push("assignment");
    const result = await authenticateAssignment(
      plan,
      api,
      () => clock,
      async (ms) => {
        assert.equal(ms, 2000);
        waits++;
        assert.ok(waits <= 3);
        // Synthetic slow read-only API/queue time, no actual sleep or network.
        clock += 130_000;
      },
    );
    deadline = result.deadline;
    return result;
  };
  await contiguousLaunch(plan, { ...h.ports, assignment });
  assert.equal(waits, 3);
  assert.equal(clock - now, 390_000);
  assert.equal(deadline, now + 390_000 + 120_000);
  assert.deepEqual(h.calls, [
    "ready",
    "assignment",
    "observe",
    "mint",
    "compose",
    "probe",
    "owner",
  ]);
  assert.equal(h.calls.filter((phase) => phase === "ready").length, 1);
});
