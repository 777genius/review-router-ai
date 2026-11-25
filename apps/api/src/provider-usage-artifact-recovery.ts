import { inflateRawSync } from "node:zlib";
import { App } from "@octokit/app";
import type { FastifyInstance } from "fastify";

const maxArchiveBytes = 2 * 1024 * 1024;
const maxReportBytes = 1024 * 1024;
const fail = (): never => {
  throw new Error("usage_artifact_invalid");
};

/** Single-file ZIP reader. No files are extracted onto the host filesystem. */
export function readUsageArtifactZip(input: Uint8Array): unknown {
  const bytes = Buffer.from(input);
  if (bytes.length > maxArchiveBytes || bytes.length < 22) return fail();
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    bytes.readUInt32LE(end) !== 0x06054b50
  )
    end--;
  if (
    end < 0 ||
    end + 22 > bytes.length ||
    bytes.readUInt32LE(end) !== 0x06054b50
  )
    return fail();
  const entries = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const central = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    entries !== 1 ||
    bytes.readUInt16LE(end + 8) !== 1 ||
    end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length ||
    central + centralSize !== end ||
    central + 46 > end
  )
    return fail();
  if (bytes.readUInt32LE(central) !== 0x02014b50) return fail();
  const flags = bytes.readUInt16LE(central + 8),
    method = bytes.readUInt16LE(central + 10);
  const crc = bytes.readUInt32LE(central + 16),
    compressed = bytes.readUInt32LE(central + 20),
    size = bytes.readUInt32LE(central + 24);
  const nameLength = bytes.readUInt16LE(central + 28),
    extraLength = bytes.readUInt16LE(central + 30),
    commentLength = bytes.readUInt16LE(central + 32);
  const local = bytes.readUInt32LE(central + 42);
  const name = bytes
    .subarray(central + 46, central + 46 + nameLength)
    .toString("utf8");
  if (
    name !== "report.json" ||
    central + 46 + nameLength + extraLength + commentLength !== end ||
    size > maxReportBytes ||
    compressed > maxArchiveBytes ||
    flags & ~0x0808 ||
    ![0, 8].includes(method) ||
    local !== 0 ||
    local + 30 > central ||
    bytes.readUInt32LE(local) !== 0x04034b50 ||
    bytes.readUInt16LE(local + 6) !== flags ||
    bytes.readUInt16LE(local + 8) !== method
  )
    return fail();
  const localNameLength = bytes.readUInt16LE(local + 26),
    localExtraLength = bytes.readUInt16LE(local + 28);
  const start = local + 30 + localNameLength + localExtraLength;
  if (
    bytes
      .subarray(local + 30, local + 30 + localNameLength)
      .toString("utf8") !== name ||
    start + compressed > central
  )
    return fail();
  const dataEnd = start + compressed;
  if (flags & 8) {
    const descriptor =
      central - dataEnd === 16 && bytes.readUInt32LE(dataEnd) === 0x08074b50
        ? dataEnd + 4
        : dataEnd;
    if (
      central - descriptor !== 12 ||
      bytes.readUInt32LE(descriptor) !== crc ||
      bytes.readUInt32LE(descriptor + 4) !== compressed ||
      bytes.readUInt32LE(descriptor + 8) !== size
    )
      return fail();
  } else if (
    dataEnd !== central ||
    bytes.readUInt32LE(local + 14) !== crc ||
    bytes.readUInt32LE(local + 18) !== compressed ||
    bytes.readUInt32LE(local + 22) !== size
  )
    return fail();
  const payload = bytes.subarray(start, dataEnd);
  const decoded =
    method === 0
      ? payload
      : inflateRawSync(payload, { maxOutputLength: maxReportBytes });
  if (decoded.length !== size || crc32(decoded) !== crc) return fail();
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
}
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

