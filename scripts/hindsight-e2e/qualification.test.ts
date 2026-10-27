import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  embedding,
  dimensions,
  privacySentinel,
  startProviderStub,
} from "./provider-stub.ts";
import { prepare } from "./prepare-hardening.ts";

test("deterministic lexical vectors are finite, normalized and multilingual", () => {
  const vector = embedding("Reviewed transactional правило");
  assert.equal(vector.length, dimensions);
  assert(vector.every(Number.isFinite));
  assert(
    Math.abs(vector.reduce((sum, value) => sum + value * value, 0) - 1) < 1e-12,
  );
  assert.deepEqual(vector, embedding("Reviewed transactional правило"));
  assert.notDeepEqual(vector, embedding("unrelated source"));
});

test("provider stub fails unscripted calls and supplies intentional private error echoes", async () => {
  const stub = await startProviderStub();
  try {
    const unknown = await fetch(`${stub.url}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "An unscripted semantic task" }],
      }),
    });
    assert.equal(unknown.status, 400);
    assert.equal(stub.calls.unexpected, 1);
    assert.equal(stub.unexpectedByReason.unrelatedChatPrompt, 1);
    const pinnedExtractionSystem = await fetch(
      `${stub.url}/v1/chat/completions`,
      {
        method: "POST",
        body: JSON.stringify({
          model: "stub-model",
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Extract SIGNIFICANT facts from text. Be SELECTIVE - only extract facts worth remembering long-term.",
            },
            { role: "user", content: "Synthetic fixture only." },
          ],
        }),
      },
    );
    assert.equal(pinnedExtractionSystem.status, 400);
    assert.equal(stub.calls.unexpected, 2);
    assert.equal(stub.unexpectedByReason.unrelatedRetainExtraction, 1);
    assert.equal(stub.unexpectedByReason.unrelatedSystemFirst, 1);
    assert.equal(stub.unexpectedByReason.unrelatedMultipleMessages, 1);
    assert.equal(stub.unexpectedByReason.unrelatedJsonObjectMode, 1);
    for (const mode of ["echo400", "echo500"] as const) {
      stub.setMode(mode);
      const response = await fetch(`${stub.url}/v1/embeddings`, {
        method: "POST",
        body: JSON.stringify({ input: [privacySentinel] }),
      });
      assert.equal(response.status, mode === "echo400" ? 400 : 500);
      assert((await response.text()).includes(privacySentinel));
    }
  } finally {
    await stub.close();
  }
});

test("pinned semantic dedup verdict and unscripted chat rejection", async () => {
  const stub = await startProviderStub();
  const send = (content: string, softSchema = false) =>
    fetch(`${stub.url}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify({
        model: "stub-model",
        messages: [{ role: "user", content }],
        ...(softSchema ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  try {
    const prompt = `You reconcile long-term memory observations. A NEW observation is about to be stored, and it is highly similar to an EXISTING one:

[NEW] Approved rule about transactional writes
[EXISTING] Approved rule about repository isolation

Respond with ONLY one valid JSON object matching one of these shapes:`;
    const response = await send(prompt);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    assert.deepEqual(JSON.parse(body.choices[0]!.message.content), {
      action: "keep",
      text: "",
      reason: "synthetic fixture keeps distinct observations",
    });
    // Hindsight 1.1.0 OpenAI-compatible soft schema prepends the Pydantic
    // JSON schema to the exact dedup prompt, preserving a single user message.
    const softSchemaPrompt = `\n\nYou must respond with valid JSON matching this schema:\n${JSON.stringify(
      {
        type: "object",
        properties: {
          action: { type: "string" },
          text: { type: "string" },
          reason: { type: "string" },
        },
      },
      null,
      2,
    )}\n\n${prompt}`;
    const wrappedResponse = await send(softSchemaPrompt, true);
    assert.equal(wrappedResponse.status, 200);
    // Pinned OpenAICompatibleLLM adds this lowercase-json hint before the
    // already schema-prefixed user message in json_object mode.
    const jsonHintWrapped = `Return valid json only.\n\n${softSchemaPrompt}`;
    assert.equal((await send(jsonHintWrapped, true)).status, 200);
    assert.equal(stub.calls.semanticDedup, 3);
    assert.equal(stub.calls.unexpected, 0);
    assert.equal((await send(softSchemaPrompt)).status, 400);
    assert.equal(
      (await send(prompt.replace("[EXISTING]", "[OTHER]"))).status,
      400,
    );
    assert.equal(
      (await send(`Return valid json only.\n\n${prompt}`, true)).status,
      400,
    );
    assert.equal(
      (await send(`unreviewed prefix\n\n${softSchemaPrompt}`, true)).status,
      400,
    );
    assert.equal(stub.calls.unexpected, 4);
    assert.equal(stub.unexpectedByReason.dedupFormatMismatch, 1);
    assert.equal(stub.unexpectedByReason.dedupMarkersMissing, 1);
    assert.equal(stub.unexpectedByReason.dedupPrefixMismatch, 2);
    assert.equal(stub.unexpectedByReason.dedupInstructionMissing, 0);
  } finally {
    await stub.close();
  }
});

test("privacy sink removes fstrings, exception bodies, tracebacks, extras and uncaught errors", () => {
  const privacy = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../deploy/hindsight/native-privacy.py",
  );
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import importlib.util,logging,sys,types,warnings
spec=importlib.util.spec_from_file_location('native_privacy',sys.argv[1])
privacy=importlib.util.module_from_spec(spec); spec.loader.exec_module(privacy)
privacy.install(); privacy.install()
secret='RR_NATIVE_PRIVATE_5C36E924'
logging.basicConfig(level=logging.DEBUG)
warnings.warn(secret)
try:
 raise RuntimeError(secret)
except RuntimeError as error:
 original=str(error)
 logging.getLogger('synthetic.native').error(f'query={secret}',extra={'private_payload':secret},exc_info=True)
 assert str(error)==original
 record=logging.getLogger('synthetic.native').makeRecord('synthetic.native',40,'fixed.py',123,secret,(),(type(error),error,error.__traceback__),extra={'private_payload':secret})
 assert 'private_payload' not in record.__dict__
 assert record.exc_info is None and record.stack_info is None
 sys.excepthook(type(error),error,error.__traceback__)
 threading_args=types.SimpleNamespace(exc_type=type(error),exc_value=error,exc_traceback=error.__traceback__)
 import threading
 threading.excepthook(threading_args)
 print('safe_sink_verified')
`,
      privacy,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(
    result.status,
    0,
    `Python privacy sink probe did not complete: signal=${result.signal ?? "none"} spawnError=${(result.error as NodeJS.ErrnoException | undefined)?.code ?? "none"}`,
  );
  const output = result.stdout + result.stderr;
  assert(!output.includes(privacySentinel));
  assert(output.includes("RuntimeError"));
  assert(output.includes("native_event="));
  assert(output.includes("safe_sink_verified"));
});

test(
  "pinned native readiness error exposes its class without the poisoned DB message",
  { skip: !process.env.HINDSIGHT_SOURCE_CHECKOUT },
  async () => {
    const { files } = await prepare(process.env.HINDSIGHT_SOURCE_CHECKOUT!);
    const source = files["engine/memory_engine.py"]!.after;
    const start = source.indexOf("    async def health_check(self)");
    const end = source.indexOf("    @staticmethod", start);
    assert(start >= 0 && end > start);
    const healthMethod = source
      .slice(start, end)
      .split("\n")
      .map((line) => (line.startsWith("    ") ? line.slice(4) : line))
      .join("\n");
    const code = `import asyncio,time\n${healthMethod}\nclass Probe:\n _initialized=True\n async def _get_backend(self): raise RuntimeError('RR_NATIVE_PRIVATE_5C36E924')\n health_check=health_check\nresult=asyncio.run(Probe().health_check())\nassert result=={'status':'unhealthy','database':'error','error':'RuntimeError'}\nprint('private_health_verified')\n`;
    const result = spawnSync("python3", ["-c", code], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(
      result.status,
      0,
      `Python native readiness probe did not complete: signal=${result.signal ?? "none"} spawnError=${(result.error as NodeJS.ErrnoException | undefined)?.code ?? "none"}`,
    );
    assert.equal(result.stdout.trim(), "private_health_verified");
    assert(!(result.stdout + result.stderr).includes(privacySentinel));
  },
);

test("scripted consolidation update uses real candidate identity and refuses a missing candidate", async () => {
  const stub = await startProviderStub();
  const observation = "11111111-1111-4111-8111-111111111111";
  const fact = "22222222-2222-4222-8222-222222222222";
  try {
    stub.setObservationUpdateFixture({
      observationId: observation,
      sourceMarker: "supporting-fixture",
    });
    const send = (candidate: string) =>
      fetch(`${stub.url}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify({
          model: "stub-model",
          messages: [
            {
              role: "user",
              content: `### New facts\n[${fact}] supporting-fixture\n### Existing observations\n${candidate}`,
            },
          ],
        }),
      });
    const accepted = await send(observation);
    assert.equal(accepted.status, 200);
    const completion = (await accepted.json()) as {
      choices: { message: { content: string } }[];
    };
    const actions = JSON.parse(completion.choices[0]!.message.content);
    assert.deepEqual(actions.creates, []);
    assert.equal(actions.updates[0].observation_id, observation);
    assert.deepEqual(actions.updates[0].source_fact_ids, [fact]);
    assert.equal(
      (await send("No candidate supplied by native retrieval")).status,
      400,
    );
    assert.equal(stub.calls.unexpected, 1);
  } finally {
    await stub.close();
  }
});

test(
  "pinned native worker config stays stale after another process edits it and a worker restart restores consolidation enqueue",
  { skip: !process.env.HINDSIGHT_SOURCE_CHECKOUT },
  () => {
    const source = resolve(
      process.env.HINDSIGHT_SOURCE_CHECKOUT!,
      "hindsight-api-slim/hindsight_api",
    );
    const config = readFileSync(resolve(source, "config.py"), "utf8");
    assert(config.includes("DEFAULT_BANK_INFO_CACHE_TTL_SECONDS = 30.0"));
    assert(
      config.includes("DEFAULT_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS = 300"),
    );
    const result = spawnSync(
      "python3",
      [
        "-c",
        `
from __future__ import annotations
import asyncio,hashlib,importlib.util,logging,sys,textwrap,types
from pathlib import Path
root=Path(sys.argv[1])
expected={
 'engine/bank_stats_cache.py':'77683f8730c70f72ddd799bb97ce752bd45da0157946a656a983e45c4ece2119',
 'engine/bank_info_cache.py':'c596d593d22477b56a005a367d20230603f63b5b6e19cfaa1caa9c708864e34a',
 'engine/memory_engine.py':'44d4f173e5eaf5644390055c2ed55aa254ecea635d2dec870cf949b38de33a5b',
}
for name,digest in expected.items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
for name in ['hindsight_api','hindsight_api.engine']:
 module=types.ModuleType(name); module.__path__=[]; sys.modules[name]=module
config=types.ModuleType('hindsight_api.config')
config.get_config=lambda:types.SimpleNamespace(bank_info_cache_ttl_seconds=30.0,bank_info_cache_max_entries=2048)
sys.modules[config.__name__]=config
# Only the unused distributed-cache backend dependency is stubbed. Both cache
# implementations and the post-insert enqueue gate below are exact native code.
db=types.ModuleType('hindsight_api.engine.db_utils')
def unexpected_backend(*args,**kwargs): raise AssertionError('unused_distributed_backend_called')
db.acquire_with_retry=unexpected_backend; sys.modules[db.__name__]=db
engine=types.ModuleType('hindsight_api.engine.memory_engine')
engine.get_current_schema=lambda:'public'; sys.modules[engine.__name__]=engine
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,root/file)
 module=importlib.util.module_from_spec(spec); sys.modules[name]=module
 spec.loader.exec_module(module); return module
load('hindsight_api.engine.bank_stats_cache','engine/bank_stats_cache.py')
def process_cache():
 return load('hindsight_api.engine.bank_info_cache','engine/bank_info_cache.py')
text=(root/'engine/memory_engine.py').read_text()
start=text.index('    async def _submit_post_insert_maintenance(')
end=text.index('    async def _submit_vector_index_maintenance_quietly(',start)
namespace={'logger':logging.getLogger('native-cache-regression')}
exec('from __future__ import annotations\\n'+textwrap.dedent(text[start:end]),namespace)
stored={'enable_observations':False,'enable_auto_consolidation':False}
class Worker:
 _submit_post_insert_maintenance=namespace['_submit_post_insert_maintenance']
 def __init__(self,cache):
  self.cache=cache; self.enqueued=0
  self._config_resolver=types.SimpleNamespace(resolve_full_config=self.resolve)
 async def resolve(self,bank,context):
  async def read(): return {'config':dict(stored)}
  row=await self.cache.get_or_load(bank,'config',read)
  return types.SimpleNamespace(**row['config'])
 async def submit_async_consolidation(self,**kwargs): self.enqueued+=1
 async def submit_async_graph_maintenance(self,**kwargs): pass
 async def _submit_vector_index_maintenance_quietly(self,*args,**kwargs): pass
async def main():
 api=process_cache(); workers=[Worker(process_cache()),Worker(process_cache())]
 for worker in workers:
  await worker._submit_post_insert_maintenance('fixture-bank',object())
  assert worker.enqueued==0
 stored.update(enable_observations=True,enable_auto_consolidation=True)
 await api.invalidate('fixture-bank','config')
 for worker in workers:
  await worker._submit_post_insert_maintenance('fixture-bank',object())
  assert worker.enqueued==0,'API invalidation must not clear another process cache'
 restarted=[Worker(process_cache()),Worker(process_cache())]
 for worker in restarted:
  await worker._submit_post_insert_maintenance('fixture-bank',object())
  assert worker.enqueued==1,'fresh worker must enqueue the malformed-output probe'
 print('native_worker_config_restart_verified')
asyncio.run(main())
`,
        source,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(
      result.status,
      0,
      `Pinned native cache regression did not complete: exit=${result.status ?? "null"} signal=${result.signal ?? "none"} spawnError=${(result.error as NodeJS.ErrnoException | undefined)?.code ?? "none"}`,
    );
    assert.equal(result.stdout.trim(), "native_worker_config_restart_verified");
  },
);
