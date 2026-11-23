# Preserve architecture checks during the native AST migration

Date: 2026-11-23. Status: planned; no completed CI or E2E claim.

## Problem and scope

Read-only review of the active native parser stack found two concrete regressions:
the architecture checker's regular expression no longer recognizes typed Prisma
transaction clients, and the layout collector no longer converts relative `.js`
imports to their `.ts` source paths. The TypeScript annotation range must also be
checked because the native AST represents the annotation wrapper separately from
its type. These checks must retain their previous rejecting behavior.

The source owners remain PRs #977, #980, #982 and #985. This repair is a narrow
dependent slice. It does not qualify or take over their application refactors,
temporary workflows, full compiler migration, or publication work.

## Source references

- Parent: #985, `b0e9985359b8c0041d4f6ce95a90eeb09578378d`.
- Latest architecture parser: #980, `6350ab59d02904bf8694858bac9a570ac874cb46`.
- Layout migration: #982, `938df9c7944b32e0c9f4d3310d059be0a3ef681d`.
- Compatible root parser/compiler dependencies are owned by #983.

## Implementation and verification

1. Reconcile the latest parent changes without replacing unrelated owner code.
2. Reproduce both defects with the exact native Oxc parser and TypeScript 7.0.2.
   Retain the failing output before changing production checks.
3. Repair the exact regular expressions and native type-annotation handling.
   Preserve transaction-name, inline/named callback and alias behavior.
4. Exercise qualified and unqualified `TransactionClient` parameters and nearby
   nonmatching types, as well as sequential operations. Retain the existing
   complete architecture negative fixtures and layout edge assertions.
5. Strictly typecheck owned tooling and tests, run source boundary checks and
   formatting, and record the exact source/dependency hashes and results.
6. Obtain independent review. Full integrated tooling, required final-head CI,
   merge and automatic CD remain part of the original E2E goal.

Every executed TypeScript compiler/parser must be 7.0.2 or newer. No legacy
comparison oracle, reduced test inventory, ignored diagnostic or weakened rule
is an acceptable replacement for these checks.
