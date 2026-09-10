-- =============================================================================
-- ベースライン取り込み: docs/db/ の DDL として本番へ手作業で当てていたもの
--
-- 背景:
--   次の3つは docs/db/ の DDL として本番へ手動適用されており、supabase/migrations には無かった。
--     - DDL_v0.6_subtasks.sql       … tasks.parent_task_id（サブタスクの親）
--     - DDL_v0.8_space_archive.sql  … spaces.archived_at / archived_by / group_id / sort_order・space_groups
--     - DDL_v0.8_cli_usage_logs.sql … cli_usage_logs
--   そのため空のDBから流すと、20260310_000_multi_level_hierarchy.sql が無い列（parent_task_id）を
--   参照して止まっていた（scripts/verify-migrations-from-scratch.sh）。
--
-- 中身は「2026-09-10 時点の本番の実物」に合わせてある（資料と違うところは本番が正）:
--   - spaces.group_id の外部キーは space_groups(id) への単純な参照。資料の (group_id, org_id) 複合キーではなく、
--     space_groups に UNIQUE (id, org_id) も無い。
--   - 資料にあって本番に無いものは取り込まない（v0.6 の1段階制限トリガー＝20260310 で置き換え済み、
--     DDL_v0.4 のコメント数まわり、DDL_v0.7 の索引）。
--
-- ファイル名の日時が過去なのは意図的（20260101000000_baseline_client_scope.sql と同じ理由）:
--   これを参照する migration（20260310_000_multi_level_hierarchy・20260703_000_rls_stage0_grants）より
--   前に並ぶ必要がある。
--
-- 本番では全部すでにあるので何も変わらない（IF NOT EXISTS・存在確認つき。既存のポリシーは落とさない）。
-- 適用したら applied_migrations へ記録する。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) サブタスクの親（DDL_v0.6）
-- -----------------------------------------------------------------------------
alter table public.tasks
  add column if not exists parent_task_id uuid references public.tasks(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasks'::regclass and conname = 'chk_no_self_parent'
  ) then
    alter table public.tasks
      add constraint chk_no_self_parent check (parent_task_id is null or id <> parent_task_id);
  end if;
end $$;

create index if not exists idx_tasks_parent_task_id on public.tasks(parent_task_id)
  where parent_task_id is not null;

-- -----------------------------------------------------------------------------
-- 2) プロジェクトのアーカイブ（DDL_v0.8_space_archive の Phase A）
-- -----------------------------------------------------------------------------
alter table public.spaces add column if not exists archived_at timestamptz null;
alter table public.spaces add column if not exists archived_by uuid null references auth.users(id);

comment on column public.spaces.archived_at is 'Archive timestamp. NULL = active space.';
comment on column public.spaces.archived_by is 'User who archived this space.';

create index if not exists idx_spaces_active on public.spaces(org_id) where archived_at is null;

-- -----------------------------------------------------------------------------
-- 3) プロジェクトのフォルダ（DDL_v0.8_space_archive の Phase B）
-- -----------------------------------------------------------------------------
create table if not exists public.space_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_space_groups_org on public.space_groups(org_id, sort_order);

alter table public.space_groups enable row level security;

-- 本番の既存ポリシーを落として作り直さないよう、無いときだけ作る
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'space_groups'
      and policyname = 'org members can view space_groups'
  ) then
    create policy "org members can view space_groups"
      on public.space_groups for select
      using (org_id in (
        select om.org_id from public.org_memberships om where om.user_id = auth.uid()
      ));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'space_groups'
      and policyname = 'org admins can manage space_groups'
  ) then
    create policy "org admins can manage space_groups"
      on public.space_groups for all
      using (org_id in (
        select om.org_id from public.org_memberships om
        where om.user_id = auth.uid() and om.role in ('owner', 'admin')
      ));
  end if;
end $$;

alter table public.spaces
  add column if not exists group_id uuid null references public.space_groups(id) on delete set null;
alter table public.spaces add column if not exists sort_order int not null default 0;

create index if not exists idx_spaces_group on public.spaces(group_id, sort_order);

-- -----------------------------------------------------------------------------
-- 4) CLI の利用記録（DDL_v0.8_cli_usage_logs）
--    ポリシー無し＝サーバー（service_role）だけが読み書きする
-- -----------------------------------------------------------------------------
create table if not exists public.cli_usage_logs (
  id            uuid primary key default gen_random_uuid(),
  api_key_id    uuid references public.api_keys(id) on delete set null,
  org_id        uuid not null,
  space_id      uuid,
  user_id       uuid,
  tool_name     text not null,
  status        text not null default 'success',  -- 'success' | 'error'
  error_message text,
  response_ms   integer,
  cli_version   text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_cli_usage_logs_org_id     on public.cli_usage_logs(org_id);
create index if not exists idx_cli_usage_logs_tool_name  on public.cli_usage_logs(tool_name);
create index if not exists idx_cli_usage_logs_created_at on public.cli_usage_logs(created_at desc);
create index if not exists idx_cli_usage_logs_org_tool   on public.cli_usage_logs(org_id, tool_name, created_at desc);

alter table public.cli_usage_logs enable row level security;

comment on table public.cli_usage_logs is 'CLI (agentpm) command usage statistics per customer';

-- -----------------------------------------------------------------------------
-- 5) 実物との食い違い検出
--    IF NOT EXISTS は「列がすでにある」とき型を確かめない。本番が別の型なのに
--    「適用済み」と記録されて履歴と実物がずれたまま固まるのを防ぐため、違えばここで止める。
-- -----------------------------------------------------------------------------
do $$
declare
  v_mismatch text;
begin
  select string_agg(format('%s.%s（期待 %s・実際 %s）', e.t, e.c, e.want, coalesce(g.got, 'なし')), ', ')
    into v_mismatch
  from (values
    ('tasks',          'parent_task_id', 'uuid'),
    ('spaces',         'archived_at',    'timestamp with time zone'),
    ('spaces',         'archived_by',    'uuid'),
    ('spaces',         'group_id',       'uuid'),
    ('spaces',         'sort_order',     'integer'),
    ('space_groups',   'org_id',         'uuid'),
    ('cli_usage_logs', 'tool_name',      'text')
  ) as e(t, c, want)
  left join lateral (
    select col.data_type as got
    from information_schema.columns col
    where col.table_schema = 'public' and col.table_name = e.t and col.column_name = e.c
  ) g on true
  where g.got is distinct from e.want;

  if v_mismatch is not null then
    raise exception 'baseline_manual_ddl: 列の型が本番の想定と違う: %', v_mismatch;
  end if;
end $$;
