import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Pure checking API of the deterministic CMS source/profile gate for the private C11 WEB Host slice and the
 * public configuration-only finished-context factory boundary (ADR-030). It reads only the repository view it is
 * given. The process entry point is the separate `check-web-host-cms-profile-cli.ts`, which always runs this API
 * against its own repository root. The gate proves pins, the boundary inventory, claim limits, the accepted
 * installed-gate receipt reference, reciprocal ADR/profile references and hook wiring. It does NOT read the
 * installed host and does NOT prove physical adoption, Node26 qualification or full product CI: that is the
 * operator-run installed gate named in `qualification.installedGate` of the profile.
 *
 * The expected values below are compiled in on purpose: the profile is checked against an independent copy,
 * so a drifted profile (or a drifted check) is rejected instead of silently agreeing with itself.
 */

export const PROFILE_PATH =
  "architecture/consumer-module-standard/web-trust-host-profile.json";
export const ADR_PATH =
  "ai-docs/decisions/030-web-trust-host-consumer-module-standard-scope.md";
export const ADR_INDEX_PATH = "ai-docs/decisions/README.md";
export const CHECK_PATH = "scripts/check-web-host-cms-profile.ts";
export const CLI_PATH = "scripts/check-web-host-cms-profile-cli.ts";
const PACKAGE_PATH = "package.json";
const CI_PATH = ".github/workflows/ci.yml";
const HOOK_SCRIPT = "architecture:web-host-cms";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export interface RepositoryView {
  read(path: string): string | null;
  list(): readonly string[];
}

const EXPECTED_AUTHORITY: JsonObject = {
  consumerModuleStandard: {
    repository: "agent-teams-ai/get-modular",
    path: "docs/architecture/common-assembly.md",
    anchor: "#consumer-module-standard",
    commit: "4728b276b87378ca9d72a7be2b89a5fd49b97eea",
    gitBlob: "20c281b3137f5d3c198250e9f8101c0ecd4cbc75",
    bytes: 54680,
    lines: 927,
    documentSha256:
      "859fbca1e8a0c61b6ae873bea0057735a55b80230100e6e73a74de22e123165a",
  },
  priorStandard: {
    commit: "d6127e2d3f499b91b220a222fc3672d29dff1ab2",
    documentSha256:
      "49d08b6d1762e94308157fb59b3aa82ac1630c91f529f6efcd4915dfffee7ba7",
  },
  sharedDelta: {
    diffSha256:
      "f5da152530e6c0830afb9a26f93863347eed8f76e9067aee9442db2c6c0717b6",
    diffLines: 260,
  },
  featureModuleStandard: {
    gitBlob: "d0bfff2033faf544fe65268c1dcdfd524d093015",
    sha256: "851653f96643cf0466b67ab22963661976b00de44840fa3144a48a8c054f95fa",
  },
  engineeringQualityStandard: {
    repository: "agent-teams-ai/.github",
    path: "docs/engineering-quality-standard.md",
    commit: "66d6d3d2c2643edac414ded48c0ee0586774dd07",
    gitBlob: "705f14cd5048e24b7d61e1d8102b86395d7b014d",
    bytes: 18080,
    sha256: "d55f9f498da213dfa7b14aeac5df5b2fcf37b2cfed4c63dd88b51bde6f56ebe8",
  },
};

const EXPECTED_DELIVERY: JsonObject = {
  release: "existing-web-trust-overlap-successor-20261011-v26web-c11",
  target: "releases/existing-web-trust-overlap-successor-20261011-v26web-c11",
  status: "web-trust-finished",
  operation: "868258c2-9846-474b-8365-84fce37cc576",
  native: ["ready", 54, "868258c2-9846-474b-8365-84fce37cc576", false],
  priorApiOperation: "704109cc-8c1c-4dc8-8d4a-6e84f28ac82a",
  rootSha256:
    "035d9aa446ef274be76e2f66072a5bd55f494bb8b07ffb8ce647415242969039",
  controlSha256:
    "569ff22d0f82b380338453a42e6adbb1374bace050ed2e1829f3fc802ccfd945",
  mixedManifestSha256:
    "8b58748166de54f40f7a4004a1f343a8e66e1660589cba0ef622c5c3e7b3d0c9",
  startupSha256:
    "0556b0ff6c8df6a83d1d6e0d41be9c3d915cf90d869e34c0a6ba5cd0fc02de20",
  publication: {
    name: "WARM_WEB_TRUST_V26_PUBLICATION.json",
    sha256: "71b8009e45462de000502e3793e3ea1748de49b1df1aa0b92fe95fef99f15c22",
    bytes: 601,
    mode: "0600",
  },
};

