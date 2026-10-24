/** Narrow additive ACL projection after the release tool's legacy CRUD grants. */
export const reviewSkillsRuntimeTables = [
  "ReviewSkill",
  "ReviewSkillRevision",
  "ReviewSkillGrant",
  "ReviewSkillLink",
  "ReviewSkillBinding",
  "ReviewSkillRepositorySource",
] as const;

const writableColumns: Readonly<Record<string, readonly string[]>> = {
  ReviewSkill: ["headRevisionId", "updatedAt", "deletedAt"],
  ReviewSkillRevision: [],
  ReviewSkillGrant: ["grantedBy", "grantedAt", "revokedAt", "version"],
  ReviewSkillLink: [
    "acceptedGrantVersion",
    "acceptedBy",
    "acceptedAt",
    "unlinkedAt",
  ],
  ReviewSkillBinding: ["includePaths", "excludePaths", "version"],
  ReviewSkillRepositorySource: ["roots", "version"],
};

function assertRuntimeUsername(username: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(username))
    throw new Error("review_skills_runtime_role_invalid");
}

/** The ordinary closed gate removes table writes; remove column writes too. */
export function reviewSkillsRuntimeGateStatements(
  roles: readonly Readonly<{ username: string }>[],
): string {
  return roles
    .map(({ username }) => {
      assertRuntimeUsername(username);
      return `DO $review_skills_runtime_gate_acl$
DECLARE skill_table text; skill_column record;
BEGIN
  FOREACH skill_table IN ARRAY ARRAY[${reviewSkillsRuntimeTables.map((table) => `'${table}'`).join(",")}] LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', skill_table)) IS NULL THEN CONTINUE; END IF;
    FOR skill_column IN SELECT attname FROM pg_catalog.pg_attribute
      WHERE attrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', skill_table)) AND attnum > 0 AND NOT attisdropped
    LOOP
      EXECUTE pg_catalog.format('REVOKE ALL (%I) ON TABLE public.%I FROM %I', skill_column.attname, skill_table, '${username}');
    END LOOP;
  END LOOP;
END
$review_skills_runtime_gate_acl$;`;
    })
    .join("\n");
}

export function reviewSkillsRuntimeGrantStatements(
  roles: readonly Readonly<{ role: string; username: string }>[],
): string {
  return roles
    .map(({ role, username }) => {
      assertRuntimeUsername(username);
      const web = role === "web",
        read = web || role === "api";
      return `DO $review_skills_runtime_acl$
DECLARE skill_table text; skill_column record; allowed_updates text[];
BEGIN
  FOREACH skill_table IN ARRAY ARRAY[${reviewSkillsRuntimeTables.map((table) => `'${table}'`).join(",")}] LOOP
    -- The same release tool also qualifies catalogs before Skills existed.
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', skill_table)) IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${username}'
      AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
      OR pg_catalog.pg_has_role('${username}', (SELECT relowner FROM pg_catalog.pg_class
        WHERE oid = pg_catalog.to_regclass(pg_catalog.format('public.%I', skill_table))), 'SET') THEN
      RAISE EXCEPTION 'review skills runtime has owner/privileged authority: %', '${username}';
    END IF;
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, %I', skill_table, '${username}');
    -- Table REVOKE does not clear stale per-column privileges.
    FOR skill_column IN SELECT attname FROM pg_catalog.pg_attribute
      WHERE attrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', skill_table)) AND attnum > 0 AND NOT attisdropped
    LOOP
      EXECUTE pg_catalog.format('REVOKE ALL (%I) ON TABLE public.%I FROM PUBLIC, %I', skill_column.attname, skill_table, '${username}');
    END LOOP;
    allowed_updates := CASE skill_table ${Object.entries(writableColumns)
      .map(
        ([table, columns]) =>
          `WHEN '${table}' THEN ARRAY[${columns.map((column) => `'${column}'`).join(",")}]::text[]`,
      )
      .join(" ")} ELSE ARRAY[]::text[] END;
    ${read ? `EXECUTE pg_catalog.format('GRANT SELECT ON TABLE public.%I TO %I', skill_table, '${username}');` : ""}
    ${
      web
        ? `EXECUTE pg_catalog.format('GRANT INSERT ON TABLE public.%I TO %I', skill_table, '${username}');
    IF cardinality(allowed_updates) > 0 THEN
      EXECUTE pg_catalog.format('GRANT UPDATE (%s) ON TABLE public.%I TO %I',
        (SELECT string_agg(pg_catalog.format('%I', column_name), ', ') FROM unnest(allowed_updates) column_name), skill_table, '${username}');
    END IF;
    IF skill_table = 'ReviewSkillBinding' THEN EXECUTE pg_catalog.format('GRANT DELETE ON TABLE public.%I TO %I', skill_table, '${username}'); END IF;`
        : ""
    }
    IF pg_catalog.has_table_privilege('${username}', pg_catalog.format('public.%I', skill_table), 'SELECT') IS DISTINCT FROM ${read}
      OR pg_catalog.has_table_privilege('${username}', pg_catalog.format('public.%I', skill_table), 'INSERT') IS DISTINCT FROM ${web}
      OR pg_catalog.has_table_privilege('${username}', pg_catalog.format('public.%I', skill_table), 'DELETE') IS DISTINCT FROM (${web} AND skill_table = 'ReviewSkillBinding')
      OR pg_catalog.has_table_privilege('${username}', pg_catalog.format('public.%I', skill_table), 'UPDATE,TRUNCATE,REFERENCES,TRIGGER')
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', skill_table)) AND attnum > 0 AND NOT attisdropped
        AND (pg_catalog.has_column_privilege('${username}', attrelid, attnum, 'UPDATE') IS DISTINCT FROM (${web} AND attname = ANY(allowed_updates))
          OR pg_catalog.has_column_privilege('${username}', attrelid, attnum, 'INSERT') IS DISTINCT FROM ${web}
          OR pg_catalog.has_column_privilege('${username}', attrelid, attnum, 'REFERENCES'))) THEN
      RAISE EXCEPTION 'review skills runtime effective ACL incompatible: %, %', '${username}', skill_table;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('public.rr_review_skills_repository_lock(text,text[])') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_roles owner ON owner.oid = routine.proowner
      WHERE routine.oid = 'public.rr_review_skills_repository_lock(text,text[])'::regprocedure
        AND routine.prosecdef AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
        AND owner.rolname = 'reviewrouter_release_schema_owner' AND NOT owner.rolcanlogin)
      OR pg_catalog.pg_has_role('${username}', 'reviewrouter_release_schema_owner', 'SET') THEN
      RAISE EXCEPTION 'review skills repository lock authority incompatible';
    END IF;
    REVOKE ALL ON FUNCTION public.rr_review_skills_repository_lock(text,text[]) FROM PUBLIC;
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.rr_review_skills_repository_lock(text,text[]) FROM %I', '${username}');
    ${web ? `EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public.rr_review_skills_repository_lock(text,text[]) TO %I', '${username}');` : ""}
    IF pg_catalog.has_function_privilege('${username}', 'public.rr_review_skills_repository_lock(text,text[])', 'EXECUTE') IS DISTINCT FROM ${web} THEN
      RAISE EXCEPTION 'review skills repository lock execute ACL incompatible';
    END IF;
  END IF;
END
$review_skills_runtime_acl$;`;
    })
    .join("\n");
}
