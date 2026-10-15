BEGIN READ ONLY;
SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s';
DO $$ BEGIN IF current_database()<>'review_router_dimy' OR session_user<>'reviewrouter_pg' OR current_user<>session_user OR current_setting('transaction_read_only')<>'on' OR (SELECT system_identifier::text FROM pg_control_system())<>'7689268937922398406' OR (SELECT count(DISTINCT "workspaceId") FROM "WorkspaceMember" WHERE "workspaceId" IN ('cmoss4xkf000228sbtcmpdjb5','cmp6uhxh4000i30l17qas7qyf') AND "userId"='cmorhxrf1000329nh4rayyfgi' AND role IN ('owner','admin'))<>2 THEN RAISE EXCEPTION 'identity_denied'; END IF; END $$;
WITH c AS (SELECT * FROM "ProviderAccountConnection" WHERE "gatewayAccountRef"='8be745af-d76f-454b-bd12-edcb39cda001' AND "ownerWorkspaceId"='cmoss4xkf000228sbtcmpdjb5' AND "ownerUserId" IS NULL),
b AS (SELECT b.* FROM "WorkspaceAccountBinding" b JOIN c ON b."connectionId"=c.id WHERE b."workspaceId"='cmp6uhxh4000i30l17qas7qyf' AND b.state='active')
SELECT jsonb_build_object('kind','padel_explicit_canonical_codex_use_grant','observedAt',clock_timestamp(),'databaseIdentityVerified',true,'actorAdminInBothVerified',true,
 'canonicalConnectionCount',(SELECT count(*) FROM c),'activePadelUseCount',(SELECT count(*) FROM b),
 'canonicalAccount',(SELECT jsonb_build_object('connectionId',id,'gatewayAccountRef',"gatewayAccountRef",'ownerWorkspaceId',"ownerWorkspaceId",'state',state,'profileRef',"profileRef",'displayNameMatches',"displayName"='Codex main Account') FROM c),
 'padelUse',(SELECT jsonb_build_object('bindingId',id,'connectionId',"connectionId",'workspaceId',"workspaceId",'state',state,'revision',revision,'policyRevision',"policyRevision",'pendingFence',"pendingFenceOperationId" IS NOT NULL) FROM b));
ROLLBACK;
