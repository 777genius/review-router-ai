import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isIP } from "node:net";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "sandbox_network_inventory_invalid",
  );
  return value as Row;
};
function range(value: string): readonly [number, number] | null {
  const parts = value.split("/");
  assert(parts.length <= 2, "sandbox_network_cidr_invalid");
  const address = parts[0]!;
  const family = isIP(address);
  const prefix =
    parts[1] === undefined ? (family === 6 ? 128 : 32) : Number(parts[1]);
  assert(
    family &&
      Number.isInteger(prefix) &&
      prefix >= 0 &&
      prefix <= (family === 6 ? 128 : 32),
    "sandbox_network_cidr_invalid",
  );
  if (family === 6) return null;
  const ip = address
    .split(".")
    .reduce((n, octet) => n * 256 + Number(octet), 0);
  const size = 2 ** (32 - prefix);
  const start = Math.floor(ip / size) * size;
  return [start, start + size - 1];
}
export function assertNetworkSubnet(value: unknown): asserts value is string {
  assert(
    typeof value === "string" &&
      /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(value) &&
      value.endsWith("/24"),
    "sandbox_network_subnet_invalid",
  );
  const interval = range(value);
  assert(
    interval && value.split("/")[0]!.endsWith(".0"),
    "sandbox_network_subnet_invalid",
  );
}
/** Complete read-only host inventories; a missing or malformed range is never ignored. */
export function assertNoNetworkOverlap(
  subnet: string,
  networks: unknown,
  addresses: unknown,
  routes: unknown,
): void {
  assertNetworkSubnet(subnet);
  const wanted = range(subnet)!;
  const check = (value: unknown) => {
    assert(typeof value === "string", "sandbox_network_inventory_invalid");
    const other = range(value);
    assert(
      !other || wanted[1] < other[0] || other[1] < wanted[0],
      "sandbox_network_subnet_overlap",
    );
  };
  assert(
    Array.isArray(networks) &&
      networks.length > 0 &&
      networks.length <= 1024 &&
      Array.isArray(addresses) &&
      addresses.length > 0 &&
      addresses.length <= 1024 &&
      Array.isArray(routes) &&
      routes.length > 0 &&
      routes.length <= 4096,
    "sandbox_network_inventory_invalid",
  );
  for (const network of networks) {
    const config = row(row(network).IPAM).Config;
    assert(
      config === null || Array.isArray(config),
      "sandbox_network_inventory_invalid",
    );
    for (const entry of config ?? []) check(row(entry).Subnet);
  }
  for (const address of addresses) {
    const info = row(address).addr_info;
    assert(Array.isArray(info), "sandbox_network_inventory_invalid");
    for (const entry of info) {
      const item = row(entry);
      assert(
        item.family === "inet" &&
          typeof item.local === "string" &&
          Number.isInteger(item.prefixlen),
        "sandbox_network_inventory_invalid",
      );
      check(`${item.local}/${item.prefixlen}`);
    }
  }
  for (const route of routes) {
    const destination = row(route).dst;
    if (destination !== "default" && destination !== "0.0.0.0/0")
      check(destination);
  }
}
type InventoryPhase =
  | "network_list"
  | "network_inspect"
  | "host_addresses"
  | "host_routes"
  | "owned_network_inspect";
export function networkInventoryFailure(
  error: unknown,
  phase: InventoryPhase,
): Error {
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const code =
    typeof value.code === "string" &&
    [
      "ENOENT",
      "EACCES",
      "EPERM",
      "ETIMEDOUT",
      "ENOBUFS",
      "EIO",
      "ECONNRESET",
    ].includes(value.code)
      ? value.code
      : "inventory_process_failed";
  const exitStatus =
    typeof value.status === "number" &&
    Number.isInteger(value.status) &&
    value.status >= 0 &&
    value.status <= 255
      ? value.status
      : null;
  const signal =
    typeof value.signal === "string" &&
    ["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT", "SIGHUP", "SIGPIPE"].includes(
      value.signal,
    )
      ? value.signal
      : null;
  const closedPhase = [
    "network_list",
    "network_inspect",
    "host_addresses",
    "host_routes",
    "owned_network_inspect",
  ].includes(phase)
    ? phase
    : "unknown";
  return Object.assign(
    new Error(`sandbox_network_inventory_failed:${closedPhase}:${code}`),
    { phase: closedPhase, code, exitStatus, signal },
  );
}
function capture(
  command: string,
  args: readonly string[],
  phase: InventoryPhase,
): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw networkInventoryFailure(error, phase);
  }
}
export function readNetworkOverride(subnet: string): string {
  assertNetworkSubnet(subnet);
  const ids = capture(
    "docker",
    ["network", "ls", "--no-trunc", "--quiet"],
    "network_list",
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  assert(
    ids.length > 0 &&
      ids.length <= 1024 &&
      new Set(ids).size === ids.length &&
      ids.every((id) => /^[a-f0-9]{64}$/.test(id)),
    "sandbox_network_inventory_invalid",
  );
  const networks: unknown = ids.length
    ? JSON.parse(
        capture("docker", ["network", "inspect", ...ids], "network_inspect"),
      )
    : [];
  assert(
    Array.isArray(networks) &&
      networks.length === ids.length &&
      new Set(networks.map((n) => row(n).Id)).size === ids.length &&
      networks.every((n) => ids.includes(row(n).Id as string)),
    "sandbox_network_inventory_invalid",
  );
  assertNoNetworkOverlap(
    subnet,
    networks,
    JSON.parse(
      capture("ip", ["-j", "-4", "address", "show"], "host_addresses"),
    ),
    JSON.parse(
      capture(
        "ip",
        ["-j", "-4", "route", "show", "table", "all"],
        "host_routes",
      ),
    ),
  );
  return (
    JSON.stringify({
      networks: { default: { ipam: { config: [{ subnet }] } } },
    }) + "\n"
  );
}
export function assertOwnedNetworkSubnet(
  value: unknown,
  project: string,
  subnet: string,
): void {
  assertNetworkSubnet(subnet);
  assert(
    Array.isArray(value) && value.length === 1,
    "sandbox_network_binding_invalid",
  );
  const network = row(value[0]);
  const config = row(network.IPAM).Config;
  assert(
    network.Name === `${project}_default` &&
      network.Driver === "bridge" &&
      network.Scope === "local" &&
      typeof network.Id === "string" &&
      /^[a-f0-9]{64}$/.test(network.Id) &&
      row(network.Labels)["com.docker.compose.project"] === project &&
      row(network.Labels)["com.docker.compose.network"] === "default" &&
      Array.isArray(config) &&
      config.length === 1 &&
      row(config[0]).Subnet === subnet,
    "sandbox_network_binding_invalid",
  );
}
export function verifyOwnedNetworkSubnet(
  project: string,
  subnet: string,
): void {
  assertOwnedNetworkSubnet(
    JSON.parse(
      capture(
        "docker",
        ["network", "inspect", `${project}_default`],
        "owned_network_inspect",
      ),
    ),
    project,
    subnet,
  );
}
/** Shared by every stock Compose operation, including teardown. */
export function selfHostedComposeArguments(
  project: string,
  envFile: string,
  composeFile: string,
  args: readonly string[],
  override?: string,
): string[] {
  return [
    "compose",
    "-p",
    project,
    "--env-file",
    envFile,
    "-f",
    composeFile,
    ...(override ? ["-f", override] : []),
    ...args,
  ];
}
