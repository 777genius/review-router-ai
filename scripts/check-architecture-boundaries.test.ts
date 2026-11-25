import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

describe("architecture checker syntax and path regressions", () => {
  it.each([
    [
      "commented static import",
      'import/* reviewed */ { PrismaClient } from "@prisma/client";',
    ],
    [
      "commented dynamic import",
      'void import(/* reviewed */ "@prisma/client");',
    ],
    ["static template import", "void import(`@prisma/client`);"],
    [
      "escaped module string",
      'import { PrismaClient } from "@prisma/\\u0063lient";',
    ],
    [
      "commented re-export",
      'export/* reviewed */ { PrismaClient } from "@prisma/client";',
    ],
    [
      "commented import type",
      'type Client = import(/* reviewed */ "@prisma/client").PrismaClient;',
    ],
  ])("rejects a forbidden target in a %s", (_name, source) => {
    const root = createFixture(source);
    expect(() => runChecker(root)).toThrow(
      /Prisma is an infrastructure adapter/,
    );
  });

  it.each([
    '// import { PrismaClient } from "@prisma/client";\nexport type Local = string;',
    "export const example = 'import(\"@prisma/client\")';",
  ])("ignores import examples in comments and strings", (source) => {
    expect(runChecker(createFixture(source))).toContain(
      "Architecture boundary check passed",
    );
  });

  it.each([
    'import/* reviewed */ type { Adapter } from "../infrastructure/adapter.js";',
    'export/* reviewed */ type { Adapter } from "../infrastructure/adapter.js";',
  ])("rejects commented imports across a strict layer", (source) => {
    expect(() => runChecker(createFixture(source))).toThrow(
      /strict domain code may depend only on its own domain/,
    );
  });

  it("rejects commented imports from another strict context", () => {
    const root = createFixture(
      'import/* reviewed */ type { Foreign } from "@reviewrouter/features-review-evidence";',
    );
    expect(() => runChecker(root)).toThrow(
      /strict review contexts communicate through consuming ports/,
    );
  });

  it("rejects unknown imports only where the strict allowlist requires a known dependency", () => {
    const root = createFixture("export type Local = string;");
    writeFile(
      root,
      "packages/features/legacy/src/application/loader.ts",
      "export const load = (target: string) => import(target);",
    );
    expect(runChecker(root)).toContain("Architecture boundary check passed");
    writeFile(
      root,
      "packages/features/review-investigations/src/domain/loader.ts",
      "export const load = (target: string) => import(target);",
    );
    expect(() => runChecker(root)).toThrow(
      /strict domain\/application code cannot import/,
    );
  });

  it("parses TSX by its actual filename when tracing a selected public root", () => {
    const root = compositionFixture("audit-log");
    writeFile(
      root,
      "packages/features/audit-log/src/index.ts",
      'export * from "./application/view.js";',
    );
    writeFile(
      root,
      "packages/features/audit-log/src/application/view.tsx",
      'export const view = <span>import("@prisma/client")</span>;',
    );
    expect(runChecker(root)).toContain("Architecture boundary check passed");
    writeFile(
      root,
      "packages/features/audit-log/src/application/view.tsx",
      'export const view = <span />;\nexport/* reviewed */ { Adapter } from "../composition/index.js";',
    );
    expect(() => runChecker(root)).toThrow(
      /application root cannot expose composition/,
    );
  });

  it("keeps static imports, re-exports and dynamic import diagnostics in their established order", () => {
    const root = createFixture(
      'void import("next");\nexport { fastify } from "fastify";\nimport { PrismaClient } from "@prisma/client";',
    );
    expect(() => runChecker(root)).toThrow(
      /imports @prisma\/client[\s\S]*imports fastify[\s\S]*imports next/,
    );
  });

  it("resolves valid relative imports under an escaped checkout path", () => {
    const root = createFixture(
      'import type { Item } from "./item.js";\nexport type Local = Item;',
      "reviewrouter architecture #é%-",
    );
    writeFile(
      root,
      "packages/features/review-investigations/src/domain/item.ts",
      "export type Item = string;",
    );
    expect(runChecker(root)).toContain("passed for 2 domain/application files");
  });

  it("checks the real default root when the CLI path needs URL decoding", () => {
    const root = createFixture(
      'import { PrismaClient } from "@prisma/client";',
      "reviewrouter architecture #é%-",
    );
    mkdirSync(join(root, "scripts"));
    const localChecker = join(
      root,
      "scripts/check-architecture-boundaries.mjs",
    );
    copyFileSync(checker, localChecker);
    symlinkSync(
      resolve("scripts/architecture-boundaries"),
      join(root, "scripts/architecture-boundaries"),
      "dir",
    );
    const env = { ...process.env };
    delete env.REVIEWROUTER_ARCHITECTURE_ROOT;
    expect(() =>
      execFileSync(process.execPath, [localChecker], {
        cwd: root,
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).toThrow(/Prisma is an infrastructure adapter/);
  });
});

describe("transaction reference regressions", () => {
  it.each([
    [
      "query variables inside an array",
      "async function load(db: Prisma.TransactionClient) { const first = db.first(); const second = db.second(); return Promise.all([first, second]); }",
    ],
    [
      "query variables inside an aliased array",
      "async function load(db: Prisma.TransactionClient) { const first = db.first(); const second = db.second(); const queries = [first, second]; return Promise.all(queries); }",
    ],
    [
      "asserted client alias",
      "async function load(db: Prisma.TransactionClient) { const alias = db as Prisma.TransactionClient; return Promise.all([alias.first(), alias.second()]); }",
    ],
    [
      "satisfies client alias",
      "async function load(db: Prisma.TransactionClient) { const alias = (db satisfies Prisma.TransactionClient); return Promise.all([alias.first(), alias.second()]); }",
    ],
    [
      "parenthesized callback",
      "prisma.$transaction((async db => Promise.all([db.first(), db.second()])));",
    ],
    [
      "static computed transaction callback",
      'prisma["$transaction"](async db => Promise.all([db.first(), db.second()]));',
    ],
    [
      "static computed Promise.all member",
      'prisma.$transaction(async db => Promise["all"]([db.first(), db.second()]));',
    ],
    [
      "static computed transaction and Promise.all members",
      'prisma["$transaction"](async db => Promise["all"]([db.first(), db.second()]));',
    ],
    [
      "renamed callback",
      "const operation = async db => Promise.all([db.first(), db.second()]); const run = operation; prisma.$transaction(run);",
    ],
    [
      "direct object method callback",
      "const methods = { execute(db: Db) { return Promise.all([db.first(), db.second()]); } }; prisma.$transaction(methods.execute);",
    ],
    [
      "direct static method callback",
      "class Queries { static execute(db: Db) { return Promise.all([db.first(), db.second()]); } } prisma.$transaction(Queries.execute);",
    ],
    [
      "outer query array with a shadowing nested binding",
      "async function load(db: Prisma.TransactionClient) { const queries = [db.first(), db.second()]; const unrelated = () => { const queries = []; return queries; }; return Promise.all(queries); }",
    ],
    [
      "outer query array with a shadowing block binding",
      "async function load(db: Prisma.TransactionClient) { const queries = [db.first(), db.second()]; { const queries = []; consume(queries); } return Promise.all(queries); }",
    ],
    [
      "captured transaction inside a nested callback",
      "async function load(db: Prisma.TransactionClient) { return withMetrics(async () => Promise.all([db.first(), db.second()])); }",
    ],
    [
      "captured query helper references",
      "async function load(db: Prisma.TransactionClient) { const first = () => db.first(); const second = () => db.second(); return Promise.all([first(), second()]); }",
    ],
    [
      "async query helper references",
      "async function load(db: Prisma.TransactionClient) { const first = async () => await db.first(); const second = async () => await db.second(); return Promise.all([first(), second()]); }",
    ],
    [
      "parameter with a no-op var redeclaration",
      "async function load(db: Prisma.TransactionClient) { var db; return Promise.all([db.first(), db.second()]); }",
    ],
    [
      "client alias with a no-op var redeclaration",
      "async function load(db: Prisma.TransactionClient) { var alias = db; var alias; return Promise.all([alias.first(), alias.second()]); }",
    ],
  ])("rejects an unsafe %s", (_name, source) => {
    const root = createFixture("export type Local = string;");
    writeFile(root, "apps/api/src/store.ts", source);
    expect(() => runChecker(root)).toThrow(
      /Prisma interactive transaction clients use one database connection/,
    );
  });

  it.each([
    [
      "a property key named transaction",
      'async function load(transaction: Prisma.TransactionClient) { const results = [{ transaction: "metadata" }]; return Promise.all(results); }',
    ],
    [
      "a noncomputed member name",
      "async function load(transaction: Prisma.TransactionClient) { return Promise.all([metadata.transaction(), other.transaction()]); }",
    ],
    [
      "a nested pooled-client parameter",
      "async function load(db: Prisma.TransactionClient) { const batch = async (db: Pool) => Promise.all([db.first(), db.second()]); return batch(pool); }",
    ],
    [
      "a block-local pooled-client binding",
      "async function load(db: Prisma.TransactionClient) { { const db = pool; await Promise.all([db.first(), db.second()]); } return db.first(); }",
    ],
    [
      "an unrelated callback with the same name",
      "const execute = async (db: Pool) => Promise.all([db.first(), db.second()]); function load(prisma: Prisma) { const execute = async (db: Db) => db.first(); return prisma.$transaction(execute); }",
    ],
    [
      "a different object method with the same name",
      "const pooled = { execute: async (db: Pool) => Promise.all([db.first(), db.second()]) }; const transactional = { execute: async db => db.first() }; prisma.$transaction(transactional.execute);",
    ],
    [
      "an unresolved computed callback member",
      "prisma[operation](async db => Promise.all([db.first(), db.second()]));",
    ],
    [
      "an unresolved computed Promise member",
      "async function load(db: Prisma.TransactionClient) { return Promise[operation]([db.first(), db.second()]); }",
    ],
    [
      "already awaited query values",
      "async function load(db: Prisma.TransactionClient) { const first = await db.first(); const second = await db.second(); return Promise.all([first, second]); }",
    ],
    [
      "sequential awaits in an array",
      "async function load(db: Prisma.TransactionClient) { return Promise.all([await db.first(), await db.second()]); }",
    ],
    [
      "uncalled query helpers stored as values",
      "async function load(db: Prisma.TransactionClient) { const first = () => db.first(); const second = () => db.second(); return Promise.all([first, second]); }",
    ],
    [
      "an unselected object query method",
      "async function load(db: Prisma.TransactionClient) { const methods = { query: () => db.first(), ready: () => Promise.resolve(1) }; return Promise.all([methods.ready()]); }",
    ],
    [
      "a captured already awaited value",
      "async function load(db: Prisma.TransactionClient) { const first = await db.first(); const completed = () => first; return Promise.all([completed()]); }",
    ],
  ])(
    "accepts %s without attributing pooled or completed work to a transaction",
    (_name, source) => {
      const root = createFixture("export type Local = string;");
      writeFile(root, "apps/api/src/store.ts", source);
      expect(runChecker(root)).toContain("Architecture boundary check passed");
    },
  );
});

describe("strict public export target regressions", () => {
  it.each([
    [
      ".",
      {
        types: "./src/infrastructure/store.ts",
        production: "./dist/infrastructure/store.js",
        default: "./src/infrastructure/store.ts",
      },
    ],
    [
      "./composition",
      {
        types: "./src/composition/index.ts",
        default: "./src/composition/index.ts",
      },
    ],
    [
      "./testing",
      {
        types: "./src/testing/index.ts",
        production: "./dist/testing/index.js",
        default: "./src/infrastructure/store.ts",
      },
    ],
    [
      "./contract-source",
      {
        types: "./src/contract-source/index.ts",
        production: "./dist/contract-source/index.js",
        default: "./src/contract-source/index.ts",
        browser: "./src/infrastructure/store.ts",
      },
    ],
    [".", null],
    ["./composition", ["./src/composition/index.ts"]],
    [
      ".",
      {
        default: "./src/index.ts",
        types: "./src/index.ts",
        production: "./dist/index.js",
      },
    ],
  ])(
    "rejects redirected or malformed strict export %s",
    (subpath, conditions) => {
      const root = createFixture("export type Local = string;");
      const path = "packages/features/review-investigations/package.json";
      const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
      manifest.exports[subpath] = conditions;
      writeFile(root, path, JSON.stringify(manifest));
      expect(() => runChecker(root)).toThrow(/review-investigations.*export/);
    },
  );

  it("keeps the legacy root compatible while enforcing exact v2 facade targets", () => {
    const root = createFixture("export type Local = string;");
    const path = "packages/features/review-publishing/package.json";
    const exports = {
      ".": { default: "./legacy-entry.js" },
      "./v2": {
        types: "./src/v2/index.ts",
        production: "./dist/v2/index.js",
        default: "./src/v2/index.ts",
      },
      "./v2/composition": {
        types: "./src/v2/composition/index.ts",
        production: "./dist/v2/composition/index.js",
        default: "./src/v2/composition/index.ts",
      },
      "./v2/testing": {
        types: "./src/v2/testing/index.ts",
        production: "./dist/v2/testing/index.js",
        default: "./src/v2/testing/index.ts",
      },
      "./v2/contract-source": {
        types: "./src/v2/contract-source/index.ts",
        production: "./dist/v2/contract-source/index.js",
        default: "./src/v2/contract-source/index.ts",
      },
    };
    writeFile(root, path, JSON.stringify({ exports }));
    writeFile(
      root,
      "packages/features/review-publishing/src/v2/index.ts",
      "export {};",
    );
    expect(runChecker(root)).toContain("Architecture boundary check passed");
    exports["./v2"].production = "./dist/infrastructure/store.js";
    writeFile(root, path, JSON.stringify({ exports }));
    expect(() => runChecker(root)).toThrow(/review-publishing.*export/);
  });
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

function createFixture(
  domainSource: string,
  prefix = "reviewrouter-architecture-",
): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  fixtureRoots.push(root);
  // Legacy-boundary fixtures still run every admission policy. Only their
  // historical package names are exempt from new-package migration.
  const baseline = JSON.parse(
    readFileSync(
      resolve(
        "architecture/consumer-module-standard/legacy-feature-packages.json",
      ),
      "utf8",
    ),
  ) as { schemaVersion: number; legacyFeaturePackages: string[] };
  writeFile(
    root,
    "architecture/consumer-module-standard/legacy-feature-packages.json",
    JSON.stringify({
      ...baseline,
      legacyFeaturePackages: [
        ...baseline.legacyFeaturePackages,
        "consumer",
        "legacy",
      ],
    }),
  );
  writeFile(
    root,
    "package.json",
    readFileSync(resolve("package.json"), "utf8"),
  );
  writeFile(
    root,
    "architecture/foundation/provider-seams.yaml",
    "schemaVersion: 1\ngovernedRoots: []\n",
  );
  writeFile(
    root,
    "packages/features/review-investigations/package.json",
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
        "./contract-source": {
          types: "./src/contract-source/index.ts",
          production: "./dist/contract-source/index.js",
          default: "./src/contract-source/index.ts",
        },
        "./testing": {
          types: "./src/testing/index.ts",
          production: "./dist/testing/index.js",
          default: "./src/testing/index.ts",
        },
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
