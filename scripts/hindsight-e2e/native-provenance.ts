import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hindsightCleanupDigest } from "../../packages/features/memory/src/infrastructure/hindsight/hindsight-cleanup-receipt.ts";
import { nativeRevision } from "./prepare-hardening.ts";
import { dockerCommand } from "./native-runtime.ts";
import { nativeSqlArguments, type NativeSqlStep } from "./operator-host.ts";

export type NativeSql = (
  steps: readonly NativeSqlStep[],
  readOnly?: boolean,
) => Promise<string>;
export interface ProvenanceBinding {
  readonly namespace: string;
  readonly generation: string;
  readonly imageDigest: string;
}
export interface ProvenanceCoverage {
  readonly profile: "postgresql-trigger-ledger-v1";
  readonly activationDigest: string;
  readonly definitionDigest: string;
  readonly sqlDigest: string;
  readonly installedAt: string;
  readonly operationCount: number;
  readonly historicalObservationCount: number;
}
export interface ProvenanceInventory {
  readonly sourceFactIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly historicalObservationCount: number;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export function provenanceSchema(schema: string): string {
  assert(
    schema.length > 0 &&
      schema.length <= 63 &&
      /^[a-zA-Z_]/.test(schema) &&
      !/[^a-zA-Z0-9_]/.test(schema),
  );
  return `"${schema}"`;
}
export const nativeMigrationHead = "c7e2f9a4d1b8";
const ledgerTables = [
  "rr_hindsight_fact_identity",
  "rr_hindsight_observation_edge",
  "rr_hindsight_activation",
];
const nativeTables = [
  "banks",
  "documents",
  "memory_units",
  "invalidated_memory_units",
  "observation_history",
  "async_operations",
];
async function reviewedSql(schema: string) {
  const raw = await readFile(
    new URL("../../deploy/hindsight/provenance-ledger.sql", import.meta.url),
    "utf8",
  );
  return {
    raw,
    rendered: raw.replaceAll("__SCHEMA__", provenanceSchema(schema)),
    sqlDigest: hash(raw),
  };
}
/** Catalog, rather than a stored label, is the definition authority. Stable JSONB is hashed in PostgreSQL. */
export function provenanceDefinitions(schema: string): string {
  const names = [...ledgerTables, ...nativeTables].map(literal).join(",");
  const triggerTables = [...nativeTables, ...ledgerTables]
    .map(literal)
    .join(",");
  return `(SELECT jsonb_build_object(
    'migrations',(SELECT jsonb_agg(version_num ORDER BY version_num) FROM ${provenanceSchema(schema)}.alembic_version),
    'functions', (SELECT jsonb_agg(jsonb_build_object('name',p.proname,'body',p.prosrc,'language',l.lanname,
      'security',p.prosecdef,'args',p.pronargs,'result',p.prorettype::regtype::text,'config',p.proconfig,
      'strict',p.proisstrict,'volatility',p.provolatile,'parallel',p.proparallel,'leakproof',p.proleakproof) ORDER BY p.proname)
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE n.nspname=${literal(schema)} AND p.proname IN ('rr_hindsight_track','rr_hindsight_immutable')),
    'triggers', (SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'table',c.relname,'type',t.tgtype,
      'state',t.tgenabled,'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',p.proname,'functionSchema',pn.nspname,'args',encode(t.tgargs,'hex'),
      'condition',pg_catalog.pg_get_expr(t.tgqual,t.tgrelid),'columns',t.tgattr::text,'constraint',t.tgconstraint::text) ORDER BY t.tgname)
      FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
      JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname=${literal(schema)} AND c.relname IN (${triggerTables}) AND NOT t.tgisinternal),
    'indexes',(SELECT jsonb_agg(jsonb_build_object('name',ic.relname,'table',c.relname,'keys',i.indkey::text,'valid',i.indisvalid,'ready',i.indisready,'definition',pg_catalog.pg_get_indexdef(i.indexrelid)) ORDER BY ic.relname) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid WHERE n.nspname=${literal(schema)} AND c.relname IN (${ledgerTables.map(literal).join(",")})),
    'tables', (SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,
      'rls',c.relrowsecurity,'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated::text,a.attidentity::text,pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints',(SELECT jsonb_agg(jsonb_build_object('type',k.contype,'keys',k.conkey,'foreignKeys',k.confkey,
        'foreignTable',fc.relname,'foreignSchema',fn.nspname,'validated',k.convalidated,'deferred',k.condeferrable,
        'update',k.confupdtype,'delete',k.confdeltype,'check',pg_catalog.pg_get_expr(k.conbin,k.conrelid),
        'validIndex',COALESCE(i.indisvalid,true)) ORDER BY k.contype,k.conname)
        FROM pg_catalog.pg_constraint k LEFT JOIN pg_catalog.pg_class fc ON fc.oid=k.confrelid
        LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid=fc.relnamespace LEFT JOIN pg_catalog.pg_index i ON i.indexrelid=k.conindid WHERE k.conrelid=c.oid)) ORDER BY c.relname)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${literal(schema)} AND c.relname IN (${names}))))`;
}
function attestDefinitions(definitions: any, raw: string, schema: string) {
  const functions = [
    ...raw.matchAll(
      /CREATE FUNCTION __SCHEMA__\.(\w+)\(\) RETURNS trigger\nLANGUAGE plpgsql SET search_path = pg_catalog AS \$rr\$([\s\S]*?)\$rr\$;/g,
    ),
  ]
    .map((match) => ({
      name: match[1],
      body: match[2]!.replaceAll("__SCHEMA__", provenanceSchema(schema)),
      language: "plpgsql",
      security: false,
      args: 0,
      result: "trigger",
      config: ["search_path=pg_catalog"],
      strict: false,
      volatility: "v",
      parallel: "u",
      leakproof: false,
    }))
    .sort((a, b) => a.name!.localeCompare(b.name!));
  assert.equal(functions.length, 2);
  assert.deepEqual(
    definitions.functions,
    functions,
    "Native provenance function definition drift",
  );
  const triggers = [
    ["rr_hindsight_track_live", "memory_units", 21, "rr_hindsight_track"],
    [
      "rr_hindsight_track_archive",
      "invalidated_memory_units",
      21,
      "rr_hindsight_track",
    ],
    [
      "rr_hindsight_immutable_facts",
      ledgerTables[0],
      58,
      "rr_hindsight_immutable",
    ],
    [
      "rr_hindsight_immutable_edges",
      ledgerTables[1],
      58,
      "rr_hindsight_immutable",
    ],
    [
      "rr_hindsight_immutable_activation",
      ledgerTables[2],
      58,
      "rr_hindsight_immutable",
    ],
  ]
    .map(([name, table, type, fn]) => ({
      name,
      table,
      type,
      state: "O",
      function: fn,
      functionSchema: schema,
      args: "",
      condition: null,
      columns: "",
      constraint: "0",
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  assert.deepEqual(
    definitions.triggers.map((trigger: any) =>
      Object.fromEntries(
        Object.entries(trigger).filter(([key]) => key !== "definition"),
      ),
    ),
    triggers,
    "Native provenance trigger definition/state drift",
  );
  assert.equal(definitions.indexes.length, 5);
  for (const index of definitions.indexes)
    assert(index.valid && index.ready && typeof index.definition === "string");
  assert(
    definitions.indexes.some(
      (index: any) =>
        index.name === "rr_hindsight_fact_document" && index.keys === "2 3",
    ),
  );
  assert(
    definitions.indexes.some(
      (index: any) =>
        index.name === "rr_hindsight_edge_fact" && index.keys === "2 1",
    ),
  );
  const columns: Record<string, [string, string][]> = {
    rr_hindsight_fact_identity: [
      ["fact_id", "uuid"],
      ["bank_id", "text"],
      ["document_id", "text"],
      ["fact_type", "text"],
    ],
    rr_hindsight_observation_edge: [
      ["observation_id", "uuid"],
      ["fact_id", "uuid"],
    ],
    rr_hindsight_activation: [
      ["singleton", "boolean"],
      ["activation", "jsonb"],
    ],
  };
  assert.deepEqual(definitions.migrations, [nativeMigrationHead]);
  assert.equal(definitions.tables.length, 9);
  for (const table of definitions.tables) {
    if (!ledgerTables.includes(table.name)) {
      const required: Record<string, Record<string, string>> = {
        banks: { bank_id: "text" },
        documents: { id: "text", bank_id: "text" },
        memory_units: {
          id: "uuid",
          bank_id: "text",
          document_id: "text",
          fact_type: "text",
          source_memory_ids: "uuid[]",
        },
        invalidated_memory_units: {
          id: "uuid",
          bank_id: "text",
          document_id: "text",
          fact_type: "text",
          source_memory_ids: "uuid[]",
        },
        observation_history: {
          observation_id: "uuid",
          bank_id: "text",
          content: "jsonb",
        },
        async_operations: { operation_id: "uuid" },
      };
      for (const [name, type] of Object.entries(required[table.name]!)) {
        const column = table.columns.find(
          (column: any[]) => column[0] === name,
        );
        assert(
          column &&
            (column[1] === type ||
              (type === "text" && /^character varying/.test(column[1]))),
          "Unqualified native identity column",
        );
      }
      assert.equal(table.kind, "r");
      assert.equal(table.persistence, "p");
      assert.equal(table.rls, false);
      continue;
    }
    assert.deepEqual(
      { kind: table.kind, persistence: table.persistence, rls: table.rls },
      { kind: "r", persistence: "p", rls: false },
    );
    assert.deepEqual(
      table.columns,
      columns[table.name]!.map(([name, type]) => [
        name,
        type,
        true,
        "",
        "",
        null,
      ]),
    );
    const constraints = table.constraints;
    assert.equal(constraints.length, 2);
    for (const c of constraints)
      assert(c.validated && !c.deferred && c.validIndex);
    const primary = constraints.find((c: any) => c.type === "p");
    assert.deepEqual(
      primary.keys,
      table.name === "rr_hindsight_observation_edge" ? [1, 2] : [1],
    );
    if (table.name === "rr_hindsight_observation_edge") {
      const foreign = constraints.find((c: any) => c.type === "f");
      assert(
        foreign &&
          foreign.foreignTable === ledgerTables[0] &&
          foreign.foreignSchema === schema &&
          foreign.update === "a" &&
          foreign.delete === "a",
      );
      assert.deepEqual(foreign.keys, [2]);
      assert.deepEqual(foreign.foreignKeys, [1]);
    } else {
      const check = constraints.find((c: any) => c.type === "c");
      assert.equal(
        check?.check,
        table.name === "rr_hindsight_activation"
          ? "singleton"
          : "(fact_type = ANY (ARRAY['world'::text, 'experience'::text]))",
      );
    }
  }
}
const definitionDigest = (schema: string) =>
  `encode(pg_catalog.sha256(pg_catalog.convert_to(${provenanceDefinitions(schema)}::text,'UTF8')),'hex')`;
export async function installNativeProvenance(
  sql: NativeSql,
  schema: string,
  binding: ProvenanceBinding,
): Promise<void> {
  const reviewed = await reviewedSql(schema);
  const q = provenanceSchema(schema);
  const metadata = JSON.stringify({
    schema,
    ...binding,
    nativeRevision,
    sqlDigest: reviewed.sqlDigest,
    profile: "postgresql-trigger-ledger-v1",
  });
  await sql(
    [
      { statement: "SELECT pg_catalog.pg_advisory_xact_lock(728104031)" },
      {
        statement: `LOCK TABLE ${nativeTables.map((t) => `${q}.${t}`).join(",")} IN ACCESS EXCLUSIVE MODE`,
      },
      {
        statement: `DO $fresh$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend')
        OR ${nativeTables.map((t) => `EXISTS (SELECT 1 FROM ${q}.${t})`).join(" OR ")}
      THEN RAISE EXCEPTION 'Native provenance activation requires fresh empty storage and no other clients'; END IF;
      END $fresh$;`,
      },
      { statement: reviewed.rendered },
      {
        statement: `INSERT INTO ${q}.rr_hindsight_activation VALUES (true,$1::jsonb || jsonb_build_object('definitionDigest',${definitionDigest(schema)},'installedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`,
        parameters: [metadata],
      },
      { statement: "SELECT 'installed'" },
    ],
    false,
  );
  await verifyNativeProvenance(sql, schema, binding, new Date().toISOString());
}
export async function verifyNativeProvenance(
  sql: NativeSql,
  schema: string,
  binding: ProvenanceBinding,
  pauseObservedAt: string,
): Promise<
  Omit<ProvenanceCoverage, "operationCount" | "historicalObservationCount">
> {
  const reviewed = await reviewedSql(schema);
  const q = provenanceSchema(schema);
  const result = JSON.parse(
    await sql([
      {
        statement: `SELECT jsonb_build_object('definitions',${provenanceDefinitions(schema)},'definitionDigest',${definitionDigest(schema)},'activations',(SELECT jsonb_agg(activation) FROM ${q}.rr_hindsight_activation))::text`,
      },
    ]),
  );
  attestDefinitions(result.definitions, reviewed.raw, schema);
  assert.equal(result.activations.length, 1);
  const activation = result.activations[0];
  assert.deepEqual(
    Object.keys(activation).sort(),
    [
      "schema",
      "namespace",
      "generation",
      "imageDigest",
      "nativeRevision",
      "sqlDigest",
      "profile",
      "definitionDigest",
      "installedAt",
    ].sort(),
  );
  assert.equal(activation.schema, schema);
  assert.equal(activation.namespace, binding.namespace);
  assert.equal(activation.generation, binding.generation);
  assert.equal(activation.imageDigest, binding.imageDigest);
  assert.equal(activation.nativeRevision, nativeRevision);
  assert.equal(activation.sqlDigest, reviewed.sqlDigest);
  assert.equal(activation.profile, "postgresql-trigger-ledger-v1");
  assert.equal(activation.definitionDigest, result.definitionDigest);
  assert(
    Number.isFinite(Date.parse(activation.installedAt)) &&
      Date.parse(activation.installedAt) <= Date.parse(pauseObservedAt),
    "Native provenance was not installed before this pause",
  );
  return {
    profile: activation.profile,
    activationDigest: hindsightCleanupDigest(activation),
    definitionDigest: activation.definitionDigest,
    sqlDigest: activation.sqlDigest,
    installedAt: activation.installedAt,
  };
}
export async function captureNativeProvenance(
  sql: NativeSql,
  schema: string,
  bank: string,
  document: string,
): Promise<ProvenanceInventory> {
  const q = provenanceSchema(schema);
  const data = JSON.parse(
    await sql([
      {
        statement: `WITH facts AS (SELECT fact_id FROM ${q}.rr_hindsight_fact_identity WHERE bank_id=$1 AND document_id=$2 ORDER BY fact_id LIMIT 10001),
    observations AS (SELECT DISTINCT observation_id FROM ${q}.rr_hindsight_observation_edge WHERE fact_id IN (SELECT fact_id FROM facts) ORDER BY observation_id LIMIT 10001)
    SELECT jsonb_build_object('sourceFactIds',COALESCE((SELECT jsonb_agg(fact_id ORDER BY fact_id) FROM facts),'[]'::jsonb),
      'observationIds',COALESCE((SELECT jsonb_agg(observation_id ORDER BY observation_id) FROM observations),'[]'::jsonb),
      'historicalObservationCount',(SELECT count(DISTINCT observation_id) FROM ${q}.observation_history WHERE bank_id=$1 AND observation_id IN (SELECT observation_id FROM observations)))::text`,
        parameters: [bank, document],
      },
    ]),
  );
  assert(
    data.sourceFactIds.length <= 10_000 && data.observationIds.length <= 10_000,
  );
  return data;
}
/** Native public document deletion runs first. Exact IDs also cover orphaned live/archive heads. */
export async function removeNativeProvenanceHeadsAndHistory(
  sql: NativeSql,
  schema: string,
  bank: string,
  inventory: ProvenanceInventory,
): Promise<void> {
  const q = provenanceSchema(schema);
  const ids = [...inventory.sourceFactIds, ...inventory.observationIds];
  await sql(
    [
      {
        statement: `LOCK TABLE ${q}.memory_units,${q}.invalidated_memory_units,${q}.observation_history IN ACCESS EXCLUSIVE MODE`,
      },
      ...["memory_units", "invalidated_memory_units"].map((t) => ({
        statement: `DELETE FROM ${q}.${t} WHERE bank_id=$1 AND id=ANY($2::uuid[])`,
        parameters: [bank, ids],
      })),
      {
        statement: `SELECT 1 / CASE WHEN
      EXISTS (SELECT 1 FROM ${q}.memory_units WHERE bank_id=$1 AND id=ANY($2::uuid[])) OR
      EXISTS (SELECT 1 FROM ${q}.invalidated_memory_units WHERE bank_id=$1 AND id=ANY($2::uuid[]))
      THEN 0 ELSE 1 END`,
        parameters: [bank, ids],
      },
      {
        statement: `DELETE FROM ${q}.observation_history WHERE bank_id=$1 AND observation_id=ANY($2::uuid[]) AND
      NOT EXISTS (SELECT 1 FROM ${q}.memory_units WHERE bank_id=$1 AND id=ANY($3::uuid[])) AND
      NOT EXISTS (SELECT 1 FROM ${q}.invalidated_memory_units WHERE bank_id=$1 AND id=ANY($3::uuid[]))`,
        parameters: [bank, inventory.observationIds, ids],
      },
      {
        statement: `SELECT (SELECT count(*) FROM ${q}.memory_units WHERE bank_id=$1 AND id=ANY($2::uuid[])) +
      (SELECT count(*) FROM ${q}.invalidated_memory_units WHERE bank_id=$1 AND id=ANY($2::uuid[])) +
      (SELECT count(*) FROM ${q}.observation_history WHERE bank_id=$1 AND observation_id=ANY($3::uuid[]))`,
        parameters: [bank, ids, inventory.observationIds],
      },
    ],
    false,
  ).then((value) =>
    assert.equal(value, "0", "Bound native heads/history survived cleanup"),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [schema, namespace, generation, imageDigest] = process.argv.slice(2);
  const dsn = process.env.HINDSIGHT_API_DATABASE_URL;
  assert(
    schema && namespace && generation && imageDigest && dsn,
    "Usage: native-provenance.ts SCHEMA NAMESPACE GENERATION IMAGE_DIGEST (HINDSIGHT_API_DATABASE_URL required)",
  );
  const sql: NativeSql = async (steps, readOnly = true) =>
    (
      await dockerCommand(nativeSqlArguments(dsn, imageDigest, steps, readOnly))
    ).trim();
  await installNativeProvenance(sql, schema, {
    namespace,
    generation,
    imageDigest,
  });
  process.stdout.write(
    "Fresh native provenance activated and definitions verified.\n",
  );
}
