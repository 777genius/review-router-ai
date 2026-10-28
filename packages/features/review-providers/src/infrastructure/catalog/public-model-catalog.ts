import {
  gatewayModelSchema,
  type ProviderKind,
} from "../../domain/provider-catalog";
import {
  localCatalogModels,
  type PublicCatalogProvider,
  type ProviderCatalogModel,
  type ProviderModelCatalogSnapshot,
} from "../../domain/provider-model-catalog";
import type { ProviderModelCatalogPort } from "../../application/ports/provider-model-catalog-port";

export const publicCatalogPolicy = {
  ttlMs: 1_800_000,
  cooldownMs: 300_000,
  staleMs: 86_400_000,
  manualMs: 60_000,
  timeoutMs: 4_000,
  maxBytes: 16 * 1024 * 1024,
};
type Section = {
  models: readonly ProviderCatalogModel[] | null;
  fetchedAt: number | null;
  lastAttemptAt: number | null;
  error: ProviderModelCatalogSnapshot["error"];
  cooldownUntil: number;
  skippedModelCount: number;
};
type Source = {
  pending: Promise<void> | null;
  manualAt: number | null;
  cooldownUntil: number;
};
const urls = {
  models: "https://models.dev/api.json",
  openrouter: "https://openrouter.ai/api/v1/models",
} as const;
export class PublicProviderModelCatalogAdapter implements ProviderModelCatalogPort {
  private readonly sections = new Map<ProviderKind, Section>();
  private readonly sources: Record<keyof typeof urls, Source> = {
    models: { pending: null, manualAt: null, cooldownUntil: 0 },
    openrouter: { pending: null, manualAt: null, cooldownUntil: 0 },
  };
  constructor(
    private readonly dependencies: {
      readonly fetchImpl?: typeof fetch;
      readonly now?: () => number;
      readonly policy?: typeof publicCatalogPolicy;
      readonly normalize?: typeof normalizePublicCatalog;
    } = {},
  ) {}
  private now() {
    return this.dependencies.now?.() ?? Date.now();
  }
  private section(provider: ProviderKind): Section {
    let section = this.sections.get(provider);
    if (!section) {
      section = {
        models: null,
        fetchedAt: null,
        lastAttemptAt: null,
        error: null,
        cooldownUntil: 0,
        skippedModelCount: 0,
      };
      this.sections.set(provider, section);
    }
    return section;
  }
  async listModels(input: {
    readonly providerKind: ProviderKind;
    readonly signal?: AbortSignal;
    readonly forceRefresh?: boolean;
  }): Promise<ProviderModelCatalogSnapshot> {
    input.signal?.throwIfAborted();
    const provider = input.providerKind;
    if (provider === "codex-mimo")
      return {
        providerKind: provider,
        models: localCatalogModels(provider),
        source: "local",
        fetchedAt: null,
        lastAttemptAt: null,
        state: "fallback",
        error: null,
        refresh: "cached",
      };
    const section = this.section(provider);
    const sourceKey = provider === "openrouter" ? "openrouter" : "models";
    const source = this.sources[sourceKey];
    const policy = this.dependencies.policy ?? publicCatalogPolicy;
    const now = this.now();
    let refresh: ProviderModelCatalogSnapshot["refresh"] = "cached";
    const fresh =
      section.fetchedAt !== null && now - section.fetchedAt < policy.ttlMs;
    if (source.pending) {
      await waitForConsumer(source.pending, input.signal);
      refresh = section.error === null ? "updated" : "failed";
    } else if (!fresh || input.forceRefresh) {
      const cooldown =
        source.cooldownUntil > now ||
        section.cooldownUntil > now ||
        (input.forceRefresh &&
          source.manualAt !== null &&
          now - source.manualAt < policy.manualMs);
      if (cooldown) refresh = "cooldown";
      else {
        if (input.forceRefresh) source.manualAt = now;
        const pending = this.refresh(sourceKey).finally(() => {
          source.pending = null;
        });
        source.pending = pending;
        await waitForConsumer(pending, input.signal);
        refresh = section.error === null ? "updated" : "failed";
      }
    }
    input.signal?.throwIfAborted();
    const age =
      section.fetchedAt === null ? Infinity : this.now() - section.fetchedAt;
    const usable = section.models !== null && age <= policy.staleMs;
    const fallback = localCatalogModels(provider);
    return {
      providerKind: provider,
      models: usable ? section.models! : fallback,
      source: usable
        ? sourceKey === "models"
          ? "models.dev"
          : "openrouter"
        : "local",
      fetchedAt: section.fetchedAt,
      lastAttemptAt: section.lastAttemptAt,
      state: usable
        ? age < policy.ttlMs
          ? "fresh"
          : "stale"
        : fallback.length
          ? "fallback"
          : "unavailable",
      error: section.error,
      refresh,
      skippedModelCount: section.skippedModelCount,
    };
  }
  private async refresh(sourceKey: keyof typeof urls): Promise<void> {
    const policy = this.dependencies.policy ?? publicCatalogPolicy;
    const providers: readonly PublicCatalogProvider[] =
      sourceKey === "models" ? ["codex", "claude"] : ["openrouter"];
    const attemptedAt = this.now();
    for (const provider of providers)
      this.section(provider).lastAttemptAt = attemptedAt;
    let raw: unknown;
    try {
      raw = await fetchPublicCatalog(
        urls[sourceKey],
        this.dependencies.fetchImpl ?? fetch,
        policy,
      );
    } catch {
      this.sources[sourceKey].cooldownUntil = this.now() + policy.cooldownMs;
      for (const provider of providers)
        this.section(provider).error = "source_unavailable";
      return;
    }
    this.sources[sourceKey].cooldownUntil = 0;
    for (const provider of providers) {
      const section = this.section(provider);
      try {
        let skippedModelCount = 0;
        const models = (this.dependencies.normalize ?? normalizePublicCatalog)(
          raw,
          provider,
          () => {
            skippedModelCount += 1;
          },
        );
        Object.assign(section, {
          models,
          fetchedAt: this.now(),
          error: null,
          cooldownUntil: 0,
          skippedModelCount,
        });
      } catch {
        section.error = "invalid_section";
        section.cooldownUntil = this.now() + policy.cooldownMs;
      }
    }
  }
}

