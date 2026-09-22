import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  EfAuthorityService,
  type AuthenticatedEfExecution,
  type AuthorityCustodyPort,
  type AuthorityCustodyRead,
  type DecodedEfAdmission,
  type DecodedEfCompletion,
  type EfAuthorityCodecPort,
  type EfAuthorityDecisionTransactionPort,
  type TrustedVerifierCustodyPort,
} from "../application/ef-authority-service.js";
import { SdkGrowthAuthority } from "../application/authority.js";
import { PinnedEfAuthorityCodecV1 } from "../application/pinned-ef-authority-codec.js";
import {
  AuthorityError,
  type Binding,
  type Grant,
  type Receipt,
} from "../domain/contracts.js";
import { canonical } from "../domain/validation.js";
import {
  InMemoryCurrentAuthoritySnapshot,
  InMemoryReceiptRepository,
} from "../testing/index.js";

const sha256 = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sha512 = (value: Uint8Array) =>
  `sha512-${createHash("sha512").update(value).digest("base64")}`;
const constantDigest = "sha256:" + "a".repeat(64);

function admissionRequestWire(
  value: Pick<
    DecodedEfAdmission,
    | "request"
    | "assertions"
    | "authorityBinding"
    | "candidateArchive"
    | "releasedArchive"
    | "toolArchive"
    | "installedDistributionDigest"
  >,
) {
  const identity = (archive: DecodedEfAdmission["candidateArchive"]) => ({
    sha256: archive.sha256,
    sha512Sri: archive.sha512Sri,
  });
  return Buffer.from(
    canonical({
      ...value.request,
      assertions: value.assertions,
      authorityBinding: value.authorityBinding,
      candidateArchive: identity(value.candidateArchive),
      releasedArchive: identity(value.releasedArchive),
      toolArchive: identity(value.toolArchive),
      installedDistributionDigest: value.installedDistributionDigest,
    }),
  );
}

function admissionEnvelope(value: DecodedEfAdmission) {
  const binary = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  const archive = (item: DecodedEfAdmission["candidateArchive"]) => ({
    bytes: binary(item.bytes),
    sha256: item.sha256,
    sha512Sri: item.sha512Sri,
  });
  return {
    adapterVersion: 1,
    kind: "request",
    requestWire: binary(value.requestWire),
    requestDigest: value.requestDigest,
    request: value.request,
    assertions: value.assertions,
    authorityBinding: value.authorityBinding,
    candidateArchive: archive(value.candidateArchive),
    releasedArchive: archive(value.releasedArchive),
    toolArchive: archive(value.toolArchive),
    installedDistributionWire: binary(value.installedDistributionWire),
    installedDistributionDigest: value.installedDistributionDigest,
  };
}

