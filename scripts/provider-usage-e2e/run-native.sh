#!/bin/bash
set -euo pipefail
mkdir /tmp/usage-pg
chown postgres:postgres /tmp/usage-pg
runuser -u postgres -- /usr/lib/postgresql/17/bin/initdb -D /tmp/usage-pg -A trust --no-locale >/tmp/initdb.log
runuser -u postgres -- /usr/lib/postgresql/17/bin/pg_ctl -D /tmp/usage-pg -l /tmp/pg.log -o '-h 127.0.0.1 -p 5432' start >/tmp/pg-start.log
trap 'runuser -u postgres -- /usr/lib/postgresql/17/bin/pg_ctl -D /tmp/usage-pg -m immediate stop >/tmp/pg-stop.log' EXIT
createdb -h 127.0.0.1 -U postgres ag_kernel_test_assembly_usage
createdb -h 127.0.0.1 -U postgres native_bootstrap_assembly_usage
export AG_ASSEMBLY_ALLOW=disposable_root_pg17_10
export AG_ASSEMBLY_KERNEL_DSN='postgres://postgres@127.0.0.1:5432/ag_kernel_test_assembly_usage?sslmode=disable'
export AG_ASSEMBLY_NATIVE_DSN='postgres://postgres@127.0.0.1:5432/native_bootstrap_assembly_usage?sslmode=disable'
node --test services/account-gateway/test/native-joined.test.ts
