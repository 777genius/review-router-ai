import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";

type ReusableConflictWorkflow = {
  on: { workflow_call: { secrets: Record<string, { required: boolean }> } };
  jobs: Record<
    string,
    {
      env: Record<string, string>;
      steps: readonly {
        name: string;
        if?: string;
        env?: Record<string, string>;
      }[];
    }
  >;
};

it("declares the MiMo caller secret and confines it to conflict execution", () => {
  const workflow = parse(
    readFileSync(
      join(
        process.cwd(),
        ".github/workflows/reviewrouter-conflict-reusable.yml",
      ),
      "utf8",
    ),
  ) as ReusableConflictWorkflow;
  expect(
    workflow.on.workflow_call.secrets.MIMO_TOKEN_PLAN_API_KEY?.required,
  ).toBe(false);
  const job = workflow.jobs["conflict-review"]!;
  expect(job.env.MIMO_TOKEN_PLAN_API_KEY).toBeUndefined();
  expect(job.env.MIMO_TOKEN_PLAN_API_KEY_PRESENT).toBe(
    "${{ secrets.MIMO_TOKEN_PLAN_API_KEY != '' && '1' || '0' }}",
  );
  expect(
    job.steps.find((step) => step.name === "Install Codex CLI")?.if,
  ).toContain("env.MIMO_TOKEN_PLAN_API_KEY_PRESENT == '1'");
  const credentialSteps = job.steps.filter(
    (step) => step.env?.MIMO_TOKEN_PLAN_API_KEY,
  );
  expect(credentialSteps).toHaveLength(1);
  expect(credentialSteps[0]?.name).toBe("Run conflict review runtime");
  expect(credentialSteps[0]?.env?.MIMO_TOKEN_PLAN_API_KEY).toBe(
    "${{ secrets.MIMO_TOKEN_PLAN_API_KEY }}",
  );
});