function fixture() {
  const execution: AuthenticatedEfExecution = {
    tenantId: "tenant",
    repositoryId: "repo",
    pullRequest: 42,
    githubRepositoryId: "123",
    installationId: "456",
    subject: "runner",
    runId: "789",
    runAttempt: "2",
    verifierRevision: "1".repeat(40),
    sourceCommit: "2".repeat(40),
    sourceTree: "3".repeat(40),
  };
  const binding: Binding = {
    repositoryId: "repo",
    pullRequest: 42,
    head: execution.sourceCommit,
    base: "4".repeat(40),
    mergeBase: "5".repeat(40),
    verifierId: "verifier",
    verifierDigest: constantDigest,
    policyDigest: constantDigest,
    toolDigest: constantDigest,
    artifactDigest: constantDigest,
    lockDigest: constantDigest,
    historyDigest: constantDigest,
    scopeDigest: constantDigest,
    scopes: ["public-api"],
  };
  const archive = (text: string) => {
    const bytes = Buffer.from(text);
    return { bytes, sha256: sha256(bytes), sha512Sri: sha512(bytes) };
  };
  const decodedRequest = {
    version: 1 as const,
    repositoryId: "repo",
    pullRequest: 42,
  };
  const assertions = {
    repositoryId: execution.githubRepositoryId,
    installationId: execution.installationId,
    runId: execution.runId,
    runAttempt: execution.runAttempt,
    verifierRevision: execution.verifierRevision,
    sourceCommit: execution.sourceCommit,
    sourceTree: execution.sourceTree,
  };
  const candidateArchive = archive("candidate");
  const releasedArchive = archive("released");
  const toolArchive = archive("tool");
  const distribution = Buffer.from("installed-distribution");
  const installedDistributionDigest = sha256(distribution);
  const requestWire = admissionRequestWire({
    request: decodedRequest,
    assertions,
    authorityBinding: binding,
    candidateArchive,
    releasedArchive,
    toolArchive,
    installedDistributionDigest,
  });
  const admission: DecodedEfAdmission = {
    adapterVersion: 1,
    requestWire,
    requestDigest: sha256(requestWire),
    request: decodedRequest,
    assertions,
    authorityBinding: binding,
    candidateArchive,
    releasedArchive,
    toolArchive,
    installedDistributionWire: distribution,
    installedDistributionDigest,
  };
  const grant: Grant = {
    version: 1,
    grantId: '["tenant","repo",42,"' + admission.requestDigest + '"]',
    identity: { tenantId: "tenant", repositoryId: "repo", subject: "runner" },
    request: {
      version: 1,
      requestId: admission.requestDigest,
      repositoryId: "repo",
      pullRequest: 42,
    },
    binding,
    ownerEvidence: {
      version: 1,
      evidenceId: "owner",
      tenantId: "tenant",
      ownerSubject: "owner",
      binding,
      scopes: binding.scopes,
      decision: "approved",
      sourceDigest: constantDigest,
      issuedAt: 1,
      expiresAt: 10_000,
      revoked: false,
    },
    fence: 1,
    authorityEpoch: 1,
    issuedAt: 100,
    expiresAt: 1_000,
  };
  const report = Buffer.from("finalized-report");
  const decodedCompletion = {
    version: 1 as const,
    grantId: grant.grantId,
    fence: grant.fence,
    binding,
    coveredScopes: binding.scopes,
    coverage: "complete" as const,
    outcome: "passed" as const,
    reportDigest: sha256(report),
  };
  const completionWire = Buffer.from(canonical(decodedCompletion));
  const completion: DecodedEfCompletion = {
    adapterVersion: 1,
    requestDigest: admission.requestDigest,
    grantDigest: sha256(Buffer.from(canonical(grant))),
    completionDigest: sha256(completionWire),
    completionWire,
    completion: decodedCompletion,
    assertions: admission.assertions,
    finalizedReport: report,
    reportDigest: sha256(report),
    reportDecision: {
      outcome: "passed",
      coverage: "complete",
      coveredScopes: binding.scopes,
      phases: ["authority", "decision"],
    },
  };
  const receipt: Receipt = {
    version: 1,
    receiptId: grant.grantId,
    grantId: grant.grantId,
    identity: grant.identity,
    binding,
    fence: grant.fence,
    authorityEpoch: grant.authorityEpoch,
    completedAt: 200,
    reportDigest: completion.reportDigest,
    admitted: true,
    reason: "admitted",
  };
  return { execution, binding, admission, grant, completion, receipt };
}

