-- Existing archives and links are deliberately retained. This migration adds
-- indexed identity lookup and closes the race between deletion and new links.
CREATE INDEX drawing_library_normalized_spec_idx ON drawing_library_items
  (lower(trim(regexp_replace(normalize(specification, NFKC), '[[:space:]]+', ' ', 'g'))));

CREATE FUNCTION guard_active_drawing_library_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_id text; parent_deleted timestamp; old_row jsonb; new_row jsonb;
BEGIN
  new_row := to_jsonb(NEW);
  parent_id := new_row ->> TG_ARGV[0];
  IF parent_id IS NULL OR new_row ->> 'deleted_at' IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);
    -- Historical rows can still be edited without reviving a removed link.
    IF old_row ->> TG_ARGV[0] IS NOT DISTINCT FROM parent_id
       AND old_row ->> 'deleted_at' IS NULL THEN RETURN NEW; END IF;
  END IF;
  SELECT deleted_at INTO parent_deleted FROM drawing_library_items WHERE id = parent_id FOR KEY SHARE;
  IF FOUND AND parent_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'DRAWING_LIBRARY_DELETED: restore the archive before adding references' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE ref record;
BEGIN
  FOR ref IN
    SELECT DISTINCT c.conrelid::regclass AS relation, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'drawing_library_items'::regclass
      AND array_length(c.conkey, 1) = 1
  LOOP
    EXECUTE format('CREATE TRIGGER drawing_library_active_reference BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION guard_active_drawing_library_reference(%L)', ref.relation, ref.column_name);
  END LOOP;
END;
$$;
