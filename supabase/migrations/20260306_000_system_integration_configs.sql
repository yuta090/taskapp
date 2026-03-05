-- =============================================================================
-- System Integration Configs
-- システム全体のOAuth設定をDBで管理（環境変数からの移行）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) system_integration_configs テーブル
-- -----------------------------------------------------------------------------
create table if not exists system_integration_configs (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique check (
    provider in ('github', 'slack', 'google_calendar', 'zoom', 'teams')
  ),
  enabled boolean not null default false,
  credentials_encrypted text not null,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table system_integration_configs is 'システム全体のインテグレーション設定（OAuth Client ID/Secret等）';
comment on column system_integration_configs.credentials_encrypted is 'pgcrypto暗号化済みJSON。SYSTEM_ENCRYPTION_KEYをキーとして使用。';
comment on column system_integration_configs.config is '非機密設定（リダイレクトURI、App Slug等）';

-- -----------------------------------------------------------------------------
-- 2) 汎用暗号化/復号化関数（既存のslack用と分離）
-- -----------------------------------------------------------------------------
create or replace function encrypt_system_secret(plaintext text, secret text)
returns text as $$
  select encode(pgp_sym_encrypt(plaintext, secret), 'base64');
$$ language sql security definer;

create or replace function decrypt_system_secret(encrypted text, secret text)
returns text as $$
  select pgp_sym_decrypt(decode(encrypted, 'base64'), secret);
$$ language sql security definer;

-- -----------------------------------------------------------------------------
-- 3) RLS ポリシー（superadminのみ）
-- -----------------------------------------------------------------------------
alter table system_integration_configs enable row level security;

create policy "superadmin can view system configs"
  on system_integration_configs for select
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.is_superadmin = true
    )
  );

create policy "superadmin can insert system configs"
  on system_integration_configs for insert
  with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.is_superadmin = true
    )
  );

create policy "superadmin can update system configs"
  on system_integration_configs for update
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.is_superadmin = true
    )
  );

create policy "superadmin can delete system configs"
  on system_integration_configs for delete
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.is_superadmin = true
    )
  );

-- -----------------------------------------------------------------------------
-- 4) Updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function update_system_integration_configs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger system_integration_configs_updated_at
  before update on system_integration_configs
  for each row execute function update_system_integration_configs_updated_at();

-- -----------------------------------------------------------------------------
-- 5) 有効状態の公開ビュー（全ユーザーがenabled状態だけ参照可能）
-- -----------------------------------------------------------------------------
create or replace view system_integration_status as
  select provider, enabled
  from system_integration_configs;

grant select on system_integration_status to authenticated;
