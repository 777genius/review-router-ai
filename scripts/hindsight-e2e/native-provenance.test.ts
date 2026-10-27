import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import {
  installNativeProvenance,
  verifyNativeProvenance,
  captureNativeProvenance,
  removeNativeProvenanceHeadsAndHistory,
  type NativeSql,
  nativeMigrationHead,
} from "./native-provenance.ts";
const url = process.env.HINDSIGHT_PROVENANCE_TEST_DATABASE_URL;
const binding = {
  namespace: "test",
  generation: "fresh",
  imageDigest: `sha256:${"a".repeat(64)}`,
};
const suite = url ? test : test.skip;
suite(
  "PG17 native provenance: fresh activation, immutable mappings, all-ever edges and exact paused cleanup",
  async (t) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const sql: NativeSql = async (steps, readOnly = true) => {
      await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
      try {
        let value = "";
        for (const step of steps) {
          const result = await client.query(
            step.statement,
            step.parameters as any[],
          );
          value = String(
            result.rows?.[0] ? Object.values(result.rows[0])[0] : "",
          );
        }
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    };
    const schema = `native_${randomUUID().replaceAll("-", "")}`;
    const q = `"${schema}"`;
    const setup = async () => {
      await client.query(`CREATE SCHEMA ${q}; CREATE TABLE ${q}.banks(bank_id varchar(64) PRIMARY KEY);
      CREATE TABLE ${q}.alembic_version(version_num varchar(32)); INSERT INTO ${q}.alembic_version VALUES ('${nativeMigrationHead}');
      CREATE TABLE ${q}.documents(id text,bank_id text);
      CREATE TABLE ${q}.memory_units(id uuid PRIMARY KEY,bank_id text,document_id text,fact_type text,source_memory_ids uuid[],text text);
      CREATE TABLE ${q}.invalidated_memory_units(LIKE ${q}.memory_units INCLUDING ALL);
      CREATE TABLE ${q}.observation_history(id bigint GENERATED ALWAYS AS IDENTITY,observation_id uuid,bank_id text,content jsonb);
      CREATE TABLE ${q}.async_operations(operation_id uuid);`);
    };
    const fact = async (
      id: string,
      bank = "bank",
      document = "target",
      type = "world",
      table = "memory_units",
      sources: string[] = [],
    ) =>
      client.query(
        `INSERT INTO ${q}.${table} VALUES ($1,$2,$3,$4,$5,'private body')`,
        [id, bank, document, type, sources],
      );
    try {
      await setup();
      await t.test(
        "activation refuses any prior native data and other client backend",
        async () => {
          await client.query(`INSERT INTO ${q}.banks VALUES ('prior')`);
          await assert.rejects(installNativeProvenance(sql, schema, binding));
          await client.query(`DELETE FROM ${q}.banks`);
          const other = new pg.Client({ connectionString: url });
          await other.connect();
          try {
            await assert.rejects(installNativeProvenance(sql, schema, binding));
          } finally {
            await other.end();
          }
        },
      );
      await installNativeProvenance(sql, schema, binding);
      const activation = await verifyNativeProvenance(
        sql,
        schema,
        binding,
        new Date().toISOString(),
      );
      const [old, current, support, unrelated, obs, unrelatedObs] = Array.from(
        { length: 6 },
        () => randomUUID(),
      ) as [string, string, string, string, string, string];
      await t.test(
        "original identities remain immutable after source deletion; unknown type/remap rollback",
        async () => {
          await fact(old);
          await client.query(`DELETE FROM ${q}.memory_units WHERE id=$1`, [
            old,
          ]);
          await assert.rejects(fact(old, "bank", "other"));
          await assert.rejects(fact(old, "bank", "target", "experience"));
          await fact(old);
          await assert.rejects(
            client.query(
              `UPDATE ${q}.memory_units SET document_id='other' WHERE id=$1`,
              [old],
            ),
          );
          await assert.rejects(
            fact(randomUUID(), "bank", "target", "unqualified"),
          );
          await assert.rejects(
            client.query(`DELETE FROM ${q}.rr_hindsight_fact_identity`),
          );
          await assert.rejects(
            client.query(`TRUNCATE ${q}.rr_hindsight_observation_edge`),
          );
          await assert.rejects(
            client.query(
              `UPDATE ${q}.rr_hindsight_activation SET activation='{}'`,
            ),
          );
        },
      );
      await t.test(
        "live/archive insert and update record source IDs and preserve all-ever observation union",
        async () => {
          await fact(current);
          await fact(support, "bank", "survivor");
          await fact(
            unrelated,
            "bank",
            "unrelated",
            "experience",
            "invalidated_memory_units",
          );
          await fact(obs, "bank", null as any, "observation", "memory_units", [
            old,
            support,
          ]);
          await client.query(
            `UPDATE ${q}.memory_units SET source_memory_ids=$2 WHERE id=$1`,
            [obs, [support, current]],
          );
          await client.query(
            `INSERT INTO ${q}.invalidated_memory_units SELECT * FROM ${q}.memory_units WHERE id=$1`,
            [obs],
          );
          await client.query(
            `UPDATE ${q}.invalidated_memory_units SET source_memory_ids='{}' WHERE id=$1`,
            [obs],
          );
          const captured = await captureNativeProvenance(
            sql,
            schema,
            "bank",
            "target",
          );
          assert.deepEqual(
            new Set(captured.sourceFactIds),
            new Set([old, current]),
          );
          assert.deepEqual(captured.observationIds, [obs]);
        },
      );
      await t.test(
        "unknown/cross-bank sources and source-observation UUID collisions atomically roll back",
        async () => {
          const foreign = randomUUID();
          await fact(foreign, "foreign", "foreign");
          for (const sources of [
            [randomUUID()],
            [support, foreign],
            [support, null],
          ]) {
            const bad = randomUUID();
            await assert.rejects(
              fact(
                bad,
                "bank",
                null as any,
                "observation",
                "memory_units",
                sources as string[],
              ),
            );
            assert.equal(
              (
                await client.query(
                  `SELECT count(*) FROM ${q}.rr_hindsight_observation_edge WHERE observation_id=$1`,
                  [bad],
                )
              ).rows[0].count,
              "0",
            );
          }
          await assert.rejects(
            fact(
              support,
              "bank",
              null as any,
              "observation",
              "invalidated_memory_units",
              [current],
            ),
          );
          await assert.rejects(
            fact(
              obs,
              "foreign",
              null as any,
              "observation",
              "invalidated_memory_units",
              [foreign],
            ),
          );
          await assert.rejects(
            fact(randomUUID(), "bank", null as any, "observation"),
          );
        },
      );
      await t.test(
        "definition attestation rejects disabled/replaced/extra triggers and binding drift",
        async () => {
          await client.query(
            `ALTER TABLE ${q}.memory_units DISABLE TRIGGER rr_hindsight_track_live`,
          );
          await assert.rejects(
            verifyNativeProvenance(
              sql,
              schema,
              binding,
              new Date().toISOString(),
            ),
          );
          await client.query(
            `ALTER TABLE ${q}.memory_units ENABLE TRIGGER rr_hindsight_track_live`,
          );
          await client.query(
            `CREATE TRIGGER extra AFTER INSERT ON ${q}.memory_units FOR EACH ROW EXECUTE FUNCTION ${q}.rr_hindsight_track()`,
          );
          await assert.rejects(
            verifyNativeProvenance(
              sql,
              schema,
              binding,
              new Date().toISOString(),
            ),
          );
          await client.query(`DROP TRIGGER extra ON ${q}.memory_units`);
          await client.query(
            `ALTER FUNCTION ${q}.rr_hindsight_track() SECURITY DEFINER`,
          );
          await assert.rejects(
            verifyNativeProvenance(
              sql,
              schema,
              binding,
              new Date().toISOString(),
            ),
          );
          await client.query(
            `ALTER FUNCTION ${q}.rr_hindsight_track() SECURITY INVOKER`,
          );
          await assert.rejects(
            verifyNativeProvenance(
              sql,
              schema,
              { ...binding, generation: "other" },
              new Date().toISOString(),
            ),
          );
          await assert.rejects(
            verifyNativeProvenance(
              sql,
              schema,
              binding,
              "2000-01-01T00:00:00Z",
            ),
          );
          assert.deepEqual(
            await verifyNativeProvenance(
              sql,
              schema,
              binding,
              new Date().toISOString(),
            ),
            activation,
          );
        },
      );
      await t.test(
        "zero extracted facts are complete under trusted fresh activation",
        async () => {
          assert.deepEqual(
            await captureNativeProvenance(sql, schema, "bank", "pending-raw"),
            {
              sourceFactIds: [],
              observationIds: [],
              historicalObservationCount: 0,
            },
          );
        },
      );
      await t.test(
        "multiple history rows count distinct observations, including deleted orphan heads",
        async () => {
          await client.query(
            `INSERT INTO ${q}.observation_history(observation_id,bank_id,content) VALUES ($1,'bank','{"previous_text":"old private body"}'),($1,'bank','{"previous_text":"older private body"}')`,
            [obs],
          );
          await client.query(
            `DELETE FROM ${q}.memory_units WHERE id=ANY($1::uuid[])`,
            [[old, obs]],
          );
          assert.equal(
            (await captureNativeProvenance(sql, schema, "bank", "target"))
              .historicalObservationCount,
            1,
          );
        },
      );
      await t.test(
        "surviving bound archive heads prevent any history deletion and transaction rolls back",
        async () => {
          const inventory = await captureNativeProvenance(
            sql,
            schema,
            "bank",
            "target",
          );
          await client.query(`CREATE FUNCTION ${q}.keep_head() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$;
        CREATE TRIGGER keep_head BEFORE DELETE ON ${q}.invalidated_memory_units FOR EACH ROW EXECUTE FUNCTION ${q}.keep_head()`);
          await assert.rejects(
            removeNativeProvenanceHeadsAndHistory(
              sql,
              schema,
              "bank",
              inventory,
            ),
          );
          assert.equal(
            (await captureNativeProvenance(sql, schema, "bank", "target"))
              .historicalObservationCount,
            1,
          );
          assert.equal(
            (
              await client.query(
                `SELECT count(*) FROM ${q}.memory_units WHERE id=$1`,
                [current],
              )
            ).rows[0].count,
            "1",
          );
          await client.query(
            `DROP TRIGGER keep_head ON ${q}.invalidated_memory_units`,
          );
        },
      );
      await t.test(
        "exact cleanup removes orphan/shared history and all heads while preserving unrelated originals/history byte-for-byte",
        async () => {
          await fact(
            unrelatedObs,
            "bank",
            null as any,
            "observation",
            "memory_units",
            [unrelated],
          );
          await client.query(
            `INSERT INTO ${q}.observation_history(observation_id,bank_id,content) VALUES ($1,'bank','{"previous_text":"unrelated body"}'),($2,'foreign','{"previous_text":"same uuid other bank"}')`,
            [unrelatedObs, obs],
          );
          const preserved = async () =>
            (
              await client.query(
                `SELECT jsonb_build_object('heads',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM (SELECT * FROM ${q}.memory_units WHERE id=$1 UNION ALL SELECT * FROM ${q}.invalidated_memory_units WHERE id=$2) x),'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM ${q}.observation_history h WHERE observation_id=$3 OR bank_id='foreign')) AS snapshot`,
                [support, unrelated, unrelatedObs],
              )
            ).rows[0].snapshot;
          const before = await preserved();
          const inventory = await captureNativeProvenance(
            sql,
            schema,
            "bank",
            "target",
          );
          await removeNativeProvenanceHeadsAndHistory(
            sql,
            schema,
            "bank",
            inventory,
          );
          assert.equal(
            (await captureNativeProvenance(sql, schema, "bank", "target"))
              .historicalObservationCount,
            0,
          );
          assert.deepEqual(await preserved(), before);
          await removeNativeProvenanceHeadsAndHistory(
            sql,
            schema,
            "bank",
            inventory,
          );
          assert.deepEqual(await preserved(), before);
        },
      );
    } finally {
      await client.query(`DROP SCHEMA ${q} CASCADE`);
      await client.end();
    }
  },
);
