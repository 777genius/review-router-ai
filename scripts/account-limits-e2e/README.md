# Joined native account limits acceptance

`accept-native-snapshot.mts` is a preloaded callback for the source-owned
Gateway `services/account-gateway/test/native-device-joined.ts` disposable
HTTP/PostgreSQL harness. It is not a production collector and has no standalone
credential configuration.

After preparing that harness's isolated native/Gateway fixture, run it from the
qualified Gateway checkout with the RR callback preloaded:

```sh
AG_NATIVE_DEVICE_JOINED_RR_ACCEPTANCE_MODULE="$RR_ROOT/scripts/account-limits-e2e/accept-native-snapshot.mts" \
node --import "$RR_ROOT/node_modules/tsx/dist/loader.mjs" \
  --import "$RR_ROOT/scripts/account-limits-e2e/accept-native-snapshot.mts" \
  services/account-gateway/test/native-device-joined.ts
```

The fixture passes its temporary origin, authority and server-derived account
target in memory. The callback uses the actual RR server composition, SDK,
cached reader and use case. It checks 37.5% used / 62.5% remaining, private
identity exclusion, unchanged observations on reread, and authorization-epoch
fencing after the awaited read. It registers a fixed callback symbol so the
source harness does not import an environment-selected module.

Typecheck the callback with
`pnpm exec tsc -p scripts/account-limits-e2e/tsconfig.json`. Browser acceptance
uses the separate `scripts/accounts-reference-e2e` harness and its
`--limits-fixture` option. Controlled acceptance does not qualify an installed
production native version or claim live provider quota availability.
