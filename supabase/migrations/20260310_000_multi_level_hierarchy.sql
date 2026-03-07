-- Multi-Level Task Hierarchy: Replace 1-level trigger with multi-level support
-- Spec: docs/spec/MULTI_LEVEL_HIERARCHY_SPEC.md v2.1
--
-- Changes:
-- 1. DROP existing 1-level enforcement trigger (prevent_invalid_parent_task)
-- 2. CREATE new trigger that allows up to 10 levels of nesting
--    with circular reference detection and same-space enforcement
-- 3. ADD advisory lock to prevent concurrent write-skew cycles
-- 4. ADD immutability constraint on tasks.space_id

-- Step 1: Drop existing 1-level trigger and function
DROP TRIGGER IF EXISTS trg_prevent_invalid_parent_task ON tasks;
DROP FUNCTION IF EXISTS prevent_invalid_parent_task();

-- Step 2: Prevent space_id changes on existing tasks (space_id is set at creation)
CREATE OR REPLACE FUNCTION prevent_space_id_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.space_id IS DISTINCT FROM NEW.space_id THEN
    RAISE EXCEPTION 'Cannot change space_id of an existing task';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_space_id_change
  BEFORE UPDATE OF space_id ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION prevent_space_id_change();

-- Step 3: New multi-level hierarchy trigger function
CREATE OR REPLACE FUNCTION check_task_parent_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  ancestor_id uuid;
  ancestor_space uuid;
  depth int := 0;
  max_depth int := 10;
BEGIN
  -- NULL parent is always OK
  IF NEW.parent_task_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Self-reference (redundant with CHECK constraint but explicit)
  IF NEW.parent_task_id = NEW.id THEN
    RAISE EXCEPTION 'Task cannot be its own parent';
  END IF;

  -- Advisory lock per space to prevent concurrent write-skew cycles
  -- (e.g. T1: A.parent=B and T2: B.parent=A simultaneously)
  PERFORM pg_advisory_xact_lock(hashtext('task_hierarchy_' || NEW.space_id::text));

  -- Same-space check (immediate parent only; ancestors are already validated)
  SELECT space_id INTO ancestor_space
  FROM tasks WHERE id = NEW.parent_task_id;

  IF ancestor_space IS NULL THEN
    RAISE EXCEPTION 'Parent task not found';
  END IF;

  IF ancestor_space != NEW.space_id THEN
    RAISE EXCEPTION 'Parent task must be in the same space';
  END IF;

  -- Walk up ancestor chain: detect cycles AND enforce max depth
  ancestor_id := NEW.parent_task_id;
  WHILE ancestor_id IS NOT NULL LOOP
    depth := depth + 1;

    IF depth > max_depth THEN
      RAISE EXCEPTION 'Maximum nesting depth (%) exceeded', max_depth;
    END IF;

    SELECT parent_task_id INTO ancestor_id
    FROM tasks WHERE id = ancestor_id;

    IF ancestor_id = NEW.id THEN
      RAISE EXCEPTION 'Circular parent reference detected';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create the trigger
CREATE TRIGGER trg_check_task_parent_hierarchy
  BEFORE INSERT OR UPDATE OF parent_task_id ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION check_task_parent_hierarchy();
