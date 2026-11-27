# Gateway management ingress: deployment

- Task ID: `2026-11-27-gateway-management-ingress`.
- Goal: restore provider discovery, account details and native account operations through the production Gateway management ingress.
- Affected targets: production Caddy, host domain generator and Gateway management ingress.
- Implementation reference: production generator captured in `deploy/hetzner/apply-domain.sh`.
- Dependencies: [native provider parity](2026-11-21-native-provider-parity.md).
- Last updated: `2026-11-27`.

## Environment status

| Environment | Status | Actual version / image | Last verified (UTC) | Evidence / next step |
| --- | --- | --- | --- | --- |
| staging | `pending` | Not verified | Not verified | Reconcile staging routes before applying. |
| production | `installed` | RR `f20a75ed`, Gateway `a3dafad` | 2026-11-27 | Targeted Caddy route repair active; browser connection and mutations remain unverified. |

## Cause and rollout

The production management ingress allowed `/v1/provider-connection-capabilities` but not V2/V3 capability, account-info or native lifecycle paths. From the actual web container the V2 SDK request returned HTTP 404 and the account list failed closed. The host-owned `apply-domain.sh` and its generated management Caddyfile were updated together with explicit SDK paths, then validated and reloaded. The repository copy records the actual host generator; review host-specific state and compare before using it. Applying the entire script also changes other domain configuration: do not blindly replace or run it on another environment.

No application image or database change was made. Caddy and Gateway remained active. Production generator SHA256 `2f41b695191c10b13d54f01366b3adc1d819b2383436aceab91ffeb102ac306d`; generated management file SHA256 `e8920efd94ab2cfa9207e54ecf705a113475bf427a1719155b978ae4178e161f`. The prior exact files remain alongside them with suffix `.before-native-routes-20261127`.

## Verification and limitations

- Caddy validation succeeded and reload completed; Caddy and Gateway are active.
- The deployed web SDK returned V2 and V3 capabilities with eight profiles each. The actual V3 catalog projection returned eight profiles.
- The deployed web SDK `readAccountInfoV2` successfully read three existing active accounts; each returned one available result. No identifiers, credentials or account contents were recorded.
- Browser visibility, new-account enrollment, reconnect and other mutation routes were not exercised. Do not interpret this as end-to-end provider qualification. Confirm those independently before marking deployed.

## Retry and rollback

Compare current exact hashes and active configuration before any retry. Restore the recorded previous generator and Caddyfile only when rolling back this route change, validate the combined Caddy configuration, and reload; doing so makes the new endpoints unavailable again. Preserve other operators’ changes and do not overwrite a changed file.
