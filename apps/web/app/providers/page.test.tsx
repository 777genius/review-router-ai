import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ProvidersPage from "./page";

describe("public AI provider methods page", () => {
  it("shows readable grouped connection options with explicit limits", () => {
    const html = renderToStaticMarkup(<ProvidersPage />);
    expect(html).toContain("Which AI providers can I use?");
    expect(html).toContain("Claude and Gemini");
    expect(html).toContain("Other API-key providers");
    expect(html).toContain("OpenAI API");
    expect(html).toContain("Codex");
    expect(html).toContain("Import mobile refresh token");
    expect(html).toContain("AWS credentials");
    expect(html).toContain("MiMo Token Plan");
    expect(html).toContain("your deployment may enable fewer choices");
    expect(html).toContain("does not guarantee");
    expect((html.match(/scope="row"/g) ?? [])).toHaveLength(18);
    expect((html.match(/scope="col"/g) ?? [])).toHaveLength(6);
  });
});
