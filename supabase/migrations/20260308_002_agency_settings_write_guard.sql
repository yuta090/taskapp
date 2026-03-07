-- Guard: only admin/editor can update agency_mode, default_margin_rate, vendor_settings
-- Mirrors the existing portal_visible_sections guard pattern

create or replace function guard_agency_settings()
returns trigger
language plpgsql
security definer
as $$
declare
  caller_role text;
begin
  -- Allow if none of the agency columns changed
  if old.agency_mode is not distinct from new.agency_mode
     and old.default_margin_rate is not distinct from new.default_margin_rate
     and old.vendor_settings is not distinct from new.vendor_settings
  then
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

  raise exception 'permission denied: only admin/editor can update agency settings';
end;
$$;

drop trigger if exists trg_guard_agency_settings on spaces;

create trigger trg_guard_agency_settings
  before update on spaces
  for each row
  execute function guard_agency_settings();

comment on function guard_agency_settings() is 'Prevents non-admin/editor users from modifying agency_mode, default_margin_rate, vendor_settings';
