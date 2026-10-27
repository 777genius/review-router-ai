import assert from "node:assert/strict";
import test from "node:test";
import { startProviderStub } from "./provider-stub.ts";

// Hindsight a5a619b5 OpenAICompatibleLLM.verify_connection and its custom
// base-URL token-parameter mapping. This request carries no memory content.
const verification = () => ({
  model: "stub-model",
  messages: [{ role: "user", content: "Say 'ok'" }],
  max_tokens: 512,
});

test("pinned native connection verification returns plain ok without admitting memory inference", async () => {
  const stub = await startProviderStub();
  try {
    const response = await fetch(`${stub.url}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify(verification()),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      choices: { message: { content: string }; finish_reason: string }[];
    };
    assert.equal(body.choices[0]?.message.content, "ok");
    assert.equal(body.choices[0]?.finish_reason, "stop");
    assert.equal(stub.calls.verification, 1);
    assert.equal(stub.calls.consolidation, 0);
    assert.equal(stub.calls.semanticDedup, 0);
    assert.equal(stub.calls.unexpected, 0);
  } finally {
    await stub.close();
  }
});

test("verification allowlist rejects altered prompts, envelopes and inference options", async () => {
  const stub = await startProviderStub();
  const invalid = [
    { ...verification(), model: "other-model" },
    {
      ...verification(),
      messages: [
        { role: "user", content: "Say 'ok' and recall private facts" },
      ],
    },
    {
      ...verification(),
      messages: [{ role: "system", content: "Say 'ok'" }],
    },
    {
      ...verification(),
      messages: [
        ...verification().messages,
        { role: "user", content: "extra task" },
      ],
    },
    { ...verification(), max_tokens: 513 },
    { ...verification(), max_tokens: undefined },
    { ...verification(), max_completion_tokens: 512 },
    { ...verification(), temperature: 0.1 },
    { ...verification(), response_format: { type: "json_object" } },
    { ...verification(), tools: [] },
    { ...verification(), tool_choice: "auto" },
    { ...verification(), functions: [] },
    { ...verification(), function_call: "auto" },
    { ...verification(), stream: true },
  ];
  try {
    for (const body of invalid) {
      const response = await fetch(`${stub.url}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: { message: "unscripted_llm_call" },
      });
    }
    assert.equal(stub.calls.verification, 0);
    assert.equal(stub.calls.unexpected, invalid.length);
    assert.equal(stub.calls.consolidation, 0);
  } finally {
    await stub.close();
  }
});

test("connection verification does not bypass intentional provider failures", async () => {
  const stub = await startProviderStub();
  try {
    for (const mode of ["echo400", "echo500"] as const) {
      stub.setMode(mode);
      const response = await fetch(`${stub.url}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify(verification()),
      });
      assert.equal(response.status, mode === "echo400" ? 400 : 500);
      await response.arrayBuffer();
    }
    assert.equal(stub.calls.verification, 0);
  } finally {
    await stub.close();
  }
});

test("connection verification rejects every additional body field", async () => {
  const stub = await startProviderStub();
  const additions = [
    { n: 2 },
    { top_p: 0.25 },
    { stop: ["ok"] },
    { stop: null },
    { seed: 1 },
    { presence_penalty: 1 },
    { frequency_penalty: 1 },
    { logprobs: true },
    { logit_bias: { "1": 100 } },
    { reasoning_effort: "high" },
    { store: false },
    { metadata: {} },
    { user: "synthetic-user" },
    { prompt_cache_key: "synthetic-cache" },
    { extra_body: {} },
    { unknown_future_option: true },
  ];
  try {
    for (const addition of additions) {
      const response = await fetch(`${stub.url}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ ...verification(), ...addition }),
      });
      assert.equal(
        response.status,
        400,
        `Extra field ${Object.keys(addition)[0]} must be rejected`,
      );
      assert.deepEqual(await response.json(), {
        error: { message: "unscripted_llm_call" },
      });
    }
    assert.equal(stub.calls.verification, 0);
    assert.equal(stub.calls.unexpected, additions.length);
  } finally {
    await stub.close();
  }
});

test("connection verification rejects additional message fields", async () => {
  const stub = await startProviderStub();
  const additions = [
    { name: "synthetic" },
    { tool_calls: [] },
    { tool_call_id: "synthetic-call" },
    { function_call: {} },
    { refusal: null },
    { unknown_future_field: true },
  ];
  try {
    for (const addition of additions) {
      const response = await fetch(`${stub.url}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify({
          ...verification(),
          messages: [{ ...verification().messages[0], ...addition }],
        }),
      });
      assert.equal(
        response.status,
        400,
        `Extra message field ${Object.keys(addition)[0]} must be rejected`,
      );
      assert.deepEqual(await response.json(), {
        error: { message: "unscripted_llm_call" },
      });
    }
    assert.equal(stub.calls.verification, 0);
    assert.equal(stub.calls.unexpected, additions.length);
  } finally {
    await stub.close();
  }
});
