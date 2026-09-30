import { describe, expect, it } from "vitest";
import {
  bindV3RequestEvidence,
  type V3AuthenticatedProducer,
} from "../application/v3-request-evidence.js";
import {
  proposal,
  hash,
  source,
  toolId,
  wire,
} from "./v3-approved-manifest.fixture.js";

const assignmentId = "01234567-89ab-4cde-8fab-0123456789ab";
const producer: V3AuthenticatedProducer = {
  assignmentId,
  authenticationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  efToolArtifactId: toolId,
  tokenIssuedAtMs: 1_000,
  tokenExpiresAtMs: 2_000,
  assignmentCreatedAt: new Date(0),
  assignmentExpiresAt: new Date(3_000),
  execution: {
    tenantId: "test-tenant",
    repositoryId: "test-repo",
    pullRequest: 42,
    githubRepositoryId: "123",
    installationId: "456",
    subject: "test-runner",
    verifierRevision: source.commit,
    sourceCommit: source.commit,
    sourceTree: source.tree,
    sourceBinding: {
      headRepositoryId: "123",
      baseRepositoryId: "123",
      baseCommit: source.commit,
      baseTree: source.tree,
      mergeBaseCommit: source.commit,
      mergeBaseTree: source.tree,
    },
  },
};

function admitted() {
  const approved = proposal();
  return {
    producer,
    manifestId: "c".repeat(64),
    manifestWire: wire(approved.manifest),
    approvedRequestWire: approved.requestWire,
    scopeKey: JSON.stringify(["test-tenant", "test-repo", 42]),
    approvalEpoch: 1n,
    requestWire: approved.requestWire,
    decoded: {
      value: approved.request,
      wire: approved.requestWire,
      wireDigest: hash(approved.requestWire),
      protocolDigest: `sha256:${"d".repeat(64)}`,
    },
  };
}

describe("v3 request evidence binding", () => {
  it("retains exact approved wire, separate EF digest, and stable slot identity", () => {
    const first = bindV3RequestEvidence(admitted());
    const second = bindV3RequestEvidence({
      ...admitted(),
      producer: {
        ...producer,
        authenticationId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      },
    });
    expect(first.evidenceId).toBe(second.evidenceId);
    expect(first.firstJti).not.toBe(second.firstJti);
    expect(first.requestWireSha256).toBe(hash(first.requestWire));
    expect(first.protocolDigest).not.toBe(first.requestWireSha256);
    expect(
      JSON.parse(new TextDecoder().decode(first.validationEvidenceWire)),
    ).toMatchObject({
      requestWireSha256: first.requestWireSha256,
      protocolDigest: first.protocolDigest,
      toolArtifactId: toolId,
    });
  });

  it.each([
    [
      "changed exact bytes",
      (value: ReturnType<typeof admitted>) => ({
        ...value,
        requestWire: wire({ changed: true }),
      }),
    ],
    [
      "noncanonical EF wire",
      (value: ReturnType<typeof admitted>) => ({
        ...value,
        decoded: { ...value.decoded, wire: wire({ changed: true }) },
      }),
    ],
    [
      "wrong tool pin",
      (value: ReturnType<typeof admitted>) => ({
        ...value,
        producer: { ...value.producer, efToolArtifactId: "e".repeat(64) },
      }),
    ],
    [
      "wrong source tree",
      (value: ReturnType<typeof admitted>) => ({
        ...value,
        producer: {
          ...value.producer,
          execution: {
            ...value.producer.execution,
            sourceTree: "e".repeat(40),
          },
        },
      }),
    ],
    [
      "wrong verifier revision",
      (value: ReturnType<typeof admitted>) => ({
        ...value,
        producer: {
          ...value.producer,
          execution: {
            ...value.producer.execution,
            verifierRevision: "e".repeat(40),
          },
        },
      }),
    ],
    [
      "unauthorized subject",
      (value: ReturnType<typeof admitted>) => ({
        ...value,
        producer: {
          ...value.producer,
          execution: { ...value.producer.execution, subject: "other" },
        },
      }),
    ],
  ] as const)("rejects %s", (_name, change) => {
    expect(() => bindV3RequestEvidence(change(admitted()))).toThrow();
  });
});