type Requester = {
  request(
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
};
type InstallationApp = {
  getInstallationOctokit(id: number): Promise<Requester>;
};
export type UsageArtifactTarget = {
  installationId: string;
  repositoryId: string;
  repositoryFullName: string;
  runId: string;
  runAttempt: number;
  invocationId: string;
};
export class ProviderUsageArtifactReader {
  private readonly app: InstallationApp;
  constructor(input: {
    app?: InstallationApp;
    appId?: string;
    privateKey?: string;
  }) {
    this.app =
      input.app ??
      new App({ appId: input.appId!, privateKey: input.privateKey! });
  }
  async read(
    target: UsageArtifactTarget,
    requireCompleted = false,
  ): Promise<{
    body: unknown;
    artifactName: string;
    artifactId: number;
  } | null> {
    for (const id of [target.installationId, target.repositoryId, target.runId])
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
        return fail();
    if (!Number.isSafeInteger(target.runAttempt) || target.runAttempt < 1)
      return fail();
    const parts = target.repositoryFullName.split("/");
    if (parts.length !== 2 || parts.some((p) => !/^[A-Za-z0-9_.-]+$/.test(p)))
      return fail();
    const client = await this.app.getInstallationOctokit(
      Number(target.installationId),
    );
    const base = {
      owner: parts[0],
      repo: parts[1],
      run_id: Number(target.runId),
    };
    const request = (route: string, parameters: Record<string, unknown> = {}) =>
      client.request(route, {
        ...base,
        ...parameters,
        request: { timeout: 15000, fetch: boundedFetch },
      });
    const run = (
      await request(
        "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
        { attempt_number: target.runAttempt },
      )
    ).data;
    if (
      !record(run) ||
      !record(run.repository) ||
      String(run.repository.id) !== target.repositoryId ||
      String(run.id) !== target.runId ||
      run.run_attempt !== target.runAttempt
    )
      return fail();
    if (run.status !== "completed") {
      if (requireCompleted) throw new Error("usage_artifact_run_pending");
      return null;
    }
    const artifactName = `reviewrouter-usage-v1-${target.invocationId}-${target.runAttempt}`;
    let match: Record<string, unknown> | undefined;
    // Bound pagination and reject ambiguity, rather than importing another rerun's artifact.
    for (let page = 1; page <= 5; page++) {
      const listing = (
        await request(
          "GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts",
          { per_page: 100, page, name: artifactName },
        )
      ).data;
      if (!record(listing) || !Array.isArray(listing.artifacts)) return fail();
      for (const item of listing.artifacts) {
        if (!record(item) || item.name !== artifactName) continue;
        if (match) return fail();
        match = item;
      }
      if (listing.artifacts.length < 100) break;
      if (page === 5) return fail();
    }
    if (!match) return null;
    if (
      match.expired !== false ||
      typeof match.id !== "number" ||
      !Number.isSafeInteger(match.id) ||
      typeof match.size_in_bytes !== "number" ||
      match.size_in_bytes > maxArchiveBytes ||
      match.size_in_bytes < 1 ||
      !record(match.workflow_run) ||
      String(match.workflow_run.id) !== target.runId ||
      String(match.workflow_run.repository_id) !== target.repositoryId
    )
      return fail();
    const archive = (
      await request(
        "GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}",
        { artifact_id: match.id, archive_format: "zip" },
      )
    ).data;
    if (!(archive instanceof ArrayBuffer) && !ArrayBuffer.isView(archive))
      return fail();
    const bytes =
      archive instanceof ArrayBuffer
        ? new Uint8Array(archive)
        : new Uint8Array(
            archive.buffer,
            archive.byteOffset,
            archive.byteLength,
          );
    return {
      body: readUsageArtifactZip(bytes),
      artifactName,
      artifactId: match.id,
    };
  }
  async remove(target: UsageArtifactTarget, artifactId: number): Promise<void> {
    if (
      !Number.isSafeInteger(artifactId) ||
      artifactId < 1 ||
      !/^[1-9]\d*$/.test(target.installationId)
    )
      return fail();
    const [owner, repo] = target.repositoryFullName.split("/");
    const client = await this.app.getInstallationOctokit(
      Number(target.installationId),
    );
    try {
      await client.request(
        "DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}",
        {
          owner,
          repo,
          artifact_id: artifactId,
          request: { timeout: 15000, fetch: boundedFetch },
        },
      );
    } catch (error) {
      if (!record(error) || error.status !== 404) throw error;
    }
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function boundedFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    signal: AbortSignal.timeout(15000),
  });
  if (Number(response.headers.get("content-length") ?? 0) > maxArchiveBytes) {
    await response.body?.cancel();
    return fail();
  }
  const reader = response.body?.getReader();
  if (!reader) return response;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maxArchiveBytes) return fail();
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return new Response(
    [204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  );
}

export function registerProviderUsageRecovery(
  app: FastifyInstance,
  recovery: { runBatch(): Promise<unknown> },
): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<unknown> | undefined;
  const tick = () => {
    if (!pending)
      pending = recovery
        .runBatch()
        .catch(() => app.log.warn({ event: "provider_usage_recovery_failed" }))
        .finally(() => {
          pending = undefined;
        });
  };
  app.addHook("onReady", async () => {
    tick();
    timer = setInterval(tick, 60000);
    timer.unref();
  });
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
    await pending;
  });
}