const EXPECTED_RECEIPT: JsonObject = {
  reference: "web-cms-installed-readonly-gate-actual-a1.json",
  sha256: "121108083bc53d95d006b1d725952ba02c704c015c68b4d72917676c411a043a",
  projection: {
    status: "cms-delivery-gate-pass",
    returncode: 0,
    native: ["ready", 54, "868258c2-9846-474b-8365-84fce37cc576", false],
    standardCommit: "4728b276b87378ca9d72a7be2b89a5fd49b97eea",
    cmsAdoption: "pending",
    productionAdoption: false,
    wholeOrganizationQualification: false,
    noActivationReplay: true,
    packetManifestSha256:
      "dfc5e3c9142369fa2da0dac01c3d23c16460e9abed95b4014fc996b293c6347e",
    unverified: [
      "live lifecycle row and container state (outside this gate; separate Root observation)",
    ],
  },
};

const DELIVERY_DIGEST_FIELDS = [
  "newWebId",
  "rootSha256",
  "controlSha256",
  "installerSha256",
  "sourceManifestSha256",
  "bundlePinsSha256",
  "loaderSha256",
  "mixedManifestSha256",
  "startupSha256",
] as const;

const EXPECTED_BOUNDARIES: Readonly<Record<string, string>> = {
  "web-trust-successor-owner": "host-owned-lifecycle-transition",
  "web-trust-private-helpers": "fixed-dependency-private-helpers",
  "web-trust-api-published-language":
    "fixed-dependency-read-only-anti-corruption",
  "web-trust-finished-context-derivative":
    "sealed-derived-factory-of-a-retained-owner",
  "web-trust-catalog-adapter-copy": "byte-equal-copy-of-owner-artifact",
  "web-trust-action-ref-policy": "duplicated-constants-guarded",
};

const EXPECTED_FACTORY_IDENTITY: JsonObject = {
  classChain: ["Schema125Context", "CurrentFinishedContext"],
  definingModules: [
    "schema125_current_context",
    "schema125_finished_context_factory",
  ],
  sealedModule: "web_trust_finished_context.py",
};

const GOVERNED_NAME =
  /(?:^|\/)(?:web_trust_[^/]+|[^/]*web-trust-overlap[^/]*|[^/]*WARM_WEB_TRUST[^/]*|[^/]*WEB_TRUST_V26[^/]*)$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const HEX40 = /^[0-9a-f]{40}$/u;

export function parseStrictJson(text: string): Json {
  let index = 0;
  function fail(message: string): never {
    throw new Error(`${message} at offset ${index}`);
  }
  function space(): void {
    while (index < text.length && " \t\r\n".includes(text.charAt(index))) {
      index += 1;
    }
  }
  function readString(): string {
    const start = index;
    index += 1;
    while (index < text.length && text.charAt(index) !== '"') {
      index += text.charAt(index) === "\\" ? 2 : 1;
    }
    if (index >= text.length) fail("unterminated string");
    index += 1;
    return JSON.parse(text.slice(start, index)) as string;
  }
  function readValue(): Json {
    space();
    const character = text.charAt(index);
    if (character === "{") {
      index += 1;
      const result: JsonObject = {};
      space();
      if (text.charAt(index) === "}") {
        index += 1;
        return result;
      }
      for (;;) {
        space();
        if (text.charAt(index) !== '"') fail("expected an object key");
        const key = readString();
        if (Object.prototype.hasOwnProperty.call(result, key)) {
          fail(`duplicate key ${key}`);
        }
        space();
        if (text.charAt(index) !== ":") fail("expected a colon");
        index += 1;
        result[key] = readValue();
        space();
        if (text.charAt(index) === ",") {
          index += 1;
          continue;
        }
        if (text.charAt(index) === "}") {
          index += 1;
          return result;
        }
        return fail("expected , or }");
      }
    }
    if (character === "[") {
      index += 1;
      const result: Json[] = [];
      space();
      if (text.charAt(index) === "]") {
        index += 1;
        return result;
      }
      for (;;) {
        result.push(readValue());
        space();
        if (text.charAt(index) === ",") {
          index += 1;
          continue;
        }
        if (text.charAt(index) === "]") {
          index += 1;
          return result;
        }
        return fail("expected , or ]");
      }
    }
    if (character === '"') return readString();
    const match = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(
      text.slice(index),
    );
    if (!match) return fail("unexpected token");
    index += match[0].length;
    return JSON.parse(match[0]) as Json;
  }
  const result = readValue();
  space();
  if (index !== text.length) fail("trailing data");
  return result;
}

