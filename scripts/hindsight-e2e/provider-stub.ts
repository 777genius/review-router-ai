import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export const dimensions = 384;
export type ProviderMode =
  | "normal"
  | "echo400"
  | "echo500"
  | "malformed"
  | "hold";
export const privacySentinel = "RR_NATIVE_PRIVATE_5C36E924";

const words = (text: string) =>
  text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
export function embedding(text: string): number[] {
  const vector = Array<number>(dimensions).fill(0);
  for (const word of words(text)) {
    const index =
      createHash("sha256").update(word).digest().readUInt32BE(0) % dimensions;
    vector[index] = (vector[index] ?? 0) + 1;
  }
  const length =
    Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / length);
}

export async function startProviderStub() {
  let mode: ProviderMode = "normal";
  let updateFixture:
    | { readonly observationId: string; readonly sourceMarker: string }
    | undefined;
  let held = 0;
  const calls = {
    embeddings: 0,
    rerank: 0,
    consolidation: 0,
    semanticDedup: 0,
    verification: 0,
    unexpected: 0,
  };
  // Never record request paths, prompts or bodies in qualification diagnostics.
  const unexpectedByReason = {
    invalidEmbeddingShape: 0,
    invalidRerankShape: 0,
    nonConsolidationChat: 0,
    // Fixed structural counters only; never record prompts or request bodies.
    unrelatedChatPrompt: 0,
    // Overlapping, fixed-shape classifications of still-rejected calls.
    // No prompt, request text, hash, length or credential is persisted.
    unrelatedRetainExtraction: 0,
    unrelatedSystemFirst: 0,
    unrelatedMultipleMessages: 0,
    unrelatedDedupMarkerElsewhere: 0,
    unrelatedJsonObjectMode: 0,
    dedupEnvelopeMismatch: 0,
    dedupPrefixMismatch: 0,
    dedupFormatMismatch: 0,
    dedupMarkersMissing: 0,
    dedupInstructionMissing: 0,
    missingObservationCandidate: 0,
    unsupportedEndpoint: 0,
    invalidProviderBody: 0,
  };
  const markUnexpected = (reason: keyof typeof unexpectedByReason) => {
    calls.unexpected += 1;
    unexpectedByReason[reason] += 1;
  };
  const releases = new Set<() => void>();
  const reply = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      try {
        let raw = "";
        for await (const chunk of request) {
          raw += chunk;
          if (raw.length > 2_000_000)
            return reply(response, 413, { error: "oversized_test_request" });
        }
        const body = raw ? JSON.parse(raw) : {};
        if (request.url === "/health")
          return reply(response, 200, { status: "ok" });
        if (mode === "hold") {
          held += 1;
          await new Promise<void>((resolve) => {
            releases.add(resolve);
            response.on("close", resolve);
          });
          held -= 1;
          if (response.destroyed) return;
        }
        if (mode === "echo400" || mode === "echo500") {
          return reply(response, mode === "echo400" ? 400 : 500, {
            error: {
              type: "synthetic_provider_failure",
              message: `${privacySentinel} ${raw}`,
            },
          });
        }
        if (request.url === "/v1/embeddings") {
          calls.embeddings += 1;
          if (
            body.model !== "stub-embeddings" ||
            body.dimensions !== dimensions ||
            !Array.isArray(body.input) ||
            body.input.some((value: unknown) => typeof value !== "string")
          ) {
            markUnexpected("invalidEmbeddingShape");
            return reply(response, 400, {
              error: { message: "unsupported_test_embedding_request" },
            });
          }
          return reply(response, 200, {
            object: "list",
            model: body.model,
            data: body.input.map((value: string, index: number) => ({
              object: "embedding",
              index,
              embedding: embedding(value),
            })),
            usage: { prompt_tokens: 1, total_tokens: 1 },
          });
        }
        if (request.url === "/rerank") {
          calls.rerank += 1;
          if (
            typeof body.query !== "string" ||
            !Array.isArray(body.documents)
          ) {
            markUnexpected("invalidRerankShape");
            return reply(response, 400, {
              error: { message: "unsupported_test_rerank_request" },
            });
          }
          const query = new Set(words(body.query));
          return reply(response, 200, {
            results: body.documents
              .map((document: string | { text: string }, index: number) => ({
                index,
                relevance_score:
                  words(
                    typeof document === "string" ? document : document.text,
                  ).filter((word) => query.has(word)).length /
                  Math.max(1, query.size),
              }))
              .sort(
                (
                  a: { relevance_score: number },
                  b: { relevance_score: number },
                ) => b.relevance_score - a.relevance_score,
              ),
          });
        }
        if (request.url === "/v1/chat/completions") {
          const messages = Array.isArray(body.messages) ? body.messages : [];
          const text = messages
            .map((message: { content?: string }) => message.content ?? "")
            .join("\n");
          // Pinned Hindsight 1.1.0 enables semantic dedup by default. Only
          // its focused NEW/EXISTING prompt receives a deterministic verdict.
          // Pinned Hindsight wraps typed soft-schema calls with a JSON-schema
          // preamble before this same user prompt. Match only that reviewed
          // wrapper or the direct prompt, never arbitrary completion traffic.
          const dedupMarker = "You reconcile long-term memory observations.";
          const messageContent = messages[0]?.content;
          const directDedup =
            typeof messageContent === "string" &&
            messageContent.startsWith(dedupMarker);
          const softSchemaPreamble =
            "\n\nYou must respond with valid JSON matching this schema:\n";
          // Pinned OpenAICompatibleLLM._ensure_json_word_in_user_message
          // prepends this exact hint when the schema text contains uppercase
          // JSON but no lowercase "json" token. Do not admit other prefixes.
          const hintedSoftSchemaPreamble = `Return valid json only.\n\n${softSchemaPreamble}`;
          const softSchemaDedup =
            typeof messageContent === "string" &&
            (messageContent.startsWith(softSchemaPreamble) ||
              messageContent.startsWith(hintedSoftSchemaPreamble)) &&
            messageContent.includes(`\n\n${dedupMarker}`) &&
            body.response_format?.type === "json_object";
          const isSemanticDedup =
            body.model === "stub-model" &&
            messages.length === 1 &&
            messages[0]?.role === "user" &&
            (directDedup || softSchemaDedup) &&
            messageContent.includes("[NEW] ") &&
            messageContent.includes("[EXISTING] ") &&
            messageContent.includes("Respond with ONLY one valid JSON object");
          const complete = (content: string) =>
            reply(response, 200, {
              id: "chatcmpl-native-fixture",
              object: "chat.completion",
              created: 0,
              model: body.model,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            });
          // OpenAICompatibleLLM.verify_connection at the pinned native revision
          // sends this exact free-form probe, with a 512-token budget and no
          // temperature/schema/tools. It is not a memory inference request.
          // This loopback profile enables no bank-attribution or cache-affinity
          // body metadata. Reject extra body/message keys, not just known
          // inference options, so protocol drift cannot pass the final guard.
          if (
            request.method === "POST" &&
            body.model === "stub-model" &&
            messages.length === 1 &&
            messages[0]?.role === "user" &&
            messageContent === "Say 'ok'" &&
            body.max_tokens === 512 &&
            Object.keys(body).every((key) =>
              ["model", "messages", "max_tokens"].includes(key),
            ) &&
            Object.keys(messages[0]).every((key) =>
              ["role", "content"].includes(key),
            )
          ) {
            calls.verification += 1;
            return complete("ok");
          }
          if (isSemanticDedup) {
            calls.semanticDedup += 1;
            return complete(
              JSON.stringify({
                action: "keep",
                text: "",
                reason: "synthetic fixture keeps distinct observations",
              }),
            );
          }
          if (!text.includes("### Existing observations")) {
            markUnexpected("nonConsolidationChat");
            // Pinpoint the first failed dedup predicate without retaining any
            // request data, hashes, text lengths or credentials in CI evidence.
            if (
              typeof messageContent !== "string" ||
              !messageContent.includes(dedupMarker)
            ) {
              unexpectedByReason.unrelatedChatPrompt += 1;
              // Only classify against immutable native-source prompt contracts.
              // These observations MUST NOT admit previously rejected traffic.
              if (
                text.includes(
                  "Extract SIGNIFICANT facts from text. Be SELECTIVE",
                )
              )
                unexpectedByReason.unrelatedRetainExtraction += 1;
              if (messages[0]?.role === "system")
                unexpectedByReason.unrelatedSystemFirst += 1;
              if (messages.length > 1)
                unexpectedByReason.unrelatedMultipleMessages += 1;
              if (text.includes(dedupMarker))
                unexpectedByReason.unrelatedDedupMarkerElsewhere += 1;
              if (body.response_format?.type === "json_object")
                unexpectedByReason.unrelatedJsonObjectMode += 1;
            } else if (
              body.model !== "stub-model" ||
              messages.length !== 1 ||
              messages[0]?.role !== "user"
            ) {
              unexpectedByReason.dedupEnvelopeMismatch += 1;
            } else if (
              !directDedup &&
              !(
                messageContent.startsWith(softSchemaPreamble) ||
                messageContent.startsWith(hintedSoftSchemaPreamble)
              )
            ) {
              unexpectedByReason.dedupPrefixMismatch += 1;
            } else if (
              !directDedup &&
              body.response_format?.type !== "json_object"
            ) {
              unexpectedByReason.dedupFormatMismatch += 1;
            } else if (
              !messageContent.includes("[NEW] ") ||
              !messageContent.includes("[EXISTING] ")
            ) {
              unexpectedByReason.dedupMarkersMissing += 1;
            } else {
              unexpectedByReason.dedupInstructionMissing += 1;
            }
            return reply(response, 400, {
              error: { message: "unscripted_llm_call" },
            });
          }
          calls.consolidation += 1;
          const user =
            [...messages]
              .reverse()
              .find((message: { role?: string }) => message.role === "user")
              ?.content ?? "";
          const facts = user.slice(
            user.lastIndexOf("### New facts"),
            user.lastIndexOf("### Existing observations"),
          );
          const ids = [...facts.matchAll(/\[([0-9a-f-]{36})\]/g)].map(
            (match) => match[1],
          );
          const updating =
            updateFixture && facts.includes(updateFixture.sourceMarker);
          if (
            updating &&
            !user
              .slice(user.lastIndexOf("### Existing observations"))
              .includes(updateFixture!.observationId)
          ) {
            markUnexpected("missingObservationCandidate");
            return reply(response, 400, {
              error: { message: "scripted_observation_candidate_missing" },
            });
          }
          const content =
            mode === "malformed"
              ? `${privacySentinel} invalid model response`
              : JSON.stringify({
                  creates:
                    !updating && ids.length
                      ? [
                          {
                            text: "Native qualification derived observation",
                            source_fact_ids: ids,
                            reason: "synthetic protocol fixture",
                          },
                        ]
                      : [],
                  updates: updating
                    ? [
                        {
                          observation_id: updateFixture!.observationId,
                          text: "Native qualification derived observation with reviewed supporting evidence",
                          source_fact_ids: ids,
                          reason: "synthetic history fixture",
                        },
                      ]
                    : [],
                  deletes: [],
                });
          return complete(content);
        }
        markUnexpected("unsupportedEndpoint");
        return reply(response, 404, {
          error: { message: "unsupported_test_endpoint" },
        });
      } catch {
        markUnexpected("invalidProviderBody");
        reply(response, 400, { error: { message: "invalid_test_request" } });
      }
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Provider stub failed to bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    unexpectedByReason,
    setMode(next: ProviderMode) {
      mode = next;
      if (next !== "hold") {
        for (const release of releases) release();
        releases.clear();
      }
    },
    setObservationUpdateFixture(next: typeof updateFixture) {
      updateFixture = next;
    },
    get held() {
      return held;
    },
    async close() {
      for (const release of releases) release();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
