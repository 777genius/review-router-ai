-- Private, bounded web-authored Skills and trusted Git descriptors. No Git blobs.
ALTER TABLE "ReviewRunAuthorization" ADD COLUMN "skillsSnapshotCanonicalJson" TEXT;
ALTER TABLE "ReviewRunAuthorization" ADD CONSTRAINT "ReviewRunAuthorization_skills_snapshot_size"
  CHECK ("skillsSnapshotCanonicalJson" IS NULL OR
         octet_length("skillsSnapshotCanonicalJson") <= 262144);

CREATE FUNCTION review_skills_authorization_capture_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW."skillsSnapshotCanonicalJson" IS DISTINCT FROM OLD."skillsSnapshotCanonicalJson" THEN
    RAISE EXCEPTION 'review_skills_capture_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER review_skills_authorization_capture_immutable
  BEFORE UPDATE OF "skillsSnapshotCanonicalJson" ON "ReviewRunAuthorization"
  FOR EACH ROW EXECUTE FUNCTION review_skills_authorization_capture_immutable();
REVOKE ALL ON FUNCTION review_skills_authorization_capture_immutable() FROM PUBLIC;
