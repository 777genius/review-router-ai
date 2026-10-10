# Native compiler pilot

The default compiler remains the ordinary TypeScript 6.0.3 package, including
its compiler API. Native TypeScript 7.0.2 is an explicit development CLI pilot.
Both packages publish a bin named `tsc`; installing their aliases together can
change the existing PATH command. The native alias therefore belongs in the
separate private `scripts/local-checks/native` installation, outside the pnpm
workspace. Its private package manifest and frozen lock pin the opt-in installation.

Install the opt-in compiler with:

```sh
pnpm --dir scripts/local-checks/native install --ignore-workspace --ignore-scripts --frozen-lockfile
```

Invoke from the package whose project is being checked; resolve the helper path
relative to that package. For example, from the repository root:

```sh
node scripts/local-checks/compiler-cli.ts --native --noEmit -p tsconfig.tooling.json
node scripts/local-checks/compiler-cli.ts --legacy --noEmit -p tsconfig.tooling.json
```

Omitting the selector uses the pinned legacy compiler. Native installation or
compilation failures remain failures; fallback is an explicit second command.
Neither mode consults PATH, changes cwd, rewrites project flags, or installs
dependencies. Version mismatches fail before compilation.

`tsconfig.tooling.json` extends the existing strict base and covers the heading
helper/test, compiler harness, and the agreed N1 `lint-format-*.ts/.mts` inputs.
The authoritative typecheck script includes its explicit legacy invocation;
the existing root tsconfig alone does not establish coverage. One-shot
NodeNext, spikes and hosted-pool operations retain their separate projects.

The compiler suite checks real compiler failures, strict flags, alias consumers,
actual package and restricted contract-source JS/declaration emission, retained
AST/transpile APIs and a pure Node heading import. It runs the existing ESM
rewriter only on disposable emitted outputs. Declaration comparison permits only
union member reordering, preserving every member; JS is compared byte for byte.

The suite is named `compiler-cli.pilot.ts`, so ordinary Vitest discovery does
not load it or require the optional native installation. Run its dedicated gate
in a disposable TEST copy with both pinned installations present:

```sh
node scripts/local-checks/compiler-cli.ts --legacy --noEmit -p tsconfig.tooling.json
pnpm exec vitest run --config scripts/local-checks/compiler-vitest.config.ts
```

The complete compiler-route inventory contains optional candidate and explicit
legacy command fragments. Applying the pilot does not replace those routes.
Turbo dependency ordering/output keys, Next build and plugin/API resolution,
generated Next types, production exports, offline Prisma preparation and all
workflow routes remain independent integration obligations. Native noEmit
success does not qualify a Next production build.
