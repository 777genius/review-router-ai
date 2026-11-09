# Gateway diagnostic stream recovery

- Implementation: [Account Gateway PR #103](https://github.com/agent-teams-ai/account-gateway/pull/103), merge `9539c62c4c2eeab9332dc819366bb0b7af38504f`.
- Scope: remove the cumulative native stderr lifetime limit; retain per-record validation and bounded output under backpressure. No database migration is introduced by this change.
- Owner instruction: no deployment until separately authorized.

| Environment | Status    | Evidence / remaining work                                                                                                                                                                                                                                                                  |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| staging     | `pending` | No installation or process-level recovery qualification performed.                                                                                                                                                                                                                         |
| production  | `pending` | Previous Gateway #100 remains installed. On November 8, Gateway exited with `diagnostic_limit`; on November 9 its existing systemd unit was started once and reported active. No production UI or account operation was verified after that start. The merged source fix is not installed. |

The unit uses `Restart=no`. The existing cold-fleet service explicitly does not provide automatic recovery. Do not enable unconditional restart solely from the successful manual start: Gateway preserves exact native-parent custody and may report `pending` after incomplete retirement. First qualify startup after abrupt loss and retained in-flight/unknown effects using disposable infrastructure; never replay an ambiguous provider request. Any later authorized rollout must follow the existing paired Gateway/native release procedure and verify the actual installed build plus account-list recovery.
