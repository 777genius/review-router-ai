import { describe, expect, it } from "vitest";
import { validateV3ManifestProposal } from "../application/v3-approved-manifest.js";
import {
  scope,
  toolId,
  wire,
  hash,
  digest,
  proposal,
} from "./v3-approved-manifest.fixture.js";

function validate(fixture: ReturnType<typeof proposal>) {
  return validateV3ManifestProposal(
    { manifestWire: wire(fixture.manifest), requestWire: fixture.requestWire },
    scope,
    {
      decodedRequest: fixture.request,
      validationEvidenceWire: fixture.validationEvidenceWire,
    },
  );
}

describe("closed v3 approval manifest", () => {
  it("binds exact request and validation bytes to the approved manifest", () => {
    const fixture = proposal();
    const accepted = validate(fixture);
    expect(accepted.scopeKey).toBe(
      JSON.stringify(["test-tenant", "test-repo", 42]),
    );
    expect(accepted.requestWireSha256).toBe(hash(fixture.requestWire));
    expect(accepted.toolArtifactId).toBe(toolId);
  });

  it("rejects a changed request, package union, and unverified decoder output", () => {
    const wrongPackage = proposal();
    wrongPackage.manifest.governedPackages = ["other"];
    expect(() => validate(wrongPackage)).toThrow();
    const changedRequest = proposal();
    changedRequest.requestWire = wire({
      ...changedRequest.request,
      decisionDigests: [digest],
    });
    expect(() => validate(changedRequest)).toThrow();
    const unverified = proposal();
    unverified.request.operation = "promote-release";
    expect(() => validate(unverified)).toThrow();
  });

  it("rejects promote-release after matching the approved request and validation bytes", () => {
    const fixture = proposal();
    const request = {
      ...fixture.request,
      operation: "promote-release",
      admissionReceiptId: "receipt-1",
    };
    const requestWire = wire(request);
    const validationEvidenceWire = wire({
      schema: "reviewrouter:g1-v3-request-validation-fixture:1",
      requestWireSha256: hash(requestWire),
      requestByteLength: requestWire.byteLength,
      toolArtifactId: toolId,
      result: "validated",
    });
    fixture.manifest.approval.operation = "promote-release";
    fixture.manifest.requestWireSha256 = hash(requestWire);
    fixture.manifest.requestByteLength = requestWire.byteLength;
    fixture.manifest.validationEvidenceSha256 = hash(validationEvidenceWire);
    fixture.manifest.validationEvidenceByteLength =
      validationEvidenceWire.byteLength;

    expect(() =>
      validateV3ManifestProposal(
        { manifestWire: wire(fixture.manifest), requestWire },
        scope,
        { decodedRequest: request, validationEvidenceWire },
      ),
    ).toThrow();
  });

  it("rejects approval provenance for another owner or source", () => {
    const owner = proposal();
    owner.manifest.provenance.subject = "other-owner";
    expect(() => validate(owner)).toThrow();
    const source = proposal();
    source.manifest.provenance.sourceDigest = `sha256:${"f".repeat(64)}`;
    expect(() => validate(source)).toThrow();
  });
});
