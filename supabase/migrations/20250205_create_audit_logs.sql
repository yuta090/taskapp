-- ============================================================================
-- Migration: Create audit_logs table
-- Description: 全操作履歴を記録する監査ログシステム
-- Created: 2025-02-05
-- ============================================================================

-- ============================================================================
-- 1. テーブル作成
-- ============================================================================

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  space_id uuid not null,

  -- 誰が
  actor_id uuid,                           -- ユーザーID (profiles.id)
  actor_role text,                         -- 'client' | 'owner' | 'member'

  -- 何をした
  event_type text not null,                -- 'task.created', 'approval.approved' など
  target_type text not null,               -- 'task' | 'comment' | 'milestone' | 'meeting' | 'member' | 'review'
  target_id uuid,                          -- 対象レコードID

  -- 詳細
  summary text,                            -- 簡易な説明
  data_before jsonb,                       -- 変更前データ
  data_after jsonb,                        -- 変更後データ
  metadata jsonb,                          -- 追加情報（画面名、request_idなど）

  -- 表示制御
  visibility text not null default 'team', -- 'client' | 'team'

  -- タイムスタンプ
  occurred_at timestamptz not null default now()
);

-- ============================================================================
-- 2. インデックス作成
-- ============================================================================

-- スペース＋時間でのクエリ用（ダッシュボード表示）
create index if not exists audit_logs_space_time_idx
  on audit_logs (space_id, occurred_at desc);

-- ターゲットでのクエリ用（特定タスクの履歴）
create index if not exists audit_logs_target_idx
  on audit_logs (target_type, target_id);

-- ユーザーでのクエリ用（誰が何をしたか）
create index if not exists audit_logs_actor_idx
  on audit_logs (actor_id, occurred_at desc);

-- イベントタイプでのクエリ用
create index if not exists audit_logs_event_idx
  on audit_logs (event_type, occurred_at desc);

-- visibility + space_id でのクエリ用（クライアント向け表示）
create index if not exists audit_logs_visibility_idx
  on audit_logs (space_id, visibility, occurred_at desc);

-- ============================================================================
-- 3. RLSポリシー
-- ============================================================================

alter table audit_logs enable row level security;

-- 閲覧ポリシー:
-- - クライアントは visibility='client' のみ
-- - チーム（owner/member）は全件
create policy audit_logs_select on audit_logs for select using (
  exists (
    select 1 from space_memberships sm
    where sm.space_id = audit_logs.space_id
      and sm.user_id = auth.uid()
      and (
        audit_logs.visibility = 'client'
        or sm.role in ('owner', 'member')
      )
  )
);

-- 挿入ポリシー: スペースメンバーのみ挿入可能
create policy audit_logs_insert on audit_logs for insert with check (
  exists (
    select 1 from space_memberships sm
    where sm.space_id = audit_logs.space_id
      and sm.user_id = auth.uid()
  )
);

-- 更新禁止: 監査ログは不変
create policy audit_logs_no_update on audit_logs for update using (false);

-- 削除禁止: 監査ログは削除不可
create policy audit_logs_no_delete on audit_logs for delete using (false);

-- ============================================================================
-- 4. コメント
-- ============================================================================

comment on table audit_logs is '全操作履歴を記録する監査ログ';
comment on column audit_logs.actor_id is '操作を行ったユーザーのID';
comment on column audit_logs.actor_role is '操作時点でのユーザーの役割';
comment on column audit_logs.event_type is 'イベントの種類（task.created, approval.approved など）';
comment on column audit_logs.target_type is '操作対象の種類（task, comment, milestone など）';
comment on column audit_logs.target_id is '操作対象のID';
comment on column audit_logs.visibility is '表示制御（client: クライアントにも表示, team: チームのみ）';
