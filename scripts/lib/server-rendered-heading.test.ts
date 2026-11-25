import { describe, expect, it } from "vitest";
import { hasH1Text } from "./server-rendered-heading.ts";

const title = "Sign in to ReviewRouter";

describe("server-rendered sign-in heading contract", () => {
  it("accepts the branded heading across inline markup, React comments and whitespace", () => {
    expect(
      hasH1Text(
        '<h1 class="hero">Sign in to <span class="whitespace-nowrap">ReviewRouter</span></h1>',
        title,
      ),
    ).toBe(true);
    expect(
      hasH1Text(
        "<h1>\n Sign\t in to <!-- -->\n<span>ReviewRouter</span>\n</h1>",
        title,
      ),
    ).toBe(true);
  });

  it("rejects a wrong or missing heading even when the brand exists elsewhere", () => {
    expect(
      hasH1Text(
        "<nav>ReviewRouter</nav><h1>Sign in to AnotherProduct</h1>",
        title,
      ),
    ).toBe(false);
    expect(hasH1Text(`<p>${title}</p>`, title)).toBe(false);
    expect(hasH1Text("<h1>Sign in to</h1><h1>ReviewRouter</h1>", title)).toBe(
      false,
    );
  });

  it("cannot satisfy the heading from attributes, scripts, styles or comments", () => {
    expect(hasH1Text(`<h1 title="${title}">Welcome</h1>`, title)).toBe(false);
    expect(
      hasH1Text(`<div data-example="<h1>${title}</h1>"></div>`, title),
    ).toBe(false);
    expect(
      hasH1Text(
        `<script>const example = '<h1>${title}</h1>';</script><h1>Welcome</h1>`,
        title,
      ),
    ).toBe(false);
    expect(
      hasH1Text(
        `<style>/* <h1>${title}</h1> */</style><h1>Welcome</h1>`,
        title,
      ),
    ).toBe(false);
    expect(hasH1Text(`<!-- <h1>${title}</h1> --><h1>Welcome</h1>`, title)).toBe(
      false,
    );
    expect(
      hasH1Text(
        `<h1><script>${title}</script><style>${title}</style><!-- ${title} --></h1>`,
        title,
      ),
    ).toBe(false);
  });
});
