import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

describe("account metadata host seams", () => {
  it("allows the public feature composition and SDK ports without interpreting comments as imports", () => {
    const root = createFixture("export type Investigation = string;\n");
    writeFile(
      root,
      "apps/web/src/server/account-metadata-service.ts",
      'import { createAccountMetadata } from "@reviewrouter/features-provider-accounts/account-metadata/composition";\n// import "provider-private";\n',
    );
    writeFile(
      root,
      "apps/web/src/server/account-metadata-sdk-reader.ts",
      'import { createManagementClient } from "@agent-teams/account-gateway/http";\n',
    );
    expect(runChecker(root)).toContain("Architecture boundary check passed");
  });
  it.each([
    ["service", 'import { client } from "@agent-teams/account-gateway/http";'],
    ["sdk-reader", 'export { refresh } from "../../sub2api/private";'],
    ["sdk-reader", 'type Native = import("provider-private").Native;'],
    [
      "service",
      'const request = () => fetch("https://provider.example.invalid");',
    ],
    ["sdk-reader", "const request = (path: string) => import(path);"],
  ])("rejects a crossed %s boundary through real syntax", (kind, source) => {
    const root = createFixture("export type Investigation = string;\n");
    writeFile(root, `apps/web/src/server/account-metadata-${kind}.ts`, source);
    expect(() => runChecker(root)).toThrow(
      /account metadata host must use only/,
    );
  });
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

describe("review-execution private owner boundaries", () => {
  it("allows one-way pure mapping and transaction read helpers", () => {
    const root = createFixture("export type Investigation = string;\n");
    writeFile(
      root,
      "packages/features/review-executions/src/infrastructure/prisma/prisma-review-execution-mappers.ts",
      'import type { ReviewExecution } from "../../domain/review-execution";\n',
    );
    writeFile(
      root,
      "packages/features/review-executions/src/infrastructure/prisma/prisma-review-execution-snapshot.ts",
      'import { executionToDomain } from "./prisma-review-execution-mappers";\n',
    );
    writeFile(
      root,
      "apps/api/src/review-action-v2-execution-result-mappers.ts",
      'import type { ReviewExecution } from "@reviewrouter/features-review-executions";\n',
    );
    expect(runChecker(root)).toContain("Architecture boundary check passed");
  });

  it.each([
    [
      "prisma-review-execution-mappers.ts",
      'import type { Store } from "./prisma-review-execution-store";\n',
    ],
    [
      "prisma-review-execution-snapshot.ts",
      'export { PrismaReviewExecutionStore } from "./prisma-review-execution-store";\n',
    ],
    [
      "prisma-review-execution-snapshot.ts",
      'export const load = () => import("./prisma-review-execution-store");\n',
    ],
  ])("rejects reverse store dependencies from %s", (name, source) => {
    const root = createFixture("export type Investigation = string;\n");
    writeFile(
      root,
      `packages/features/review-executions/src/infrastructure/prisma/${name}`,
      source,
    );
    expect(() => runChecker(root)).toThrow(
      /private readers and mappers must not import their store/,
    );
  });

  it.each([
    'import type { Handlers } from "./review-action-v2-execution-evidence-composition";\n',
    'export type { Handlers } from "./review-action-v2-execution-evidence-composition.js";\n',
    'import { PrismaClient } from "@prisma/client";\n',
  ])(
    "rejects reverse or infrastructure imports from API result mappers",
    (source) => {
      const root = createFixture("export type Investigation = string;\n");
      writeFile(
        root,
        "apps/api/src/review-action-v2-execution-result-mappers.ts",
        source,
      );
      expect(() => runChecker(root)).toThrow(
        /pure result mappers must not import their composition host or infrastructure SDK/,
      );
    },
  );
  it.each([
    'import type { Handlers } from "./review-action-v2-context-attestation-composition";\n',
    'export type { Handlers } from "./review-action-v2-context-attestation-composition.js";\n',
    'import { PrismaClient } from "@prisma/client";\n',
  ])("rejects side effects in context response mapping", (source) => {
    const root = createFixture("export type Investigation = string;\n");
    writeFile(
      root,
      "apps/api/src/review-action-v2-context-result-mappers.ts",
      source,
    );
    expect(() => runChecker(root)).toThrow(
      /pure result mappers must not import their composition host or infrastructure SDK/,
    );
  });
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

  it.each([
    [
      "qualified alias",
      "export async function load(db: Prisma.TransactionClient) { return Promise.all([db.first(), db.second()]); }",
    ],
    [
      "unqualified alias",
      "export async function load(db: TransactionClient) { return Promise.all([db.first(), db.second()]); }",
    ],
    [
      "optional typed alias",
      "export async function load(db?: Prisma.TransactionClient) { return Promise.all([db?.first(), db?.second()]); }",
    ],
    [
      "defaulted transaction name",
      "export async function load(transaction = fallback) { return Promise.all([transaction.first(), transaction.second()]); }",
    ],
    [
      "defaulted typed alias",
      "export async function load(db: Prisma.TransactionClient = fallback) { return Promise.all([db.first(), db.second()]); }",
    ],
    [
      "typed method parameter",
      "export class Store { async load(db: Prisma.TransactionClient) { return Promise.all([db.first(), db.second()]); } }",
    ],
    [
      "constructor parameter property",
      "export class Store { constructor(private db: Prisma.TransactionClient) { void Promise.all([db.first(), db.second()]); } }",
    ],
    [
      "defaulted constructor parameter property",
      "export class Store { constructor(private db: TransactionClient = fallback) { void Promise.all([db.first(), db.second()]); } }",
    ],
    [
      "rest parameter annotation",
      "export async function load(...db: TransactionClient[]) { return Promise.all([db[0].first(), db[0].second()]); }",
    ],
  ])("rejects concurrent queries through a %s", (_name, source) => {
    const root = createFixture("export type Investigation = string;\n");
    writeFile(
      root,
      "packages/features/review-investigations/src/infrastructure/prisma-store.ts",
      source,
    );
    expect(() => runChecker(root)).toThrow(
      /Prisma interactive transaction clients use one database connection/,
    );
  });

  it.each([
    [
      "object method",
      "const methods = { execute(db: Db) { return Promise.all([db.first(), db.second()]); } }; const execute = methods.execute; prisma.$transaction(execute);",
    ],
    [
      "class method",
      "class Queries { static execute(db: Db) { return Promise.all([db.first(), db.second()]); } } const execute = Queries.execute; prisma.$transaction(execute);",
    ],
  ])("rejects aliased named %s transaction callbacks", (_name, source) => {
    const root = createFixture("export type Investigation = string;\n");
    writeFile(
      root,
      "packages/features/review-investigations/src/infrastructure/prisma-store.ts",
      source,
    );
    expect(() => runChecker(root)).toThrow(
      /Prisma interactive transaction clients use one database connection/,
    );
  });

  it.each([
    [
      "sequential typed alias",
      "export async function load(db: Prisma.TransactionClient) { const first = await db.first(); const second = await db.second(); return { first, second }; }",
    ],
    [
      "unrelated type suffix",
      "export async function load(db: TransactionClientPool) { return Promise.all([db.first(), db.second()]); }",
    ],
    [
      "ordinary pooled client",
      "export async function load(db: PrismaClient) { return Promise.all([db.first(), db.second()]); }",
    ],
  ])("accepts a %s", (_name, source) => {
    const root = createFixture("export type Investigation = string;\n");
    writeFile(
      root,
      "packages/features/review-investigations/src/infrastructure/prisma-store.ts",
      source,
    );
    expect(runChecker(root)).toContain("Architecture boundary check passed");
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
          "./conflict-runtime-contract": {
            types: "./src/conflict-runtime-contract.ts",
            production: "./dist/conflict-runtime-contract.js",
            default: "./src/conflict-runtime-contract.ts",
          },
        },
      }),
    );
    writeFile(
      root,
      "packages/features/action-control-plane/src/conflict-runtime-contract.ts",
      'export { actionConflictReviewRuntimeConfigSchema, conflictReviewAdvisoryStatusContext, conflictReviewSummaryMaxBytes } from "./domain/conflict-review-runtime-contract.js";\nexport type { ActionConflictReviewRuntimeConfig } from "./domain/conflict-review-runtime-contract.js";\n',
    );
    writeFile(
      root,
      "packages/features/action-control-plane/src/domain/conflict-review-runtime-contract.ts",
      'import { z } from "zod";\nexport const schema = z.string();\n',
    );
    return root;
  }

  it("accepts the pure published conflict runtime contract", () => {
    const root = protocolFixture();
    writeFile(
      root,
      "packages/features/conflict-runtime/src/domain/conflict-runtime.ts",
      'import { actionConflictReviewRuntimeConfigSchema } from "@reviewrouter/features-action-control-plane/conflict-runtime-contract";\n',
    );
    expect(runChecker(root)).toContain("Architecture boundary check passed");
  });

  it.each([
    'export { PrismaActionControlPlaneRepository } from "./infrastructure/prisma/prisma-action-control-plane-repository.js";\n',
    'export type { PrismaActionControlPlaneRepository } from "./infrastructure/prisma/prisma-action-control-plane-repository.js";\n',
    'export * from "./domain/conflict-review-runtime-contract.js";\n',
    'import { PrismaClient } from "@prisma/client";\n',
  ])(
    "rejects extra exports and infrastructure in the conflict runtime facade",
    (leak) => {
      const root = protocolFixture();
      writeFile(
        root,
        "packages/features/action-control-plane/src/conflict-runtime-contract.ts",
        'export { actionConflictReviewRuntimeConfigSchema, conflictReviewAdvisoryStatusContext, conflictReviewSummaryMaxBytes } from "./domain/conflict-review-runtime-contract.js";\nexport type { ActionConflictReviewRuntimeConfig } from "./domain/conflict-review-runtime-contract.js";\n' +
          leak,
      );
      expect(() => runChecker(root)).toThrow(/pure published domain contract/);
    },
  );

  it("rejects consuming the eager action control plane root from conflict runtime", () => {
    const root = protocolFixture();
    writeFile(
      root,
      "packages/features/conflict-runtime/src/domain/conflict-runtime.ts",
      'import type { ActionConflictReviewRuntimeConfig } from "@reviewrouter/features-action-control-plane";\n',
    );
    expect(() => runChecker(root)).toThrow(/narrow published contracts/);
  });

  it("rejects a new application or adapter importing the eager Action root", () => {
    const root = protocolFixture();
    writeFile(
      root,
      "packages/features/conflict-runtime/src/application/leaked.ts",
      'import type { ActionConflictReviewRuntimeConfig } from "@reviewrouter/features-action-control-plane";\n',
    );
    expect(() => runChecker(root)).toThrow(/narrow published contracts/);
  });

  it.each([
    "void import(`@reviewrouter/features-action-control-plane`);\n",
    'void import(/* reviewed */ "@reviewrouter/features-action-control-plane");\n',
    'type Contract = import(/* reviewed */ "@reviewrouter/features-action-control-plane").ActionConflictReviewRuntimeConfig;\n',
    'import Contract = require("@reviewrouter/features-action-control-plane");\n',
    'const target = "@reviewrouter/features-action-control-plane"; void import(target);\n',
    'const target = "@reviewrouter/features-action-control-plane"; require(target);\n',
  ])(
    "rejects hidden or computed eager-root imports in conflict runtime",
    (leak) => {
      const root = protocolFixture();
      writeFile(
        root,
        "packages/features/conflict-runtime/src/application/leaked.ts",
        leak,
      );
      expect(() => runChecker(root)).toThrow(/narrow published contracts/);
    },
  );

  it("ignores module syntax inside comments and strings in the contract owner", () => {
    const root = protocolFixture();
    writeFile(
      root,
      "packages/features/action-control-plane/src/domain/conflict-review-runtime-contract.ts",
      '// import("unapproved-example");\nconst example = \'import("unapproved-example")\';\n',
    );
    expect(runChecker(root)).toContain("Architecture boundary check passed");
  });

  it("permits the two pre-existing outer adapters to consume unrelated legacy Action APIs", () => {
    const root = protocolFixture();
    writeFile(
      root,
      "packages/features/conflict-runtime/src/infrastructure/action-control-plane-runtime-config-client.ts",
      'import { actionRuntimeConfigResponseSchema } from "@reviewrouter/features-action-control-plane";\n',
    );
    writeFile(
      root,
      "packages/features/conflict-runtime/src/infrastructure/github-actions-oidc-token-provider.ts",
      'import { defaultActionOidcAudience } from "@reviewrouter/features-action-control-plane";\n',
    );
    expect(runChecker(root)).toContain("Architecture boundary check passed");
  });

  it("rejects redirecting the domain contract to the eager root or a source-only entrypoint", () => {
    const root = protocolFixture();
    const manifestPath = "packages/features/action-control-plane/package.json";
    const manifest = JSON.parse(readFileSync(join(root, manifestPath), "utf8"));
    manifest.exports["./conflict-runtime-contract"] = {
      default: "./src/index.ts",
    };
    writeFile(root, manifestPath, JSON.stringify(manifest));
    expect(() => runChecker(root)).toThrow(
      /exact source, types and production exports/,
    );
  });

  it.each([
    'export { PrismaActionControlPlaneRepository } from "../infrastructure/prisma/prisma-action-control-plane-repository.js";\n',
    'import type { GatewaySession } from "@reviewrouter/features-review-context-attestation";\n',
    'export * from "../index.js";\n',
    "void import(`../infrastructure/prisma/prisma-action-control-plane-repository.js`);\n",
    'void import(/* reviewed */ "../infrastructure/prisma/prisma-action-control-plane-repository.js");\n',
    'type Adapter = import(/* reviewed */ "../infrastructure/prisma/prisma-action-control-plane-repository.js").PrismaActionControlPlaneRepository;\n',
    'import Adapter = require("../infrastructure/prisma/prisma-action-control-plane-repository.js");\n',
    'const target = "../infrastructure/prisma/prisma-action-control-plane-repository.js"; void import(target);\n',
    'const target = "zod"; require(target);\n',
  ])(
    "rejects leaking dependencies from the standalone domain owner",
    (leak) => {
      const root = protocolFixture();
      writeFile(
        root,
        "packages/features/action-control-plane/src/domain/conflict-review-runtime-contract.ts",
        'import { z } from "zod";\nexport const schema = z.string();\n' + leak,
      );
      expect(() => runChecker(root)).toThrow(/domain contract may depend only/);
    },
  );

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
            "./conflict-runtime-contract": {
              types: "./src/conflict-runtime-contract.ts",
              production: "./dist/conflict-runtime-contract.js",
              default: "./src/conflict-runtime-contract.ts",
            },
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
          "./conflict-runtime-contract": {
            types: "./src/conflict-runtime-contract.ts",
            production: "./dist/conflict-runtime-contract.js",
            default: "./src/conflict-runtime-contract.ts",
          },
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

describe("application and composition boundaries", () => {
  it.each([
    "workflow-provisioning",
    "provider-setup",
    "review-config",
    "audit-log",
  ])(
    "allows %s application exports and a separate production composition entrypoint",
    (feature) => {
      const root = compositionFixture(feature);
      expect(runChecker(root)).toContain("Architecture boundary check passed");
    },
  );

  it.each([
    ["direct value export", 'export * from "./infrastructure/adapter";\n'],
    [
      "direct type export",
      'export type { Adapter } from "./infrastructure/adapter";\n',
    ],
    ["forwarding export", 'export * from "./public-contracts";\n'],
  ])("rejects root adapter exposure through a %s", (_kind, source) => {
    const root = compositionFixture("review-config");
    writeFile(root, "packages/features/review-config/src/index.ts", source);
    writeFile(
      root,
      "packages/features/review-config/src/public-contracts.ts",
      'export type { Adapter } from "./composition/index.js";\n',
    );
    expect(() => runChecker(root)).toThrow(/application root cannot expose/);
  });

  it.each([
    'import { Adapter } from "@reviewrouter/features-review-config/composition";\n',
    'import type { Adapter } from "@reviewrouter/features-review-config/composition";\n',
    'export type { Adapter } from "@reviewrouter/features-review-config/composition";\n',
    'export const load = () => import("@reviewrouter/features-review-config/composition");\n',
    'import type { Adapter } from "../../../review-config/src/composition/index.js";\n',
  ])("rejects a core consumer's outer dependency: %s", (source) => {
    const root = compositionFixture("review-config");
    writeFile(
      root,
      "packages/features/consumer/src/application/use-case.ts",
      source,
    );
    expect(() => runChecker(root)).toThrow(
      /core cannot depend on selected composition/,
    );
  });

  it("rejects own relative directory imports into composition", () => {
    const root = compositionFixture("audit-log");
    writeFile(
      root,
      "packages/features/audit-log/src/application/use-case.ts",
      'import type { Adapter } from "../composition";\n',
    );
    expect(() => runChecker(root)).toThrow(
      /core cannot depend on selected composition/,
    );
  });

  it("rejects provider setup memory adapters forwarded by the application root", () => {
    const root = compositionFixture("provider-setup");
    writeFile(
      root,
      "packages/features/provider-setup/src/index.ts",
      'export * from "./setup-contracts";\n',
    );
    writeFile(
      root,
      "packages/features/provider-setup/src/setup-contracts.ts",
      'export * from "./infrastructure/memory/store";\n',
    );
    expect(() => runChecker(root)).toThrow(/application root cannot expose/);
  });

  it("keeps provider setup transaction authority out of application consumers", () => {
    const root = compositionFixture("provider-setup");
    writeFile(
      root,
      "packages/features/consumer/src/application/setup.ts",
      'import type { AdmittedOperation } from "@reviewrouter/features-provider-setup/composition";\n',
    );
    expect(() => runChecker(root)).toThrow(
      /core cannot depend on selected composition/,
    );
  });

  it("keeps outer composition consumers and independent legacy package roots allowed", () => {
    const root = compositionFixture("workflow-provisioning");
    writeFile(
      root,
      "packages/features/consumer/src/infrastructure/adapter.ts",
      'import type { Adapter } from "@reviewrouter/features-workflow-provisioning/composition";\n',
    );
    writeFile(
      root,
      "packages/features/workflow-provisioning/src/domain/policy.ts",
      'export { legacyPolicy } from "@reviewrouter/features-codex-oauth-rotating";\n',
    );
    expect(runChecker(root)).toContain("Architecture boundary check passed");
  });

  it("rejects a source-only composition export without its production condition", () => {
    const root = compositionFixture("audit-log");
    writeFile(
      root,
      "packages/features/audit-log/package.json",
      JSON.stringify({
        exports: { "./composition": { default: "./src/composition/index.ts" } },
      }),
    );
    expect(() => runChecker(root)).toThrow(
      /source, type and production composition entrypoints/,
    );
  });

  it.each(["./store", "./review-configuration"])(
    "rejects an adapter exposed through the package alias %s",
    (subpath) => {
      const root = compositionFixture("review-config");
      const manifestPath = "packages/features/review-config/package.json";
      const manifest = JSON.parse(
        readFileSync(join(root, manifestPath), "utf8"),
      );
      manifest.exports[subpath] = {
        types: "./src/infrastructure/adapter.ts",
        production: "./dist/infrastructure/adapter.js",
        default: "./src/infrastructure/adapter.ts",
      };
      writeFile(root, manifestPath, JSON.stringify(manifest));
      writeFile(
        root,
        "packages/features/consumer/src/application/use-case.ts",
        `import { Adapter } from "@reviewrouter/features-review-config/${subpath.slice(2)}";\n`,
      );
      expect(() => runChecker(root)).toThrow(/only approved public subpaths/);
    },
  );

  it("checks approved domain subpath forwarding without a root re-export", () => {
    const root = compositionFixture("review-config");
    const manifestPath = "packages/features/review-config/package.json";
    const manifest = JSON.parse(readFileSync(join(root, manifestPath), "utf8"));
    manifest.exports["./review-configuration"] = {
      types: "./src/domain/review-configuration.ts",
      production: "./dist/domain/review-configuration.js",
      default: "./src/domain/review-configuration.ts",
    };
    writeFile(root, manifestPath, JSON.stringify(manifest));
    writeFile(
      root,
      "packages/features/review-config/src/domain/review-configuration.ts",
      'export { Adapter } from "../public-proxy";\n',
    );
    writeFile(
      root,
      "packages/features/review-config/src/public-proxy.ts",
      'export { Adapter } from "./infrastructure/adapter";\n',
    );
    expect(() => runChecker(root)).toThrow(/application root cannot expose/);
  });
});

function compositionFixture(feature: string): string {
  const root = createFixture("export type Investigation = string;\n");
  const prefix = `packages/features/${feature}`;
  writeFile(
    root,
    `${prefix}/package.json`,
    JSON.stringify({
      exports: {
        ".": {
          types: "./src/index.ts",
          production: "./dist/index.js",
          default: "./src/index.ts",
        },
        "./composition": {
          types: "./src/composition/index.ts",
          production: "./dist/composition/index.js",
          default: "./src/composition/index.ts",
        },
      },
    }),
  );
  writeFile(
    root,
    `${prefix}/src/index.ts`,
    'export * from "./application/use-case";\n',
  );
  writeFile(
    root,
    `${prefix}/src/application/use-case.ts`,
    'export type { Policy } from "../domain/policy";\n',
  );
  writeFile(
    root,
    `${prefix}/src/domain/policy.ts`,
    "export type Policy = string;\n",
  );
  writeFile(
    root,
    `${prefix}/src/composition/index.ts`,
    'export * from "../infrastructure/adapter";\n',
  );
  writeFile(
    root,
    `${prefix}/src/infrastructure/adapter.ts`,
    "export class Adapter {}\n",
  );
  return root;
}

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
