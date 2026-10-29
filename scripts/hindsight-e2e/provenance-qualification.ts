import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  captureNativeProvenance,
  installNativeProvenance,
  nativeMigrationHead,
  removeNativeProvenanceHeadsAndHistory,
  verifyNativeProvenance,
  type NativeSql,
  type ProvenanceBinding,
} from "./native-provenance.ts";
/** Runs in the real qualified PG17/image before native writers start. No extra npm runtime. */
export async function qualifyNativeProvenance(
  sql: NativeSql,
  binding: ProvenanceBinding,
): Promise<void> {
  const schema = `rr_ledger_${randomUUID().replaceAll("-", "")}`;
  const q = `"${schema}"`;
  const exec = async (statement: string, parameters: readonly unknown[] = []) =>
    sql([{ statement, parameters }, { statement: "SELECT 'ok'" }], false);
  const scalar = (statement: string, parameters: readonly unknown[] = []) =>
    sql([{ statement, parameters }]);
  const [old, current, support, obs, unrelated, otherObs] = Array.from(
    { length: 6 },
    () => randomUUID(),
  ) as [string, string, string, string, string, string];
  try {
    await exec(`CREATE SCHEMA ${q};CREATE TABLE ${q}.alembic_version(version_num text);INSERT INTO ${q}.alembic_version VALUES ('${nativeMigrationHead}');
      CREATE TABLE ${q}.banks(bank_id text);CREATE TABLE ${q}.documents(id text,bank_id text);
      CREATE TABLE ${q}.memory_units(id uuid PRIMARY KEY,bank_id text,document_id text,fact_type text,source_memory_ids uuid[],text text);
      CREATE TABLE ${q}.invalidated_memory_units(LIKE ${q}.memory_units INCLUDING ALL);
      CREATE TABLE ${q}.observation_history(id bigint GENERATED ALWAYS AS IDENTITY,observation_id uuid,bank_id text,content jsonb);
      CREATE TABLE ${q}.async_operations(operation_id uuid);`);
    await exec(`INSERT INTO ${q}.banks VALUES ('prior')`);
    await assert.rejects(installNativeProvenance(sql, schema, binding));
    await exec(`DELETE FROM ${q}.banks`);
    await installNativeProvenance(sql, schema, binding);
    const activation = await verifyNativeProvenance(
      sql,
      schema,
      binding,
      new Date().toISOString(),
    );
    await exec(
      `INSERT INTO ${q}.memory_units VALUES ($1,'bank','target','world','{}','old'),($2,'bank','target','world','{}','current'),($3,'bank','support','world','{}','support'),($4,'bank','unrelated','world','{}','unrelated')`,
      [old, current, support, unrelated],
    );
    await exec(
      `INSERT INTO ${q}.memory_units VALUES ($1,'bank',NULL,'observation',$2,'shared')`,
      [obs, [old, support]],
    );
    await exec(
      `UPDATE ${q}.memory_units SET source_memory_ids=$2 WHERE id=$1`,
      [obs, [current, support]],
    );
    await exec(
      `INSERT INTO ${q}.invalidated_memory_units SELECT * FROM ${q}.memory_units WHERE id=$1`,
      [obs],
    );
    await exec(
      `UPDATE ${q}.invalidated_memory_units SET source_memory_ids='{}' WHERE id=$1`,
      [obs],
    );
    await assert.rejects(
      exec(`UPDATE ${q}.memory_units SET document_id='remap' WHERE id=$1`, [
        old,
      ]),
    );
    await assert.rejects(
      exec(
        `INSERT INTO ${q}.memory_units VALUES ($1,'bank','target','unknown','{}','bad')`,
        [randomUUID()],
      ),
    );
    await assert.rejects(
      exec(
        `INSERT INTO ${q}.invalidated_memory_units VALUES ($1,'foreign',NULL,'observation',$2,'bad')`,
        [randomUUID(), [support]],
      ),
    );
    await assert.rejects(exec(`DELETE FROM ${q}.rr_hindsight_fact_identity`));
    await exec(
      `ALTER TABLE ${q}.memory_units DISABLE TRIGGER rr_hindsight_track_live`,
    );
    await assert.rejects(
      verifyNativeProvenance(sql, schema, binding, new Date().toISOString()),
    );
    await exec(
      `ALTER TABLE ${q}.memory_units ENABLE TRIGGER rr_hindsight_track_live`,
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
    await exec(
      `INSERT INTO ${q}.observation_history(observation_id,bank_id,content) VALUES ($1,'bank','{"previous_text":"orphan"}'),($1,'bank','{"previous_text":"older"}')`,
      [obs],
    );
    await exec(`DELETE FROM ${q}.memory_units WHERE id=ANY($1::uuid[])`, [
      [old, obs],
    ]);
    await exec(
      `INSERT INTO ${q}.memory_units VALUES ($1,'bank',NULL,'observation',$2,'unrelated observation')`,
      [otherObs, [unrelated]],
    );
    await exec(
      `INSERT INTO ${q}.observation_history(observation_id,bank_id,content) VALUES ($1,'bank','{"previous_text":"unrelated"}')`,
      [otherObs],
    );
    const snapshot = () =>
      scalar(
        `SELECT jsonb_build_object('head',(SELECT to_jsonb(m) FROM ${q}.memory_units m WHERE id=$1),'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM ${q}.observation_history h WHERE observation_id=$1))::text`,
        [otherObs],
      );
    const preserved = await snapshot();
    const inventory = await captureNativeProvenance(
      sql,
      schema,
      "bank",
      "target",
    );
    assert.deepEqual(new Set(inventory.sourceFactIds), new Set([old, current]));
    assert.deepEqual(inventory.observationIds, [obs]);
    assert.equal(inventory.historicalObservationCount, 1);
    await exec(`CREATE FUNCTION ${q}.keep_head() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL;END$$;
      CREATE TRIGGER keep_head BEFORE DELETE ON ${q}.invalidated_memory_units FOR EACH ROW EXECUTE FUNCTION ${q}.keep_head()`);
    await assert.rejects(
      removeNativeProvenanceHeadsAndHistory(sql, schema, "bank", inventory),
    );
    assert.equal(
      (await captureNativeProvenance(sql, schema, "bank", "target"))
        .historicalObservationCount,
      1,
    );
    await exec(`DROP TRIGGER keep_head ON ${q}.invalidated_memory_units`);
    await removeNativeProvenanceHeadsAndHistory(sql, schema, "bank", inventory);
    await removeNativeProvenanceHeadsAndHistory(sql, schema, "bank", inventory);
    assert.equal(await snapshot(), preserved);
    assert.deepEqual(
      await captureNativeProvenance(sql, schema, "bank", "pending-raw"),
      { sourceFactIds: [], observationIds: [], historicalObservationCount: 0 },
    );
    await verifyNativeProvenance(
      sql,
      schema,
      binding,
      new Date().toISOString(),
    );
  } finally {
    await exec(`DROP SCHEMA IF EXISTS ${q} CASCADE`);
  }
}
