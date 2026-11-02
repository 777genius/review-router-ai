import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const checker = resolve("scripts/check-architecture-boundaries.mjs");
const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("nested feature layer coverage", () => {
  it("counts pure domain and application files below v2 and account-limits prefixes", () => {
    const root = createFixture("export type Investigation = string;\n");
    for (const prefix of [
      "packages/features/review-publishing/src/v2",
      "packages/features/provider-accounts/src/account-limits",
    ]) {
      writeFile(
        root,
        `${prefix}/domain/model.ts`,
        "export type Model = string;\n",
      );
      writeFile(
        root,
        `${prefix}/application/use-case.ts`,
        'import type { Model } from "../domain/model";\nexport type Result = Model;\n',
      );
    }
    expect(runChecker(root)).toContain("passed for 5 domain/application files");
  });

  for (const prefix of [
    "packages/features/review-publishing/src/v2/domain",
    "packages/features/provider-accounts/src/account-limits/application",
  ]) {
    it.each([
      ["value import", 'import { PrismaClient } from "@prisma/client";\n'],
      ["type import", 'import type { PrismaClient } from "@prisma/client";\n'],
      [
        "dynamic import",
        'export const load = () => import("@prisma/client");\n',
      ],
      ["re-export", 'export type { PrismaClient } from "@prisma/client";\n'],
    ])("rejects a %s under " + prefix, (_kind, source) => {
      const root = createFixture("export type Investigation = string;\n");
      writeFile(root, `${prefix}/leak.ts`, source);
      expect(() => runChecker(root)).toThrow(
        /Prisma is an infrastructure adapter/,
      );
    });
  }

  it("keeps adapter siblings and outer-layer domain folders outside the core guard", () => {
    const root = createFixture("export type Investigation = string;\n");
    for (const outer of [
      "infrastructure",
      "interface",
      "composition",
      "adapters",
      "contract-source",
      "testing",
      "tests",
    ]) {
      // Contract-source retains its separate declarative-only ratchet.
      const source =
        outer === "contract-source"
          ? "export type Snapshot = string;\n"
          : 'import type { PrismaClient } from "@prisma/client";\n';
      writeFile(
        root,
        `packages/features/provider-accounts/src/account-limits/${outer}/adapter.ts`,
        source,
      );
      writeFile(
        root,
        `packages/features/review-publishing/src/v2/${outer}/domain/mapper.ts`,
        source,
      );
    }
    expect(runChecker(root)).toContain("passed for 1 domain/application files");
  });

  it.each(["infrastructure", "tests"])(
    "keeps %s folders inside a first domain layer governed",
    (nested) => {
      const root = createFixture("export type Investigation = string;\n");
      writeFile(
        root,
        `packages/features/review-publishing/src/v2/domain/${nested}/leak.test.ts`,
        'import type { PrismaClient } from "@prisma/client";\n',
      );
      expect(() => runChecker(root)).toThrow(
        /Prisma is an infrastructure adapter/,
      );
    },
  );
});

describe("review-investigations architecture ratchet", () => {
  it("accepts a strict package with domain-only dependencies", () => {
    const root = createFixture(
      'export enum InvestigationState { Open = "open" }\n',
    );

    expect(runChecker(root)).toContain("Architecture boundary check passed");
  });

  it("rejects domain imports from another feature context", () => {
    const root = createFixture(
      'import type { Foreign } from "@reviewrouter/features-review-evidence";\nexport type Local = Foreign;\n',
    );

    expect(() => runChecker(root)).toThrow(
      /strict review contexts communicate through consuming ports/,
    );
  });

  it("rejects domain imports from infrastructure", () => {
    const root = createFixture(
      'import type { Adapter } from "../infrastructure/adapter";\nexport type Local = Adapter;\n',
    );
    writeFile(
      root,
      "packages/features/review-investigations/src/infrastructure/adapter.ts",
      "export type Adapter = { readonly value: string };\n",
    );

    expect(() => runChecker(root)).toThrow(
      /strict domain code may depend only on its own domain/,
    );
  });

  it("rejects concurrent queries through one Prisma transaction client", () => {
    const root = createFixture(
      'export enum InvestigationState { Open = "open" }\n',
    );
    writeFile(
      root,
      "packages/features/review-investigations/src/infrastructure/prisma-store.ts",
      `export async function load(transaction: any) {
  return Promise.all([
    transaction.reviewRunAuthorization.findUnique(),
    transaction.reviewExecutionWorkSlotV2.findUnique(),
  ]);
}
`,
    );

    expect(() => runChecker(root)).toThrow(
      /Prisma interactive transaction clients use one database connection/,
    );
  });

  it("rejects aliased transaction clients passed through helpers", () => {
    const root = createFixture(
      'export enum InvestigationState { Open = "open" }\n',
    );
    writeFile(
      root,
      "packages/features/review-investigations/src/infrastructure/prisma-store.ts",
      `export async function load(prisma: any) {
  return prisma.$transaction(async (tx: any) => {
    const db = tx;
    return Promise.all([loadAuthorization(db), loadSlot(db)]);
  });
}
`,
    );

    expect(() => runChecker(root)).toThrow(
      /Prisma interactive transaction clients use one database connection/,
    );
  });

  it("rejects named transaction callbacks and prebuilt query arrays", () => {
    const root = createFixture(
      'export enum InvestigationState { Open = "open" }\n',
    );
    writeFile(
      root,
      "packages/features/review-investigations/src/infrastructure/prisma-store.ts",
      `export async function load(prisma: any) {
  const operation = async (tx: any) => {
    const queries = [tx.authorization.findUnique(), tx.slot.findUnique()];
    return Promise.all(queries);
  };
  return prisma.$transaction(operation);
}
`,
    );

    expect(() => runChecker(root)).toThrow(
      /Prisma interactive transaction clients use one database connection/,
    );
  });

  it("accepts sequential queries through a Prisma transaction client", () => {
    const root = createFixture(
      'export enum InvestigationState { Open = "open" }\n',
    );
    writeFile(
      root,
      "packages/features/review-investigations/src/infrastructure/prisma-store.ts",
      `export async function load(transaction: any) {
  const authorization = await transaction.reviewRunAuthorization.findUnique();
  const slot = await transaction.reviewExecutionWorkSlotV2.findUnique();
  return { authorization, slot };
}
`,
    );

    expect(runChecker(root)).toContain("Architecture boundary check passed");
  });
});

