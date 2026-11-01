# Self-hosted private memory startup

For a fresh Linux x64 installation, use the complete first-install command:

```sh
node deploy/self-hosted/setup-memory.ts /absolute/selfhost.env
```

An optional second argument selects the operator directory instead of
`/srv/reviewrouter/hindsight-operator`. An optional third argument selects a
separate private scratch directory for source, build inputs and qualification
logs; models, completed qualification evidence and runtime state remain under
the durable operator directory. For example, after verifying the scratch mount:

```sh
node deploy/self-hosted/setup-memory.ts /absolute/selfhost.env /srv/reviewrouter/hindsight-operator /srv/workers/reviewrouter-memory-setup
```

The command verifies the signed pinned
native base and SDK checksum, builds the reviewed derivative, runs the real native
qualification, downloads SHA-pinned multilingual local models, invokes the locked
bootstrap and atomically merges provider settings into the private env. It prints
the exact subsequent Compose command. Explicit provider opt-outs and service
pauses survive. It does not publish an image or restart the control plane.
The shared setup lock serializes cooperating installers. The env merge compares
the file immediately before atomic replacement and keeps a private backup;
coordinate external editors because arbitrary file writes cannot share that lock.
Static memory controls accept Compose assignment syntax, including `export`,
colon separators, surrounding whitespace and inline comments. Dynamic variable
references, escaped control values and unsupported memory declarations stop
setup for explicit reconciliation; unrelated secret statements retain their bytes.

Local defaults are
[multilingual MiniLM embeddings](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/tree/e8f8c211226b894fcb81acc59f3b34ba3efd5f42)
and [multilingual mMARCO reranking](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1/tree/1427fd652930e4ba29e8149678df786c240d8825).
Only safetensors weights and required model/tokenizer configuration are fetched;
snapshots mount read-only, with remote model code disabled and runtime HF access
offline. Initial downloads are public, uncredentialed HTTPS requests. They do not
send approved memory text to an external inference provider.

The remaining sections describe the lower-level bootstrap for operators with
an already qualified native image or existing inference configuration.

The control-plane Compose stack can use the complete Hindsight memory provider.
Run the native backend separately using this Linux bootstrap. It shares the
existing standalone Docker deployment lock and provenance installer, preserving
the physical-Forget operator's supported inventory. Native containers have
`restart=no`; do not add them to Compose, systemd restart loops, or another
reconciler. A host reboot requires an explicit locked restart.

## Prepare the reviewed inputs

