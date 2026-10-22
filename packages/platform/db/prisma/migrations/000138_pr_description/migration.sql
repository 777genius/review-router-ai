-- Optional parent-generation task and App-owned PR body publication reuse the
-- existing fenced execution/publication records. No new runtime privileges.
ALTER TYPE public."ReviewTaskKindV2" ADD VALUE 'pr_description';
ALTER TYPE public."ReviewPublicationKindV2" ADD VALUE 'pr_description';

-- An absent extension retains historical producer approval and capture bytes.
ALTER TABLE public."ProducerRelease" ADD COLUMN "prDescriptionProfile" JSONB;