function harness() {
  const f = fixture();
  let retained: AuthorityCustodyRead | null = null;
  let retainedPullRequest: number | null = null;
  const authority = {
    request: vi.fn().mockResolvedValue(f.grant),
    complete: vi.fn().mockResolvedValue(f.receipt),
    currentGrant: vi.fn().mockResolvedValue(f.grant),
  } as unknown as SdkGrowthAuthority;
  const custody: AuthorityCustodyPort = {
    async retainAdmission(scope, value) {
      retainedPullRequest = scope.pullRequest;
      retained = {
        requestDigest: value.requestDigest,
        grantDigest: value.grantDigest,
        grantWire: value.grantWire,
        completionDigest: null,
        receiptDigest: null,
        receiptWire: null,
        publicationState: "absent",
      };
      return retained;
    },
    async retainCompletion(scope, value) {
      if (retainedPullRequest !== scope.pullRequest)
        throw new AuthorityError("not-found");
      retained = {
        requestDigest: value.requestDigest,
        grantDigest: value.grantDigest,
        grantWire: retained!.grantWire,
        completionDigest: value.completionDigest,
        receiptDigest: value.receiptDigest,
        receiptWire: value.receiptWire,
        publicationState: "ready",
      };
      return retained;
    },
    async readExecution(scope) {
      return retainedPullRequest === scope.pullRequest ? retained : null;
    },
    async readAdmission(scope, _execution, requestDigest) {
      return retainedPullRequest === scope.pullRequest &&
        retained?.requestDigest === requestDigest
        ? retained
        : null;
    },
    async readCompletion(scope, _execution, requestDigest, completionDigest) {
      return retainedPullRequest === scope.pullRequest &&
        retained?.requestDigest === requestDigest &&
        retained.completionDigest === completionDigest
        ? retained
        : null;
    },
  };
  const transactions: EfAuthorityDecisionTransactionPort = {
    async transact(_execution, _scope, operation) {
      return operation({ authority, custody });
    },
  };
  const codec: EfAuthorityCodecPort = {
    decodeAdmission: () => structuredClone(f.admission),
    decodeCompletion: () => structuredClone(f.completion),
    encodeGrant: ({ grant }) => Buffer.from(canonical(grant)),
    encodeReceipt: ({ receipt }) => Buffer.from(canonical(receipt)),
  };
  const verifier: TrustedVerifierCustodyPort = {
    async load() {
      return {
        verifierRevision: f.execution.verifierRevision,
        sourceCommit: f.execution.sourceCommit,
        sourceTree: f.execution.sourceTree,
        candidateArchiveSha256: f.admission.candidateArchive.sha256,
        candidateArchiveSha512Sri: f.admission.candidateArchive.sha512Sri,
        releasedArchiveSha256: f.admission.releasedArchive.sha256,
        releasedArchiveSha512Sri: f.admission.releasedArchive.sha512Sri,
        toolArchiveSha256: f.admission.toolArchive.sha256,
        toolArchiveSha512Sri: f.admission.toolArchive.sha512Sri,
        installedDistributionDigest: f.admission.installedDistributionDigest,
        authorityBinding: f.binding,
      };
    },
    verifyFinalizedReport: vi.fn().mockResolvedValue(undefined),
  };
  return {
    f,
    authority,
    custody,
    codec,
    verifier,
    service: new EfAuthorityService(transactions, codec, verifier),
  };
}

