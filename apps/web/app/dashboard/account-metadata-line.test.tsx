import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  AccountMetadataFact,
  AccountMetadataFields,
  AccountMetadataView,
} from "@reviewrouter/features-provider-accounts/account-metadata";
import { AccountMetadataLine } from "./account-metadata-line";

const known = <T,>(value: T): AccountMetadataFact<T> => ({
  status: "known",
  value,
  source: "provider_api",
  observedAt: "2026-11-18T09:00:00Z",
  freshness: "current",
});
const fields = (): AccountMetadataFields => ({
  email: known("test@example.invalid"),
  accountLabel: { status: "unknown" },
  subscription: known({
    code: "pro",
    label: "Pro 200",
    scope: "personal",
    endsAt: { kind: "date", value: "2026-11-23" },
  }),
  credentialExpiresAt: known("2026-11-20T13:00:00Z"),
  privacyMode: known("private"),
});
const render = (metadata: AccountMetadataView) =>
  renderToStaticMarkup(<AccountMetadataLine metadata={metadata} />);

describe("native account details presentation", () => {
  it("keeps calendar dates distinct from credential instants and native plan labels", () => {
    const html = render({
      status: "available",
      displayToken: "safe",
      fields: fields(),
    });
    expect(html).toContain("test@example.invalid");
    expect(html).toContain("Pro 200");
    expect(html).toContain("Subscription ends 2026-11-23");
    expect(html).toContain("Credential expires Nov 20, 2026, 1:00 PM UTC");
    expect(html).not.toContain("2026-11-23T");
  });

  it.each([
    "privacyMode",
    "credentialExpiresAt",
    "email",
    "subscription",
  ] as const)("visibly marks stale %s without relying on hover", (name) => {
    const data = fields();
    const fact = data[name];
    if (fact.status !== "known") throw new Error("fixture");
    const html = render({
      status: "available",
      displayToken: "safe",
      fields: { ...data, [name]: { ...fact, freshness: "stale" } },
    });
    expect(html).toContain("<p>Some account details may be out of date</p>");
  });

  it("escapes provider text and does not render restricted metadata", () => {
    const html = render({
      status: "available",
      displayToken: "safe",
      fields: { ...fields(), email: known('<script>alert("native")</script>') },
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(render({ status: "restricted", displayToken: "restricted" })).toBe(
      "",
    );
  });

  it("does not infer a subscription from capability or empty observations", () => {
    expect(render({ status: "unsupported", displayToken: "safe" })).toContain(
      "not provided",
    );
    expect(render({ status: "unavailable", displayToken: "safe" })).toContain(
      "temporarily unavailable",
    );
    expect(render({ status: "unknown", displayToken: "safe" })).toContain(
      "not reported yet",
    );
    const empty = Object.fromEntries(
      Object.keys(fields()).map((key) => [key, { status: "unknown" }]),
    );
    expect(
      render({
        status: "available",
        displayToken: "safe",
        fields: empty as AccountMetadataFields,
      }),
    ).toContain("not reported yet");
  });
});