Follow [native qualification](README.md#reproducible-qualification) first. Keep
its completed `evidence.json`, the exact derivative image ID, and the immutable
PG17/pgvector image on the destination host. Evidence binds those same images;
an upstream image or mutable tag cannot replace the qualified derivative.
The first-install owner pins the signed native base to
`sha256:cdfeb26e92ad33d54a8a7e4cfe6e67b55d619f25ea5f5bba0a3281d701a82b36`
and PG17/pgvector to
`sha256:7d0a41464797aeb9862dfdc0bbf1526b82cfd324cdd8036df19e3545f4a9ccb8`,
the exact inputs used by the recorded 32-checkpoint native qualification. Reused
evidence must bind that PG image and its derivative must name that native base.

This bootstrap activates ordinary approved chunk storage with
`HINDSIGHT_API_LLM_PROVIDER=none`, observations disabled and automatic consolidation
disabled. It does not purchase generative inference or select a global user
account. Choose explicit models for embeddings and reranking. Put their native
Hindsight settings and `HINDSIGHT_API_LLM_PROVIDER=none` in a mode0600
operator-owned `inference.env`. Use Docker env-file syntax, unquoted values,
and no shell interpolation. The file accepts only inference settings; database,
service identity, privacy, logging and worker settings are bootstrap-owned.
Embeddings and reranking must each declare their provider and model. The `none`
LLM provider requires no model or credential. Local embedding/reranking models
are supported when explicitly configured;
review and pin their model revisions and any download/egress requirements.
Choose inference routing through the deployment's established account authority;
do not copy a user's selected review credential into a global native service.
The bootstrap does not choose or authorize an account, model, or data egress.
Native protocol qualification uses deterministic inference and does not establish
real model quality. Automatic learning remains unavailable until its per-user
selected-account Gateway inference path is separately qualified and activated.

Copy [bootstrap.example.json](bootstrap.example.json) to a mode0600 private
config, replace the image identities and absolute paths, and choose a private
API bind address reachable from the control-plane containers. For Docker bridge
deployments, inspect the actual host bridge gateway; the example `172.17.0.1`
is not universal. Loopback works only for control-plane processes sharing the
host network. Public addresses and wildcard binds are rejected. Restrict the
chosen private port to the control-plane hosts through the host firewall.

The separate PostgreSQL17 database binds loopback, uses a dedicated native
volume, and creates an isolated non-superuser native role. A second named volume
persists downloaded model caches across container replacement; both native
processes receive `HF_HOME` and `SENTENCE_TRANSFORMERS_HOME` within that volume.
Router's database
and its existing volume are never reused. Check free space and reserve the
three configured ports before starting. First-start model downloads use the
bounded `startupTimeoutMs` readiness budget (ten minutes by default, at most
thirty minutes); provision network access and storage for the chosen models.

## Validate, inspect, start

From the repository root, with Node 24 or later and Docker available:

```sh
node deploy/hindsight/bootstrap.ts validate /absolute/private/bootstrap.json
node deploy/hindsight/bootstrap.ts plan /absolute/private/bootstrap.json
node deploy/hindsight/bootstrap.ts apply /absolute/private/bootstrap.json
node deploy/hindsight/bootstrap.ts status /absolute/private/bootstrap.json
```

Validation/planning perform no infrastructure changes. Apply checks the local
immutable images and native evidence, then holds the existing Linux `flock` for
the complete installation. It generates independent database, service and
operator secrets plus an Ed25519 cleanup signing key into mode0600 files. It
migrates the empty native database and activates its provenance ledger before
starting the labeled native API and separate worker. It emits only paths and
bodyless status; native logs and credentials are not printed.

Completed apply can be repeated with the unchanged config and inputs; it
verifies the existing containers without creating another deployment. A partial
installation is deliberately preserved and refuses automatic replay. Use
`status`, inspect private state and reconcile the exact containers/volume under
the shared lock. Do not delete a volume, rerun fresh provenance against populated
data, or remove the partial state to force another attempt. Existing image,
namespace, generation or schema changes use the [recovery gate](README.md#recovery-and-native-upgrade-gate).

## Connect the control plane

After successful native readiness, `<directory>/router.env` contains the complete
provider, namespace, generation, service credential, operator token, image ID and
cleanup public-key binding. Merge those values privately into the **same** web,
API and Router worker configuration through your normal deployment mechanism.
Retain `<directory>/operator.env` and the signing key on the operator host only.
Neither file is a shell script; do not source it or print it to the console.

For the bundled control-plane stack, merge the router env into
`deploy/self-hosted/.env` (or its configured secret env file), then recreate web,
API and worker together through the normal upgrade path. The generated URL uses
the explicit private bind address so bridge containers do not mistakenly call
their own loopback. Verify connectivity from those containers before activation.

The bootstrap does not edit or restart the control plane and does not qualify
conversational automatic learning. Verify a disposable authorized Save/read/recall,
outbox settlement, isolation, revision change and signed physical Forget against
the actual selected models before widening usage. Keep conversation qualification
unset until its separate deployment checks pass. Existing native/runtime protocol
tests and process readiness alone do not establish that live end-to-end result.

Use the same `<directory>/deployment.lock` for every later start, stop,
replacement and [physical cleanup](README.md#signed-docker-operator-receipt):

```sh
node scripts/hindsight-e2e/deployment-lock.ts /absolute/operator/deployment.lock docker start EXACT_CONTAINER_ID
```

The native API and at least one separate worker remain part of the exact
standalone inventory. Preserve credentials, the volume, provenance, pending
commands and cleanup evidence through recovery and backups.