describe("EF authority application boundary", () => {
  it("propagates current-authority infrastructure failures from status", async () => {
    const h = harness();
    await h.service.admit(h.f.execution, "repo", 42, {});
    const failure = new Error("storage unavailable");
    vi.mocked(h.authority.currentGrant).mockRejectedValueOnce(failure);
    await expect(
      h.service.status(h.f.execution, "repo", 42, h.f.admission.requestDigest),
    ).rejects.toBe(failure);
  });

  it("rejects an admission whose repository assertion is not the authenticated GitHub repository", async () => {
    const h = harness();
    h.codec.decodeAdmission = () => ({
      ...structuredClone(h.f.admission),
      assertions: {
        ...h.f.admission.assertions,
        repositoryId: h.f.execution.repositoryId,
      },
    });
    await expect(
      h.service.admit(h.f.execution, "repo", 42, {}),
    ).rejects.toMatchObject({ code: "wrong-identity" });
    expect(h.authority.request).not.toHaveBeenCalled();
  });

  it("retains exact admission and completion relationships through the transaction port", async () => {
    const h = harness();
    const grantWire = await h.service.admit(h.f.execution, "repo", 42, {});
    expect(Buffer.from(grantWire).toString()).toBe(canonical(h.f.grant));
    const authorityRequest = vi.mocked(h.authority.request).mock
      .calls[0]![1] as {
      requestId: string;
    };
    expect(authorityRequest.requestId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(authorityRequest.requestId).not.toBe(h.f.admission.requestDigest);
    const receiptWire = await h.service.complete(h.f.execution, "repo", 42, {});
    expect(Buffer.from(receiptWire).toString()).toBe(canonical(h.f.receipt));
    const verify = vi.mocked(h.verifier.verifyFinalizedReport);
    expect(verify).toHaveBeenCalledOnce();
    expect(verify.mock.calls[0]![0]).toMatchObject({
      execution: h.f.execution,
      completion: h.f.completion.completion,
      reportDecision: h.f.completion.reportDecision,
    });
    expect(Buffer.from(verify.mock.calls[0]![0].report)).toEqual(
      Buffer.from(h.f.completion.finalizedReport),
    );
    await expect(
      h.service.completionReadback(
        h.f.execution,
        "repo",
        42,
        h.f.completion.requestDigest,
        h.f.completion.completionDigest,
      ),
    ).resolves.toEqual(receiptWire);
  });

  it("fails closed for admission, completion, and status readback through another pull request", async () => {
    const h = harness();
    await h.service.admit(h.f.execution, "repo", 42, {});
    await h.service.complete(h.f.execution, "repo", 42, {});

    await expect(
      h.service.admissionReadback(
        h.f.execution,
        "repo",
        99,
        h.f.admission.requestDigest,
      ),
    ).rejects.toMatchObject({ code: "wrong-identity" });
    await expect(
      h.service.completionReadback(
        h.f.execution,
        "repo",
        99,
        h.f.completion.requestDigest,
        h.f.completion.completionDigest,
      ),
    ).rejects.toMatchObject({ code: "wrong-identity" });
    await expect(
      h.service.status(h.f.execution, "repo", 99, h.f.admission.requestDigest),
    ).rejects.toMatchObject({ code: "wrong-identity" });
    expect(h.authority.currentGrant).not.toHaveBeenCalled();
  });

  it("rejects a changed stable execution before it can advance authority", async () => {
    const h = harness();
    await h.service.admit(h.f.execution, "repo", 42, {});
    const changedRequestWire = Buffer.from("changed-request");
    h.codec.decodeAdmission = () => ({
      ...structuredClone(h.f.admission),
      requestDigest: sha256(changedRequestWire),
      requestWire: changedRequestWire,
    });
    await expect(
      h.service.admit(h.f.execution, "repo", 42, {}),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(h.authority.request).toHaveBeenCalledTimes(1);
  });

  it.each(["candidateArchive", "releasedArchive"] as const)(
    "rejects %s exceeding 8 MiB before authority or custody writes",
    async (field) => {
      const h = harness();
      h.codec.decodeAdmission = () => ({
        ...structuredClone(h.f.admission),
        [field]: {
          ...h.f.admission[field],
          bytes: Buffer.alloc(8 * 1024 * 1024 + 1),
        },
      });
      await expect(
        h.service.admit(h.f.execution, "repo", 42, {}),
      ).rejects.toMatchObject({ code: "invalid-contract" });
      expect(h.authority.request).not.toHaveBeenCalled();
    },
  );

  it("binds all normalized authority material and actual archive bytes", async () => {
    const h = harness();
    h.verifier.load = vi.fn().mockResolvedValue({
      ...(await h.verifier.load(h.f.execution)),
      authorityBinding: {
        ...h.f.binding,
        policyDigest: "sha256:" + "b".repeat(64),
      },
    });
    await expect(
      h.service.admit(h.f.execution, "repo", 42, {}),
    ).rejects.toMatchObject({ code: "binding-changed" });

    const changed = harness();
    changed.codec.decodeAdmission = () => ({
      ...structuredClone(changed.f.admission),
      candidateArchive: {
        ...changed.f.admission.candidateArchive,
        bytes: Buffer.from("different-bytes"),
      },
    });
    await expect(
      changed.service.admit(changed.f.execution, "repo", 42, {}),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it.each(Object.keys(fixture().binding) as (keyof Binding)[])(
    "rejects verifier/owner disagreement in governed field %s before retaining custody",
    async (field) => {
      const h = harness();
      const original = h.f.binding[field];
      const changedBinding = {
        ...h.f.binding,
        [field]: Array.isArray(original)
          ? ["other-scope"]
          : typeof original === "number"
            ? original + 1
            : "different-" + original,
      };
      // Candidate and trusted execution evidence agree with one another, but
      // must still agree with the independently owner-approved grant binding.
      h.codec.decodeAdmission = () => ({
        ...structuredClone(h.f.admission),
        authorityBinding: changedBinding,
      });
      const trusted = await h.verifier.load(h.f.execution);
      h.verifier.load = vi.fn().mockResolvedValue({
        ...trusted,
        authorityBinding: changedBinding,
      });
      const retain = vi.spyOn(h.custody, "retainAdmission");
      await expect(
        h.service.admit(h.f.execution, "repo", 42, {}),
      ).rejects.toMatchObject({ code: "binding-changed" });
      expect(retain).not.toHaveBeenCalled();
    },
  );

  it("admits successive authenticated runs on one PR without digest collision", async () => {
    const first = fixture();
    const currentAuthority = new InMemoryCurrentAuthoritySnapshot({
      binding: first.binding,
      ownerEvidence: first.grant.ownerEvidence,
    });
    const receipts = new InMemoryReceiptRepository();
    const retained = new Map<string, AuthorityCustodyRead>();
    const executionKey = (
      pullRequest: number,
      value: AuthenticatedEfExecution,
    ) =>
      canonical([
        value.tenantId,
        value.repositoryId,
        pullRequest,
        value.subject,
        value.runId,
        value.runAttempt,
        value.verifierRevision,
      ]);
    const custody: AuthorityCustodyPort = {
      async retainAdmission(scope, value) {
        const key = executionKey(scope.pullRequest, value.execution);
        const existing = retained.get(key);
        if (existing) return existing;
        const stored: AuthorityCustodyRead = {
          requestDigest: value.requestDigest,
          grantDigest: value.grantDigest,
          grantWire: Uint8Array.from(value.grantWire),
          completionDigest: null,
          receiptDigest: null,
          receiptWire: null,
          publicationState: "absent",
        };
        retained.set(key, stored);
        return stored;
      },
      async retainCompletion() {
        throw new Error("completion is outside this regression");
      },
      async readExecution(scope, execution) {
        return retained.get(executionKey(scope.pullRequest, execution)) ?? null;
      },
      async readAdmission(scope, execution, requestDigest) {
        const value = retained.get(executionKey(scope.pullRequest, execution));
        return value?.requestDigest === requestDigest ? value : null;
      },
      async readCompletion() {
        return null;
      },
    };
    const transactions: EfAuthorityDecisionTransactionPort = {
      async transact(_execution, _scope, operation) {
        const authority = new SdkGrowthAuthority(
          {
            currentAuthority,
            receipts,
            clock: { now: () => 100 },
            publication: { enqueue: async () => {} },
          },
          1_000,
        );
        const result = await operation({ authority, custody });
        await authority.assertPendingDecisionsCurrentAtCommit();
        return result;
      },
    };
    const evidence = new Map<string, ReturnType<typeof trustedEvidence>>();
    evidence.set(first.execution.runId, trustedEvidence(first));
    const verifier: TrustedVerifierCustodyPort = {
      async load(execution) {
        const value = evidence.get(execution.runId);
        if (!value) throw new Error("missing trusted evidence");
        return structuredClone(value);
      },
      async verifyFinalizedReport() {},
    };
    const service = new EfAuthorityService(
      transactions,
      new PinnedEfAuthorityCodecV1(),
      verifier,
    );

    const firstWire = await service.admit(
      first.execution,
      "repo",
      42,
      admissionEnvelope(first.admission),
    );
    await expect(
      service.admit(
        first.execution,
        "repo",
        42,
        admissionEnvelope(first.admission),
      ),
    ).resolves.toEqual(firstWire);

    const secondExecution: AuthenticatedEfExecution = {
      ...first.execution,
      runId: "790",
      sourceCommit: "6".repeat(40),
    };
    const secondBinding: Binding = {
      ...first.binding,
      head: secondExecution.sourceCommit,
    };
    const secondAdmissionMaterial = {
      ...first.admission,
      assertions: {
        ...first.admission.assertions,
        runId: secondExecution.runId,
        sourceCommit: secondExecution.sourceCommit,
      },
      authorityBinding: secondBinding,
    };
    const secondRequestWire = admissionRequestWire(secondAdmissionMaterial);
    const secondAdmission: DecodedEfAdmission = {
      ...secondAdmissionMaterial,
      requestWire: secondRequestWire,
      requestDigest: sha256(secondRequestWire),
    };
    const secondOwnerEvidence = {
      ...first.grant.ownerEvidence,
      evidenceId: "owner-second-run",
      binding: secondBinding,
    };
    currentAuthority.replace({
      binding: secondBinding,
      ownerEvidence: secondOwnerEvidence,
    });
    evidence.set(
      secondExecution.runId,
      trustedEvidence({
        execution: secondExecution,
        binding: secondBinding,
        admission: secondAdmission,
      }),
    );

    expect(secondAdmission.requestDigest).not.toBe(
      first.admission.requestDigest,
    );
    await expect(
      service.admit(
        secondExecution,
        "repo",
        42,
        admissionEnvelope(secondAdmission),
      ),
    ).resolves.not.toEqual(firstWire);
    expect(retained.size).toBe(2);
  });
});

function trustedEvidence(
  value: Pick<
    ReturnType<typeof fixture>,
    "execution" | "binding" | "admission"
  >,
) {
  return {
    verifierRevision: value.execution.verifierRevision,
    sourceCommit: value.execution.sourceCommit,
    sourceTree: value.execution.sourceTree,
    candidateArchiveSha256: value.admission.candidateArchive.sha256,
    candidateArchiveSha512Sri: value.admission.candidateArchive.sha512Sri,
    releasedArchiveSha256: value.admission.releasedArchive.sha256,
    releasedArchiveSha512Sri: value.admission.releasedArchive.sha512Sri,
    toolArchiveSha256: value.admission.toolArchive.sha256,
    toolArchiveSha512Sri: value.admission.toolArchive.sha512Sri,
    installedDistributionDigest: value.admission.installedDistributionDigest,
    authorityBinding: value.binding,
  };
}

describe("pinned bridge-v1 EF codec", () => {
  it.each([8 * 1024 * 1024 - 2, 8 * 1024 * 1024 - 1, 8 * 1024 * 1024])(
    "decodes supported archive boundary %i without recursive validation",
    (size) => {
      const f = fixture();
      const envelope = admissionEnvelope(f.admission);
      const bytes = Buffer.alloc(size, 0xab);
      envelope.candidateArchive = {
        bytes: bytes.toString("base64"),
        sha256: sha256(bytes),
        sha512Sri: sha512(bytes),
      };
      const requestWire = admissionRequestWire({
        ...f.admission,
        candidateArchive: {
          bytes,
          sha256: sha256(bytes),
          sha512Sri: sha512(bytes),
        },
      });
      envelope.requestWire = requestWire.toString("base64");
      envelope.requestDigest = sha256(requestWire);
      const codec = new PinnedEfAuthorityCodecV1();
      expect(
        Buffer.from(
          codec.decodeAdmission(envelope).candidateArchive.bytes,
        ).equals(bytes),
      ).toBe(true);
      expect(Buffer.byteLength(canonical(envelope))).toBeLessThan(
        34 * 1024 * 1024,
      );
    },
  );

  it.each([
    "A".repeat(4 * Math.ceil((8 * 1024 * 1024) / 3) - 1) + "!",
    "A===",
    "AA=A",
    "AB==",
    "AAB=",
    "AAAA\n",
    "!!!!",
    "",
    "A".repeat(48 * 1024 * 1024 + 4),
  ])("rejects malformed or oversized binary %#", (bytes) => {
    const envelope = admissionEnvelope(fixture().admission);
    envelope.candidateArchive.bytes = bytes;
    expect(() =>
      new PinnedEfAuthorityCodecV1().decodeAdmission(envelope),
    ).toThrow("invalid-contract");
  });

  it("decodes the closed current envelope and binds decoded fields to exact wire", () => {
    const f = fixture();
    const codec = new PinnedEfAuthorityCodecV1();
    const binary = (value: Uint8Array) => Buffer.from(value).toString("base64");
    const envelope = admissionEnvelope(f.admission);
    expect(codec.decodeAdmission(envelope)).toMatchObject({
      requestDigest: f.admission.requestDigest,
      request: f.admission.request,
      assertions: f.admission.assertions,
      authorityBinding: f.binding,
    });
    expect(() =>
      codec.decodeAdmission({ ...envelope, untrusted: true }),
    ).toThrow("invalid-contract");
    expect(() =>
      codec.decodeAdmission({ ...envelope, requestWire: "not-base64" }),
    ).toThrow("invalid-contract");
    expect(() =>
      codec.decodeAdmission({
        ...envelope,
        assertions: { ...envelope.assertions, runId: "790" },
      }),
    ).toThrow("invalid-contract");
    expect(() =>
      codec.decodeAdmission({
        ...envelope,
        authorityBinding: {
          ...envelope.authorityBinding,
          policyDigest: "sha256:" + "b".repeat(64),
        },
      }),
    ).toThrow("invalid-contract");
    expect(() =>
      codec.decodeAdmission({
        ...envelope,
        candidateArchive: {
          ...envelope.candidateArchive,
          sha256: "sha256:" + "b".repeat(64),
        },
      }),
    ).toThrow("invalid-contract");
    const changedRequestWire = admissionRequestWire({
      ...f.admission,
      request: { ...f.admission.request, pullRequest: 43 },
    });
    expect(() =>
      codec.decodeAdmission({
        ...envelope,
        requestWire: binary(changedRequestWire),
        requestDigest: sha256(changedRequestWire),
      }),
    ).toThrow("invalid-contract");
    expect(() =>
      codec.decodeAdmission({ ...envelope, adapterVersion: 2 }),
    ).toThrow("invalid-contract");

    const completionEnvelope = {
      adapterVersion: 1,
      kind: "completion",
      requestDigest: f.completion.requestDigest,
      grantDigest: f.completion.grantDigest,
      completionDigest: f.completion.completionDigest,
      completionWire: binary(f.completion.completionWire),
      completion: f.completion.completion,
      assertions: f.completion.assertions,
      finalizedReport: binary(f.completion.finalizedReport),
      reportDigest: f.completion.reportDigest,
      reportDecision: f.completion.reportDecision,
    };
    expect(codec.decodeCompletion(completionEnvelope)).toMatchObject({
      completionDigest: f.completion.completionDigest,
      completion: f.completion.completion,
    });
    const changedCompletionWire = Buffer.from(
      canonical({ ...f.completion.completion, outcome: "failed" }),
    );
    expect(() =>
      codec.decodeCompletion({
        ...completionEnvelope,
        completionWire: binary(changedCompletionWire),
        completionDigest: sha256(changedCompletionWire),
      }),
    ).toThrow("invalid-contract");
  });
});