async function waitForConsumer<T>(
  pending: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return pending;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
export async function fetchPublicCatalog(
  url: (typeof urls)[keyof typeof urls],
  fetchImpl: typeof fetch,
  policy = publicCatalogPolicy,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "ReviewRouter public-model-catalog/1.0",
      },
      redirect: "error",
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error("catalog_http_failure");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > policy.maxBytes) {
          await reader.cancel();
          throw new Error("catalog_too_large");
        }
        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function boundedNumber(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : null;
}
function contextTokens(value: unknown): number | null {
  const number = boundedNumber(value);
  return number !== null && Number.isInteger(number) && number > 0
    ? number
    : null;
}
function modality(value: unknown): boolean | null {
  return Array.isArray(value) ? value.includes("text") : null;
}
function outputModality(value: unknown): boolean | null {
  return Array.isArray(value)
    ? value.length === 1 && value[0] === "text"
    : null;
}
function price(value: unknown, multiplier: number): number | null {
  const parsed =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  const number = boundedNumber(parsed);
  return number !== null ? boundedNumber(number * multiplier) : null;
}
export function normalizePublicCatalog(
  raw: unknown,
  provider: PublicCatalogProvider,
  onInvalidRow?: () => void,
): readonly ProviderCatalogModel[] {
  const root = record(raw);
  const section =
    provider === "openrouter"
      ? root?.data
      : record(
          record(root?.[provider === "codex" ? "openai" : "anthropic"])?.models,
        );
  const rows =
    provider === "openrouter"
      ? Array.isArray(section)
        ? section
        : null
      : section
        ? Object.values(section)
        : null;
  if (!rows) throw new Error("catalog_invalid_section");
  const models = new Map<string, ProviderCatalogModel>();
  for (const value of rows) {
    const row = record(value);
    if (
      !row ||
      typeof row.id !== "string" ||
      row.id.length > 200 ||
      !gatewayModelSchema.safeParse(row.id).success ||
      row.id.trim() !== row.id
    ) {
      onInvalidRow?.();
      continue;
    }
    const architecture = record(
      provider === "openrouter" ? row.architecture : row.modalities,
    );
    const limits = record(row.limit);
    const costs = record(provider === "openrouter" ? row.pricing : row.cost);
    const tools =
      provider === "openrouter"
        ? Array.isArray(row.supported_parameters)
          ? row.supported_parameters.includes("tools")
          : null
        : typeof row.tool_call === "boolean"
          ? row.tool_call
          : null;
    const model: ProviderCatalogModel = {
      id: row.id,
      name:
        typeof row.name === "string" &&
        row.name.length > 0 &&
        row.name.length <= 300
          ? row.name
          : row.id,
      contextTokens: contextTokens(
        provider === "openrouter" ? row.context_length : limits?.context,
      ),
      textInput: modality(
        architecture?.[
          provider === "openrouter" ? "input_modalities" : "input"
        ],
      ),
      textOutput: outputModality(
        architecture?.[
          provider === "openrouter" ? "output_modalities" : "output"
        ],
      ),
      toolCalling: tools,
      pricing:
        costs &&
        !Object.values(costs).some(
          (value) => value !== null && typeof value === "object",
        ) &&
        !(
          provider === "openrouter" &&
          Object.entries(costs).some(
            ([key, value]) =>
              ![
                "prompt",
                "completion",
                "input_cache_read",
                "input_cache_write",
              ].includes(key) &&
              value !== null &&
              Number(value) !== 0,
          )
        )
          ? {
              currency: "USD",
              unit: "million_tokens",
              input: price(
                costs[provider === "openrouter" ? "prompt" : "input"],
                provider === "openrouter" ? 1_000_000 : 1,
              ),
              output: price(
                costs[provider === "openrouter" ? "completion" : "output"],
                provider === "openrouter" ? 1_000_000 : 1,
              ),
              cacheRead: price(
                costs[
                  provider === "openrouter" ? "input_cache_read" : "cache_read"
                ],
                provider === "openrouter" ? 1_000_000 : 1,
              ),
              cacheWrite: price(
                costs[
                  provider === "openrouter"
                    ? "input_cache_write"
                    : "cache_write"
                ],
                provider === "openrouter" ? 1_000_000 : 1,
              ),
            }
          : null,
    };
    const previous = models.get(model.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(model))
      throw new Error("catalog_duplicate_conflict");
    models.set(model.id, model);
  }
  if (!models.size) throw new Error("catalog_empty_section");
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}
