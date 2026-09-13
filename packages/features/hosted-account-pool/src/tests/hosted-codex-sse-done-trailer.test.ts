import { describe, expect, it } from "vitest";
import { hostedCodexSseDoneTrailer } from "../infrastructure/http/prisma-hosted-codex-relay";

describe("hosted Codex SSE done trailer", () => {
  it("does not append when the stream already ends with data: [DONE]", () => {
    expect(
      hostedCodexSseDoneTrailer("data: one\n\ndata: [DONE]\n\n"),
    ).toBeNull();
    expect(hostedCodexSseDoneTrailer("data: [DONE]")).toBeNull();
  });

  it("appends the OpenAI done line so the pinned Action can unfence", () => {
    expect(hostedCodexSseDoneTrailer("data: one\n\n")?.toString("utf8")).toBe(
      "data: [DONE]\n\n",
    );
    expect(hostedCodexSseDoneTrailer("data: one")?.toString("utf8")).toBe(
      "\ndata: [DONE]\n\n",
    );
    expect(hostedCodexSseDoneTrailer("")?.toString("utf8")).toBe(
      "data: [DONE]\n\n",
    );
  });
});