describe("release-rollout provider-neutral boundary", () => {
  it("rejects provider vocabulary from neutral application contracts", () => {
    const root = createFixture(
      'export enum InvestigationState { Open = "open" }\n',
    );
    writeFile(
      root,
      "packages/features/release-rollout/src/application/service-transition-ports.ts",
      "export interface RenderServiceContract { id: string }\n",
    );

    expect(() => runChecker(root)).toThrow(
      /release-rollout domain\/application contracts must be provider-neutral/,
    );
  });

  it("rejects adapter imports from neutral rollout policy", () => {
    const root = createFixture(
      'export enum InvestigationState { Open = "open" }\n',
    );
    writeFile(
      root,
      "packages/features/release-rollout/src/domain/service-transition.ts",
      'import { api } from "../adapters/vendor-api";\nexport const value = api;\n',
    );

    expect(() => runChecker(root)).toThrow(
      /release-rollout domain\/application must not import provider adapters/,
    );
  });
});

describe("usage producer protocol transport boundary", () => {
  function protocolFixture(): string {
    const root = createFixture("export type Investigation = string;\n");
    writeFile(
      root,
      "packages/protocol-review-action-v2/src/index.ts",
      "export {};\n",
    );
    writeFile(
      root,
      "packages/features/action-control-plane/package.json",
      JSON.stringify({
        exports: {
          ".": {},
          "./oidc": {
            types: "./src/oidc.ts",
            production: "./dist/oidc.js",
            default: "./src/oidc.ts",
          },
          "./v2": {},
          "./v2/contract-source": {},
        },
      }),
    );
    return root;
  }
  it.each(["./internal", "./*"])(
    "rejects an unreviewed export %s",
    (subpath) => {
      const root = protocolFixture();
      writeFile(
        root,
        "packages/features/action-control-plane/package.json",
        JSON.stringify({
          exports: {
            ".": {},
            "./oidc": {
              types: "./src/oidc.ts",
              production: "./dist/oidc.js",
              default: "./src/oidc.ts",
            },
            "./v2": {},
            "./v2/contract-source": {},
            [subpath]: "./src/index.ts",
          },
        }),
      );
      expect(() => runChecker(root)).toThrow(/reviewed oidc, v2 interface/);
    },
  );

  it("rejects redirecting the OIDC seam to the eager root adapter graph", () => {
    const root = protocolFixture();
    writeFile(
      root,
      "packages/features/action-control-plane/package.json",
      JSON.stringify({
        exports: {
          ".": {},
          "./oidc": {
            types: "./src/index.ts",
            production: "./dist/index.js",
            default: "./src/index.ts",
          },
          "./v2": {},
          "./v2/contract-source": {},
        },
      }),
    );
    expect(() => runChecker(root)).toThrow(
      /isolated reviewed verifier adapter/,
    );
  });

  it("accepts only the three named usage transport adapters and fixture", () => {
    const root = protocolFixture();
    for (const file of [
      "action/provider-usage-delivery.ts",
      "action/provider-usage-responses.ts",
      "tests/provider-usage-bootstrap.test.ts",
    ]) {
      writeFile(
        root,
        `packages/features/codex-oauth-rotating/src/${file}`,
        'import type { UsageFact } from "@reviewrouter/protocol-review-action-v2";\nexport type Fact = UsageFact;\n',
      );
    }
    expect(runChecker(root)).toContain("Architecture boundary check passed");
  });
  it.each(["action/random-usage.ts", "domain/provider-usage-delivery.ts"])(
    "rejects unapproved protocol consumption in %s",
    (file) => {
      const root = protocolFixture();
      writeFile(
        root,
        `packages/features/codex-oauth-rotating/src/${file}`,
        'import { UsageDelivery } from "@reviewrouter/protocol-review-action-v2/usage-producer-v1";\nexport const value = UsageDelivery;\n',
      );
      expect(() => runChecker(root)).toThrow(
        /generated (?:Review Action v2 protocol|transport DTOs)/,
      );
    },
  );
});

function createFixture(domainSource: string): string {
  const root = mkdtempSync(join(tmpdir(), "reviewrouter-architecture-"));
  fixtureRoots.push(root);
  writeFile(
    root,
    "packages/features/review-investigations/package.json",
    JSON.stringify({
      exports: {
        ".": {},
        "./composition": {},
        "./contract-source": {},
        "./testing": {},
      },
    }),
  );
  writeFile(
    root,
    "packages/features/review-investigations/src/index.ts",
    'export * from "./domain/review-investigation";\n',
  );
  writeFile(
    root,
    "packages/features/review-investigations/src/domain/review-investigation.ts",
    domainSource,
  );
  return root;
}

function writeFile(root: string, path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
}

function runChecker(root: string): string {
  return execFileSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      REVIEWROUTER_ARCHITECTURE_ROOT: root,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
