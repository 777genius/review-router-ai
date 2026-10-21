// Harness-only HTTP dependency fixture. The production catalog and cache execute unchanged.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url === "https://models.dev/api.json") {
    return Response.json(
      Object.fromEntries(
        ["openai", "anthropic"].map((provider) => [
          provider,
          {
            models: {
              [`${provider}-fixture`]: {
                id: `${provider}-fixture`,
                name: `${provider} fixture`,
                modalities: { input: ["text"], output: ["text"] },
                tool_call: true,
                limit: { context: 10000 },
                cost: { input: 1, output: 2 },
              },
            },
          },
        ]),
      ),
    );
  }
  if (url === "https://openrouter.ai/api/v1/models") {
    return Response.json({
      data: [
        {
          id: "vendor/fixture",
          name: "Router fixture",
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
          supported_parameters: ["tools"],
          context_length: 10000,
          pricing: { prompt: "0.000001", completion: "0.000002" },
        },
      ],
    });
  }
  return originalFetch(input, init);
};
