-- Reviewed ID-only provenance; install exclusively on a freshly migrated empty database.
CREATE TABLE __SCHEMA__.rr_hindsight_fact_identity (
  fact_id uuid PRIMARY KEY, bank_id text NOT NULL, document_id text NOT NULL,
  fact_type text NOT NULL CHECK (fact_type IN ('world', 'experience'))
);
CREATE INDEX rr_hindsight_fact_document ON __SCHEMA__.rr_hindsight_fact_identity(bank_id, document_id);
CREATE TABLE __SCHEMA__.rr_hindsight_observation_edge (
  observation_id uuid NOT NULL, fact_id uuid NOT NULL REFERENCES __SCHEMA__.rr_hindsight_fact_identity(fact_id),
  PRIMARY KEY (observation_id, fact_id)
);
CREATE INDEX rr_hindsight_edge_fact ON __SCHEMA__.rr_hindsight_observation_edge(fact_id, observation_id);
CREATE TABLE __SCHEMA__.rr_hindsight_activation (
  singleton boolean PRIMARY KEY CHECK (singleton), activation jsonb NOT NULL
);
CREATE FUNCTION __SCHEMA__.rr_hindsight_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $rr$
BEGIN
  RAISE EXCEPTION 'ReviewRouter provenance is append-only';
END
$rr$;
CREATE FUNCTION __SCHEMA__.rr_hindsight_track() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $rr$
DECLARE source_id uuid; known record;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.bank_id IS DISTINCT FROM OLD.bank_id
    OR NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.fact_type IS DISTINCT FROM OLD.fact_type) THEN
    RAISE EXCEPTION 'ReviewRouter native identity remapping denied';
  END IF;
  IF NEW.fact_type IN ('world', 'experience') THEN
    IF NEW.document_id IS NULL OR NEW.document_id = '' OR NEW.bank_id IS NULL OR NEW.id IS NULL OR
      EXISTS (SELECT 1 FROM __SCHEMA__.rr_hindsight_observation_edge WHERE observation_id = NEW.id) THEN
      RAISE EXCEPTION 'ReviewRouter original fact identity required';
    END IF;
    INSERT INTO __SCHEMA__.rr_hindsight_fact_identity VALUES (NEW.id, NEW.bank_id, NEW.document_id, NEW.fact_type)
      ON CONFLICT (fact_id) DO NOTHING;
    SELECT * INTO STRICT known FROM __SCHEMA__.rr_hindsight_fact_identity WHERE fact_id = NEW.id;
    IF known.bank_id IS DISTINCT FROM NEW.bank_id OR known.document_id IS DISTINCT FROM NEW.document_id
      OR known.fact_type IS DISTINCT FROM NEW.fact_type THEN
      RAISE EXCEPTION 'ReviewRouter native fact identity collision';
    END IF;
  ELSIF NEW.fact_type = 'observation' THEN
    IF NEW.id IS NULL OR NEW.bank_id IS NULL OR
      EXISTS (SELECT 1 FROM __SCHEMA__.rr_hindsight_fact_identity WHERE fact_id = NEW.id) OR
      EXISTS (SELECT 1 FROM __SCHEMA__.rr_hindsight_observation_edge e
        JOIN __SCHEMA__.rr_hindsight_fact_identity f USING (fact_id)
        WHERE e.observation_id = NEW.id AND f.bank_id <> NEW.bank_id) THEN
      RAISE EXCEPTION 'ReviewRouter observation identity collision';
    END IF;
    FOREACH source_id IN ARRAY COALESCE(NEW.source_memory_ids, ARRAY[]::uuid[]) LOOP
      IF NOT EXISTS (SELECT 1 FROM __SCHEMA__.rr_hindsight_fact_identity
        WHERE fact_id = source_id AND bank_id = NEW.bank_id) THEN
        RAISE EXCEPTION 'ReviewRouter unknown or cross-bank observation source';
      END IF;
      INSERT INTO __SCHEMA__.rr_hindsight_observation_edge VALUES (NEW.id, source_id) ON CONFLICT DO NOTHING;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM __SCHEMA__.rr_hindsight_observation_edge WHERE observation_id = NEW.id) THEN
      RAISE EXCEPTION 'ReviewRouter observation provenance required';
    END IF;
  ELSE
    RAISE EXCEPTION 'ReviewRouter unqualified native fact type';
  END IF;
  RETURN NEW;
END
$rr$;
CREATE TRIGGER rr_hindsight_track_live AFTER INSERT OR UPDATE ON __SCHEMA__.memory_units
  FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.rr_hindsight_track();
CREATE TRIGGER rr_hindsight_track_archive AFTER INSERT OR UPDATE ON __SCHEMA__.invalidated_memory_units
  FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.rr_hindsight_track();
CREATE TRIGGER rr_hindsight_immutable_facts BEFORE UPDATE OR DELETE OR TRUNCATE ON __SCHEMA__.rr_hindsight_fact_identity
  FOR EACH STATEMENT EXECUTE FUNCTION __SCHEMA__.rr_hindsight_immutable();
CREATE TRIGGER rr_hindsight_immutable_edges BEFORE UPDATE OR DELETE OR TRUNCATE ON __SCHEMA__.rr_hindsight_observation_edge
  FOR EACH STATEMENT EXECUTE FUNCTION __SCHEMA__.rr_hindsight_immutable();
CREATE TRIGGER rr_hindsight_immutable_activation BEFORE UPDATE OR DELETE OR TRUNCATE ON __SCHEMA__.rr_hindsight_activation
  FOR EACH STATEMENT EXECUTE FUNCTION __SCHEMA__.rr_hindsight_immutable();
