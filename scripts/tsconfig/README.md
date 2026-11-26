# Targeted TypeScript checks

This directory holds specialized qualification projects invoked from the repository
root by package scripts and CI. Their include lists, path aliases and compiler
options are deliberately separate; do not merge them into one weaker project.

- Provider UI, subscription fixtures and rollback qualification
- Spike and hosted-pool operations checks
- Action build, modular composition, account metadata and one-shot handoff checks

The root `tsconfig.json` and `tsconfig.base.json` remain the default project and
shared base. The native compiler and lint/format pilot configs also remain at
root for their isolated qualification fixtures.

Historical deployment receipts preserve the commands and paths used at their
recorded commit. Use the current package scripts for new verification.
