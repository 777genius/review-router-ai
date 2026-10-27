export const skillCatalogRuntimeTables = [
  "ReviewSkillImportCandidate",
  "ReviewSkillScan",
] as const;
export const skillCatalogWebUpdateColumns = [
  "importedSkillId",
  "importedScanId",
  "importIntentDigest",
  "importedAt",
] as const;
export const skillCatalogWorkerUpdateColumns = [
  "status",
  "report",
  "startedAt",
  "completedAt",
  "claimId",
  "claimVersion",
  "claimUntil",
  "executionDeadlineAt",
  "slotUntil",
] as const;
function principal(value: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value))
    throw new Error("skill_catalog_runtime_role_invalid");
  return value;
}
const tablesSql = skillCatalogRuntimeTables
  .map((value) => `'${value}'`)
  .join(",");
const columnsSql = (values: readonly string[]) =>
  `ARRAY[${values.map((value) => `'${value}'`).join(",")}]::text[]`;
export function skillCatalogRuntimeGateStatements(
  roles: readonly Readonly<{ username: string }>[],
): string {
  return roles
    .map(
      ({ username }) => `DO $skill_catalog_gate_acl$
DECLARE target text; column_name text;
BEGIN
  FOREACH target IN ARRAY ARRAY[${tablesSql}] LOOP
    IF to_regclass(format('public.%I',target)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM %I',target,'${principal(username)}');
    FOR column_name IN SELECT attname FROM pg_attribute WHERE attrelid=to_regclass(format('public.%I',target)) AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM %I',column_name,target,'${username}');
    END LOOP;
  END LOOP;
END $skill_catalog_gate_acl$;`,
    )
    .join("\n");
}
export function skillCatalogRuntimeGrantStatements(
  roles: readonly Readonly<{ role: string; username: string }>[],
): string {
  return roles
    .map(({ role, username }) => {
      principal(username);
      const web = role === "web",
        worker = role === "worker",
        read = web || worker;
      return `DO $skill_catalog_runtime_acl$
DECLARE target text; column_name text; allowed_updates text[];
BEGIN
  FOREACH target IN ARRAY ARRAY[${tablesSql}] LOOP
    IF to_regclass(format('public.%I',target)) IS NULL THEN CONTINUE; END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${username}' AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
      OR pg_has_role('${username}',(SELECT relowner FROM pg_class WHERE oid=to_regclass(format('public.%I',target))),'SET') THEN
      RAISE EXCEPTION 'skill catalog runtime has privileged authority';
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, %I',target,'${username}');
    FOR column_name IN SELECT attname FROM pg_attribute WHERE attrelid=to_regclass(format('public.%I',target)) AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM PUBLIC, %I',column_name,target,'${username}');
    END LOOP;
    allowed_updates := CASE WHEN ${web} AND target='ReviewSkillImportCandidate' THEN ${columnsSql(skillCatalogWebUpdateColumns)}
      WHEN ${worker} AND target='ReviewSkillScan' THEN ${columnsSql(skillCatalogWorkerUpdateColumns)} ELSE ARRAY[]::text[] END;
    ${read ? `EXECUTE format('GRANT SELECT ON TABLE public.%I TO %I',target,'${username}');` : ""}
    ${web ? `EXECUTE format('GRANT INSERT ON TABLE public.%I TO %I',target,'${username}');` : ""}
    ${worker ? `EXECUTE format('GRANT DELETE ON TABLE public.%I TO %I',target,'${username}');` : ""}
    IF cardinality(allowed_updates)>0 THEN EXECUTE format('GRANT UPDATE (%s) ON TABLE public.%I TO %I',
      (SELECT string_agg(format('%I',entry),',') FROM unnest(allowed_updates) entry),target,'${username}'); END IF;
    IF has_table_privilege('${username}',format('public.%I',target),'SELECT') IS DISTINCT FROM ${read}
      OR has_table_privilege('${username}',format('public.%I',target),'INSERT') IS DISTINCT FROM ${web}
      OR has_table_privilege('${username}',format('public.%I',target),'DELETE') IS DISTINCT FROM ${worker}
      OR has_table_privilege('${username}',format('public.%I',target),'UPDATE,TRUNCATE,REFERENCES,TRIGGER')
      OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass(format('public.%I',target)) AND attnum>0 AND NOT attisdropped AND
        (has_column_privilege('${username}',attrelid,attnum,'UPDATE') IS DISTINCT FROM (attname=ANY(allowed_updates))
         OR has_column_privilege('${username}',attrelid,attnum,'INSERT') IS DISTINCT FROM ${web}
         OR has_column_privilege('${username}',attrelid,attnum,'REFERENCES'))) THEN
      RAISE EXCEPTION 'skill catalog runtime effective ACL incompatible';
    END IF;
  END LOOP;
END $skill_catalog_runtime_acl$;`;
    })
    .join("\n");
}