function canonical(value: Json | undefined): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function asObject(value: Json | undefined): JsonObject | null {
  return value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value
    : null;
}

function asArray(value: Json | undefined): Json[] | null {
  return Array.isArray(value) ? value : null;
}

export function checkWebHostCms(view: RepositoryView): string[] {
  const violations: string[] = [];
  const bad = (message: string): void => {
    violations.push(message);
  };
  const profileText = view.read(PROFILE_PATH);
  if (profileText === null) return [`${PROFILE_PATH} is missing`];
  let parsed: Json;
  try {
    parsed = parseStrictJson(profileText);
  } catch (error) {
    return [
      `${PROFILE_PATH} is not strict JSON: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const profile = asObject(parsed);
  if (!profile) return [`${PROFILE_PATH} must be an object`];

  checkAuthority(profile, bad);
  checkScope(profile, view, bad);
  const delivery = checkDelivery(profile, bad);
  checkFactoryAndBoundaries(profile, delivery, bad);
  checkQualification(profile, bad);
  checkDecisionRecord(profile, view, bad);
  checkHook(view, bad);
  return violations;
}

function checkAuthority(
  profile: JsonObject,
  bad: (message: string) => void,
): void {
  const authority = asObject(profile.authority);
  if (!authority) {
    bad("authority section is missing");
    return;
  }
  for (const [name, expected] of Object.entries(EXPECTED_AUTHORITY)) {
    const actual = asObject(authority[name]);
    const expectedObject = asObject(expected);
    if (!actual || !expectedObject) {
      bad(`authority.${name} is missing`);
      continue;
    }
    for (const [key, value] of Object.entries(expectedObject)) {
      if (canonical(actual[key]) !== canonical(value)) {
        bad(`authority.${name}.${key} differs from the fixed pin`);
      }
    }
  }
  const standard = asObject(authority.consumerModuleStandard);
  if (standard && !HEX40.test(String(standard.commit))) {
    bad("the Consumer Module Standard pin is not an exact commit");
  }
}

function checkScope(
  profile: JsonObject,
  view: RepositoryView,
  bad: (message: string) => void,
): void {
  const scope = asObject(profile.scope);
  if (!scope) {
    bad("scope section is missing");
    return;
  }
  for (const claim of [
    "organizationWideAdoption",
    "node26Qualification",
    "fullProductCi",
  ]) {
    if (scope[claim] !== false) bad(`scope.${claim} must be false`);
  }
  if (scope.productSourceInRepository !== false) {
    bad("scope.productSourceInRepository must be false");
  }
  const declared = asArray(scope.governedPaths);
  if (!declared || !declared.every((item) => typeof item === "string")) {
    bad("scope.governedPaths must be a list of paths");
    return;
  }
  const found = view.list().filter((path) => GOVERNED_NAME.test(path));
  for (const path of found) {
    if (!declared.includes(path)) {
      bad(`undeclared WEB Host boundary file ${path}`);
    }
  }
  for (const path of declared) {
    if (typeof path === "string" && !found.includes(path)) {
      bad(`declared WEB Host path ${path} does not exist`);
    }
  }
}

function checkDelivery(
  profile: JsonObject,
  bad: (message: string) => void,
): JsonObject | null {
  const slice = asObject(profile.hostSlice);
  if (!slice) {
    bad("hostSlice section is missing");
    return null;
  }
  if (slice.classification !== "host-owned-lifecycle-transition") {
    bad("hostSlice must stay a host-owned lifecycle transition");
  }
  if (slice.graphNode !== false) bad("hostSlice must not be a graph node");
  for (const [key, value] of Object.entries(EXPECTED_DELIVERY)) {
    if (canonical(slice[key]) !== canonical(value)) {
      bad(`hostSlice.${key} differs from the actual delivery authority`);
    }
  }
  for (const field of DELIVERY_DIGEST_FIELDS) {
    if (!HEX64.test(String(slice[field]))) {
      bad(`hostSlice.${field} is not a sha256`);
    }
  }
  const closure = asObject(slice.installedClosure);
  const files = asObject(closure?.releaseFiles);
  if (!closure || !files) {
    bad("hostSlice.installedClosure.releaseFiles is missing");
    return slice;
  }
  for (const [name, mode] of Object.entries(files)) {
    if (!/^0[0-7]{3}$/u.test(String(mode))) {
      bad(`installed closure mode of ${name} is invalid`);
    }
  }
  if (Object.keys(files).length !== 30) {
    bad("the installed release closure must declare exactly 30 files");
  }
  if (
    canonical(closure.sealedAfterActivation) !==
    canonical({ "mixed-fleet.json": "0400" })
  ) {
    bad("the sealed manifest member differs");
  }
  if (closure.rootSource !== "web_trust_overlap_successor.py") {
    bad("the root source differs");
  }
  return slice;
}

function checkFactoryAndBoundaries(
  profile: JsonObject,
  slice: JsonObject | null,
  bad: (message: string) => void,
): void {
  const factory = asObject(profile.factoryBoundary);
  if (!factory) {
    bad("factoryBoundary section is missing");
  } else {
    if (factory.id !== "web-trust-finished-context-derivative") {
      bad("factoryBoundary id differs");
    }
    if (factory.graphNode !== false)
      bad("the factory boundary must not be a graph node");
    if (
      factory.publicInitializer !== "initialize_retained_worker_configuration"
    ) {
      bad("the public initializer name differs");
    }
    if (
      factory.dependencyDirection !==
      "WEB package -> derivative factory -> retained classes"
    ) {
      bad("the factory dependency direction differs");
    }
    if (canonical(factory.identity) !== canonical(EXPECTED_FACTORY_IDENTITY)) {
      bad(
        "the factory identity (class chain, defining modules, sealed module) differs",
      );
    }
    const refusals = asArray(factory.refusals);
    if (!refusals || refusals.length < 5) {
      bad("the factory boundary must list its refusals");
    }
    const closure = asObject(asObject(slice?.installedClosure)?.releaseFiles);
    if (closure?.["web_trust_finished_context.py"] !== "0555") {
      bad("the sealed factory module is not in the installed closure at 0555");
    }
  }
  const boundaries = asArray(profile.boundaries);
  if (!boundaries) {
    bad("boundaries list is missing");
  } else {
    const seen = new Map<string, string>();
    for (const item of boundaries) {
      const boundary = asObject(item);
      if (!boundary || typeof boundary.id !== "string") {
        bad("a boundary entry is malformed");
        continue;
      }
      if (seen.has(boundary.id)) bad(`duplicate boundary ${boundary.id}`);
      seen.set(boundary.id, String(boundary.classification));
      if (boundary.graphNode !== false)
        bad(`boundary ${boundary.id} must not be a graph node`);
    }
    for (const [id, classification] of Object.entries(EXPECTED_BOUNDARIES)) {
      if (seen.get(id) !== classification)
        bad(`boundary ${id} is missing or reclassified`);
    }
    for (const id of seen.keys()) {
      if (!(id in EXPECTED_BOUNDARIES)) bad(`undeclared boundary ${id}`);
    }
  }
  const legacy = asArray(profile.legacy);
  if (
    !legacy ||
    legacy.some((item) => asObject(item)?.status !== "not-adopted")
  ) {
    bad("every legacy entry must stay not-adopted");
  }
  const exceptions = asArray(profile.exceptions);
  if (!exceptions || exceptions.length !== 0) {
    bad("no exception may be recorded without a successor decision");
  }
  if (asObject(profile.conditionalAssemblyGates)?.declared !== false) {
    bad("conditional Assembly gates are declared without a gate");
  }
}

/**
 * The accepted installed-gate receipt is referenced by hash and a finite public projection that uses the receipt's
 * genuine field names (status, returncode, native, standardCommit, cmsAdoption, productionAdoption,
 * wholeOrganizationQualification, noActivationReplay, packetManifestSha256, unverified). The operation is the third
 * element of the native tuple; the receipt has no separate operation or readOnly field. Nothing else is copied.
 */
function checkReceiptProjection(
  receipt: JsonObject | null,
  bad: (message: string) => void,
): void {
  if (
    !receipt ||
    canonical(Object.keys(receipt).sort()) !==
      canonical(["projection", "reference", "sha256"])
  ) {
    bad(
      "a passed installed gate needs exactly a receipt reference, sha256 and projection",
    );
    return;
  }
  if (receipt.reference !== EXPECTED_RECEIPT.reference)
    bad(
      "the receipt reference differs from the accepted installed-gate receipt",
    );
  if (receipt.sha256 !== EXPECTED_RECEIPT.sha256)
    bad("the receipt sha256 differs from the accepted installed-gate receipt");
  const projection = asObject(receipt.projection);
  const expected = asObject(EXPECTED_RECEIPT.projection);
  if (
    !projection ||
    !expected ||
    canonical(Object.keys(projection).sort()) !==
      canonical(Object.keys(expected).sort())
  ) {
    bad("the receipt projection must have exactly the genuine receipt fields");
    return;
  }
  for (const [key, value] of Object.entries(expected)) {
    if (canonical(projection[key]) !== canonical(value)) {
      bad(
        `the receipt projection ${key} differs from the accepted installed-gate receipt`,
      );
    }
  }
}

function checkQualification(
  profile: JsonObject,
  bad: (message: string) => void,
): void {
  const qualification = asObject(profile.qualification);
  const deterministic = asObject(qualification?.deterministicGate);
  const installed = asObject(qualification?.installedGate);
  if (!deterministic || !installed) {
    bad("qualification section is incomplete");
    return;
  }
  if (
    deterministic.script !== CLI_PATH ||
    deterministic.library !== CHECK_PATH ||
    deterministic.command !== `pnpm ${HOOK_SCRIPT}`
  ) {
    bad("the deterministic gate command or script differs");
  }
  if (
    typeof deterministic.doesNotProve !== "string" ||
    deterministic.doesNotProve.length === 0
  ) {
    bad("the deterministic gate must state what it does not prove");
  }
  if (installed.kind !== "operator")
    bad("the installed gate must stay an operator gate");
  const command = String(installed.command);
  if (
    !command.startsWith("cd /tmp && python3 -I -B ") ||
    !command.includes("cms_delivery_gate.py") ||
    /\|\||;|&&\s*(?:true|echo)|\becho\b/u.test(
      command.slice("cd /tmp && ".length),
    )
  ) {
    bad("the installed gate command is missing or a no-op");
  }
  if (installed.status === "operator-run-pending") {
    if (installed.receipt !== null)
      bad("a pending installed gate cannot carry a receipt");
  } else if (installed.status === "operator-run-passed") {
    checkReceiptProjection(asObject(installed.receipt), bad);
  } else {
    bad("the installed gate status is not recognised");
  }
}

function checkDecisionRecord(
  profile: JsonObject,
  view: RepositoryView,
  bad: (message: string) => void,
): void {
  const decision = asObject(profile.decision);
  if (
    decision?.path !== ADR_PATH ||
    decision?.adr !== "ADR-030" ||
    decision?.status !== "accepted-scoped"
  ) {
    bad("the profile does not reference the accepted scoped decision ADR-030");
  }
  const text = view.read(ADR_PATH);
  if (text === null) {
    bad(`${ADR_PATH} is missing`);
    return;
  }
  const required: string[] = [
    "Accepted, scoped",
    "Organization-wide adoption: not claimed.",
    "Node26 qualification: not claimed.",
    "Full product CI: not claimed.",
    PROFILE_PATH,
    CHECK_PATH,
    CLI_PATH,
    String(EXPECTED_RECEIPT.sha256),
    String(EXPECTED_DELIVERY.operation),
    String(asObject(EXPECTED_DELIVERY.publication)?.sha256),
  ];
  for (const [name, group] of Object.entries(EXPECTED_AUTHORITY)) {
    const entry = asObject(group);
    if (!entry || name === "priorStandard") continue; // the prior standard is history, not a current pin
    for (const key of [
      "commit",
      "gitBlob",
      "documentSha256",
      "sha256",
      "diffSha256",
    ]) {
      const value = entry[key];
      if (typeof value === "string") required.push(value);
    }
  }
  for (const needle of required) {
    if (!text.includes(needle)) bad(`${ADR_PATH} does not state ${needle}`);
  }
  if (
    /(?:organization-wide adoption|node26 qualification|full product ci):\s*(?:claimed|accepted|yes|true)/iu.test(
      text,
    )
  ) {
    bad(`${ADR_PATH} claims more than the scoped slice`);
  }
  const index = view.read(ADR_INDEX_PATH);
  if (
    index === null ||
    !index.includes("(./030-web-trust-host-consumer-module-standard-scope.md)")
  ) {
    bad("the decision index does not list ADR-030");
  }
}

/**
 * The process entry point must stay unconditional and root-fixed: it always runs the pure API against the
 * repository it lives in and fails the process on a violation. A conditional guard, an environment override of
 * the root or a missing exit code would turn the hook into a silent no-op.
 */
function checkCli(source: string | null, bad: (message: string) => void): void {
  if (source === null) {
    bad(`${CLI_PATH} is missing`);
    return;
  }
  if (!source.includes("checkWebHostCms("))
    bad("the CLI does not run the pure check");
  if (!/process\.exitCode\s*=\s*1/u.test(source))
    bad("the CLI does not fail the process on a violation");
  if (/process\.env|process\.argv/u.test(source)) {
    bad(
      "the CLI must not read the environment or argv (no root override, no conditional skip)",
    );
  }
  if (/^\s*if\s*\(\s*(?:import\.meta|require)/mu.test(source)) {
    bad("the CLI must not be wrapped in a main-module condition");
  }
}

function checkHook(view: RepositoryView, bad: (message: string) => void): void {
  const packageText = view.read(PACKAGE_PATH);
  if (packageText === null) {
    bad("package.json is missing");
    return;
  }
  let scripts: JsonObject | null;
  try {
    scripts = asObject(asObject(parseStrictJson(packageText))?.scripts);
  } catch (error) {
    bad(
      `package.json is not strict JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  if (!scripts) {
    bad("package.json has no scripts");
    return;
  }
  if (scripts[HOOK_SCRIPT] !== `tsx ${CLI_PATH}`) {
    bad(`script ${HOOK_SCRIPT} must be exactly 'tsx ${CLI_PATH}'`);
  }
  const chain = String(scripts["architecture:check"] ?? "");
  const parts = chain.split(" && ");
  if (
    !parts.includes("node scripts/check-architecture-boundaries.mjs") ||
    !parts.includes(`pnpm ${HOOK_SCRIPT}`) ||
    /\|\||;|\becho\b|\btrue\b/u.test(chain)
  ) {
    bad(
      "architecture:check must chain the existing check and the WEB Host CMS gate without fallbacks",
    );
  }
  if (view.read(CHECK_PATH) === null) bad(`${CHECK_PATH} is missing`);
  checkCli(view.read(CLI_PATH), bad);
  const workflow = view.read(CI_PATH);
  if (
    workflow === null ||
    !/-\s+name:\s+Architecture boundaries\s*\n\s+run:\s+pnpm architecture:check\s*\n/u.test(
      workflow,
    )
  ) {
    bad(
      "CI no longer runs pnpm architecture:check in the 'Architecture boundaries' step",
    );
  }
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
]);

export function createFileSystemView(root: string): RepositoryView {
  return {
    read(path: string): string | null {
      try {
        return readFileSync(join(root, path), "utf8");
      } catch {
        return null;
      }
    },
    list(): readonly string[] {
      const collected: string[] = [];
      const walk = (directory: string, prefix: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            if (!IGNORED_DIRECTORIES.has(entry.name)) {
              walk(join(directory, entry.name), `${prefix}${entry.name}/`);
            }
          } else {
            collected.push(`${prefix}${entry.name}`);
          }
        }
      };
      walk(root, "");
      return collected;
    },
  };
}
