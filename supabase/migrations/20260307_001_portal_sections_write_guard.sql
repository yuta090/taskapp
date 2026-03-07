-- Guard: only admin/editor can update portal_visible_sections
-- Uses a BEFORE UPDATE trigger instead of RLS (spaces has no RLS enabled)

create or replace function guard_portal_visible_sections()
returns trigger
language plpgsql
security definer
as $$
declare
  caller_role text;
begin
  -- Allow if portal_visible_sections didn't change
  if old.portal_visible_sections is not distinct from new.portal_visible_sections then
    return new;
  end if;

  -- Allow service_role (server-side operations)
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  -- Check caller's role in this space
  select sm.role into caller_role
    from space_memberships sm
   where sm.space_id = new.id
     and sm.user_id = auth.uid()
   limit 1;

  if caller_role in ('admin', 'editor') then
    return new;
  end if;

  raise exception 'permission denied: only admin/editor can update portal_visible_sections';
end;
$$;

drop trigger if exists trg_guard_portal_visible_sections on spaces;

create trigger trg_guard_portal_visible_sections
  before update on spaces
  for each row
  execute function guard_portal_visible_sections();

comment on function guard_portal_visible_sections() is 'Prevents non-admin/editor users from modifying portal_visible_sections';
