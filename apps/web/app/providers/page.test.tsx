import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ProvidersPage from "./page";

describe("public provider connection reference", () => {
  it("shows the method matrix and does not misstate production or TypeSafe", () => {
    const html = renderToStaticMarkup(<ProvidersPage />);
    expect(html).toContain("OpenAI Codex");
    expect(html).toContain("mobile refresh token");
    expect(html).toContain("AWS SigV4");
    expect(html).toContain("MiMo Token Plan");
    expect(html).toContain("Separate path");
    expect(html).toContain("TypeSafe SystemOne");
    expect(html).toContain("Unsupported for review");
    expect(html).toContain("not a guarantee");
    expect(html).toContain("not live paid-provider or production acceptance");
    expect((html.match(/scope="row"/g) ?? [])).toHaveLength(20);
  });
});
