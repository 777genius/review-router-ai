import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function replace(text: string, before: string, after: string): string {
  if (text.split(before).length !== 2)
    throw new Error("Pinned strict-preview anchor mismatch");
  return text.replace(before, after);
}
/** Exact pin; dry-run-only control/error changes, no normal-retain behavior change. */
export function strictPreviewPatch(path: string, text: string): string {
  if (path === "api/http.py") {
    text = replace(
      text,
      "class DryRunExtractRequest(BaseModel):",
      'class DryRunExtractRequest(BaseModel):\n    strict_preview: bool = Field(default=False, description="One complete chunk; no split or retries.")\n',
    );
    return replace(
      text,
      "            return await app.state.memory.extract_dry_run(\n",
      "            from hindsight_api.strict_preview import run as run_strict_preview\n\n            return await run_strict_preview(body.strict_preview, app.state.memory.extract_dry_run,\n",
    );
  }
  if (path !== "engine/retain/fact_extraction.py") return text;
  text = replace(
    text,
    "import asyncio\n",
    "import asyncio\nfrom hindsight_api.strict_preview import active as strict_preview_active\n",
  );
  text = replace(
    text,
    "    outer_attempts = llm_max_retries + 1",
    "    outer_attempts = 1 if strict_preview_active() else llm_max_retries + 1",
  );
  text = replace(
    text,
    "            extraction_call = await llm_config.call(**call_kwargs)",
    '            if strict_preview_active():\n                if len(getattr(llm_config, "members", [llm_config])) != 1:\n                    raise ValueError("strict_preview_single_provider_required")\n                call_kwargs["max_retries"] = 0\n            extraction_call = await llm_config.call(**call_kwargs)',
  );
  text = replace(
    text,
    "            return chunk_facts, usage",
    '            if strict_preview_active() and (has_malformed_facts or len(chunk_facts) != len(raw_facts)):\n                raise ValueError("strict_preview_dropped_facts")\n            return chunk_facts, usage',
  );
  text = replace(
    text,
    "    except OutputTooLongError:\n",
    "    except OutputTooLongError:\n        if strict_preview_active():\n            raise\n",
  );
  text = replace(
    text,
    "    # Log chunk count before starting LLM requests",
    '    if strict_preview_active() and len(chunks) != 1:\n        raise ValueError("strict_preview_requires_one_chunk")\n\n    # Log chunk count before starting LLM requests',
  );
  return text;
}
export async function prepareStrictPreview(
  source: string,
  root: string,
  files: Record<string, { before: string; after: string }>,
) {
  const path = "engine/retain/fact_extraction.py";
  const before = await readFile(
    join(source, "hindsight-api-slim/hindsight_api", path),
    "utf8",
  );
  if (
    createHash("sha256").update(before).digest("hex") !==
    "a11d4819fa5eb57ad12a8bdb952e22cdf32f9ee05b48f2cca1d2c2bfa0dd360b"
  )
    throw new Error("Modified strict-preview upstream input");
  files[path] = { before, after: strictPreviewPatch(path, before) };
  files["api/http.py"]!.after = strictPreviewPatch(
    "api/http.py",
    files["api/http.py"]!.after,
  );
  files["strict_preview.py"] = {
    before: "",
    after: await readFile(
      join(root, "deploy/hindsight/strict-preview.py"),
      "utf8",
    ),
  };
}
