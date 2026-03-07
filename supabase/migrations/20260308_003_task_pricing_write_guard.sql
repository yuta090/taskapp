-- Guard: only admin/editor/vendor in the task's space can write to task_pricing
-- Uses BEFORE INSERT/UPDATE trigger (task_pricing has no RLS, matching core table pattern)

create or replace function guard_task_pricing_write()
returns trigger
language plpgsql
security definer
as $$
declare
  v_space_id uuid;
  caller_role text;
begin
  -- Allow service_role (server-side operations)
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  -- Resolve space_id from the task
  select t.space_id into v_space_id
    from tasks t
   where t.id = new.task_id;

  if v_space_id is null then
    raise exception 'task not found';
  end if;

  -- Check caller's role in this space
  select sm.role into caller_role
    from space_memberships sm
   where sm.space_id = v_space_id
     and sm.user_id = auth.uid()
   limit 1;

  if caller_role in ('admin', 'editor', 'vendor') then
    return new;
  end if;

  raise exception 'permission denied: only admin/editor/vendor can modify task pricing';
end;
$$;

drop trigger if exists trg_guard_task_pricing_write on task_pricing;

create trigger trg_guard_task_pricing_write
  before insert or update on task_pricing
  for each row
  execute function guard_task_pricing_write();

-- Guard: only admin/editor/vendor can delete task_pricing rows
create or replace function guard_task_pricing_delete()
returns trigger
language plpgsql
security definer
as $$
declare
  v_space_id uuid;
  caller_role text;
begin
  if current_setting('role', true) = 'service_role' then
    return old;
  end if;

  select t.space_id into v_space_id
    from tasks t
   where t.id = old.task_id;

  select sm.role into caller_role
    from space_memberships sm
   where sm.space_id = v_space_id
     and sm.user_id = auth.uid()
   limit 1;

  if caller_role in ('admin', 'editor') then
    return old;
  end if;

  raise exception 'permission denied: only admin/editor can delete task pricing';
end;
$$;

drop trigger if exists trg_guard_task_pricing_delete on task_pricing;

create trigger trg_guard_task_pricing_delete
  before delete on task_pricing
  for each row
  execute function guard_task_pricing_delete();

comment on function guard_task_pricing_write() is 'Prevents unauthorized writes to task_pricing';
comment on function guard_task_pricing_delete() is 'Prevents unauthorized deletes from task_pricing';
