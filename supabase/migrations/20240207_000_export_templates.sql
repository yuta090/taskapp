-- Export Templates: プロジェクトごとのCSVエクスポートヘッダー設定
-- =====================================================

-- テーブル作成
create table if not exists export_templates (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  name text not null default 'default',

  -- ヘッダーマッピング (DB列名 → 表示名)
  headers jsonb not null default '{
    "id": "ID",
    "title": "タイトル",
    "description": "説明",
    "type": "タイプ",
    "status": "ステータス",
    "priority": "優先度",
    "due_date": "期限",
    "ball": "ボール",
    "origin": "起案元",
    "assignee": "担当者",
    "milestone": "マイルストーン",
    "spec_path": "仕様パス",
    "decision_state": "決定状態",
    "created_at": "作成日時",
    "updated_at": "更新日時"
  }'::jsonb,

  -- エクスポートする列の順序（配列で指定）
  columns text[] not null default array[
    'id', 'title', 'description', 'type', 'status', 'priority',
    'due_date', 'ball', 'origin', 'assignee', 'milestone',
    'spec_path', 'decision_state', 'created_at', 'updated_at'
  ],

  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- インデックス
create index export_templates_space_id_idx on export_templates(space_id);
create unique index export_templates_space_default_idx on export_templates(space_id) where is_default = true;

-- RLS
alter table export_templates enable row level security;

-- ポリシー: スペースメンバーのみアクセス可能
create policy "export_templates_select" on export_templates
  for select using (
    exists (
      select 1 from space_memberships sm
      where sm.space_id = export_templates.space_id
        and sm.user_id = auth.uid()
    )
  );

create policy "export_templates_insert" on export_templates
  for insert with check (
    exists (
      select 1 from space_memberships sm
      where sm.space_id = export_templates.space_id
        and sm.user_id = auth.uid()
    )
  );

create policy "export_templates_update" on export_templates
  for update using (
    exists (
      select 1 from space_memberships sm
      where sm.space_id = export_templates.space_id
        and sm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from space_memberships sm
      where sm.space_id = export_templates.space_id
        and sm.user_id = auth.uid()
    )
  );

create policy "export_templates_delete" on export_templates
  for delete using (
    exists (
      select 1 from space_memberships sm
      where sm.space_id = export_templates.space_id
        and sm.user_id = auth.uid()
    )
  );

-- updated_at 自動更新トリガー
create or replace function update_export_templates_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger export_templates_updated_at
  before update on export_templates
  for each row execute function update_export_templates_updated_at();

-- コメント
comment on table export_templates is 'CSVエクスポートのヘッダーテンプレート';
comment on column export_templates.headers is 'DB列名から表示名へのマッピング';
comment on column export_templates.columns is 'エクスポートする列の順序';
comment on column export_templates.is_default is 'デフォルトテンプレートフラグ（スペースごとに1つ）';
