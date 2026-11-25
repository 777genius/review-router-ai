import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNetworkSubnet,
  assertNoNetworkOverlap,
  assertOwnedNetworkSubnet,
  selfHostedComposeArguments,
  networkInventoryFailure,
} from "./network-isolation.ts";
const subnet = "192.168.240.0/24";
const networks = [
  { IPAM: { Config: [{ Subnet: "172.18.0.0/16" }, { Subnet: "fd00::/64" }] } },
];
const addresses = [
  { addr_info: [{ family: "inet", local: "10.1.2.3", prefixlen: 24 }] },
];
const routes = [{ dst: "default" }, { dst: "10.0.0.0/8" }];
test("private test subnet is canonical IPv4 /24 only", () => {
  assertNetworkSubnet(subnet);
  for (const value of [
    null,
    123,
    "192.168.240.1/24",
    "192.168.240.0/16",
    "192.168.024.0/24",
    "127.0.0.0/24",
    "169.254.1.0/24",
    "172.32.0.0/24",
    "8.8.8.0/24",
    "fd00::/24",
    " 10.2.3.0/24",
    "10.2.3.0/24\n",
  ])
    assert.throws(() => assertNetworkSubnet(value));
});
test("complete Docker/interface/route inventory rejects containment and endpoint overlap but permits adjacency", () => {
  assertNoNetworkOverlap(subnet, networks, addresses, routes);
  for (const conflict of [
    "192.168.0.0/16",
    "192.168.240.0/24",
    "192.168.240.128/25",
    "192.168.240.255/32",
  ])
    assert.throws(
      () =>
        assertNoNetworkOverlap(
          subnet,
          [{ IPAM: { Config: [{ Subnet: conflict }] } }],
          addresses,
          routes,
        ),
      /overlap/,
    );
  assertNoNetworkOverlap(
    subnet,
    [
      {
        IPAM: {
          Config: [
            { Subnet: "192.168.239.0/24" },
            { Subnet: "192.168.241.0/24" },
          ],
        },
      },
    ],
    addresses,
    routes,
  );
  assert.throws(
    () =>
      assertNoNetworkOverlap(
        subnet,
        networks,
        [
          {
            addr_info: [
              { family: "inet", local: "192.168.240.12", prefixlen: 24 },
            ],
          },
        ],
        routes,
      ),
    /overlap/,
  );
  assert.throws(
    () =>
      assertNoNetworkOverlap(subnet, networks, addresses, [
        { dst: "192.168.240.7" },
      ]),
    /overlap/,
  );
  for (const bad of [
    null,
    [],
    {},
    [{ IPAM: {} }],
    [{ IPAM: { Config: [{ Subnet: "invalid" }] } }],
    Array(1025).fill(networks[0]),
  ])
    assert.throws(() => assertNoNetworkOverlap(subnet, bad, addresses, routes));
  assert.throws(() => assertNoNetworkOverlap(subnet, networks, [{}], routes));
  assert.throws(() =>
    assertNoNetworkOverlap(subnet, networks, addresses, [{}]),
  );
});
test("actual owned default network must retain exact project and requested IPAM", () => {
  const project = "reviewrouter-self-hosted-e2e-owned";
  const network = {
    Id: "a".repeat(64),
    Name: `${project}_default`,
    Driver: "bridge",
    Scope: "local",
    Labels: {
      "com.docker.compose.project": project,
      "com.docker.compose.network": "default",
    },
    IPAM: { Config: [{ Subnet: subnet, Gateway: "192.168.240.1" }] },
  };
  assertOwnedNetworkSubnet([network], project, subnet);
  for (const other of [
    { ...network, Name: "foreign_default" },
    { ...network, Labels: {} },
    {
      ...network,
      Labels: { ...network.Labels, "com.docker.compose.network": "foreign" },
    },
    { ...network, IPAM: { Config: [{ Subnet: "192.168.241.0/24" }] } },
    { ...network, Driver: "overlay" },
    { ...network, Id: "short" },
  ])
    assert.throws(() => assertOwnedNetworkSubnet([other], project, subnet));
  assert.throws(() =>
    assertOwnedNetworkSubnet([network, network], project, subnet),
  );
});
test("all stock Compose operations share canonical base and optional exact owned override", () => {
  const prefix = [
    "compose",
    "-p",
    "owned",
    "--env-file",
    "/owned/env",
    "-f",
    "deploy/self-hosted/compose.yml",
  ];
  for (const args of [
    ["config", "--format", "json"],
    ["up", "-d", "postgres"],
    ["build", "api"],
    ["exec", "worker", "node"],
    ["down", "--volumes", "--remove-orphans"],
  ]) {
    assert.deepEqual(
      selfHostedComposeArguments(
        "owned",
        "/owned/env",
        "deploy/self-hosted/compose.yml",
        args,
      ),
      [...prefix, ...args],
    );
    assert.deepEqual(
      selfHostedComposeArguments(
        "owned",
        "/owned/env",
        "deploy/self-hosted/compose.yml",
        args,
        "/owned/network.json",
      ),
      [...prefix, "-f", "/owned/network.json", ...args],
    );
  }
});

test("inventory process failure retains only closed phase/code/status/signal", () => {
  const secret = "private-message-command-environment";
  const failure = networkInventoryFailure(
    {
      code: "ETIMEDOUT",
      status: 124,
      signal: "SIGTERM",
      message: secret,
      stderr: secret,
      stdout: secret,
      cmd: secret,
      env: secret,
      cause: { message: secret },
    },
    "host_routes",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(failure)), {
    phase: "host_routes",
    code: "ETIMEDOUT",
    exitStatus: 124,
    signal: "SIGTERM",
  });
  assert(
    !`${failure.message}${failure.stack}${JSON.stringify(failure)}`.includes(
      secret,
    ),
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        networkInventoryFailure(
          { code: secret, status: -1, signal: secret },
          "network_inspect",
        ),
      ),
    ),
    {
      phase: "network_inspect",
      code: "inventory_process_failed",
      exitStatus: null,
      signal: null,
    },
  );
});
