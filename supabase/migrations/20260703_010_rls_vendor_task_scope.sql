-- =============================================================================
-- RLS ステージ: ベンダー可視範囲の細粒度化 — Group 1 (tasks)
-- 詳細/確定設計: docs/spec/RLS_vendor_scope_STAGE.md（V3 / UXレビュー #90）
-- 依存: 20260703_001_rls_helpers.sql, 20260703_002_rls_tasks.sql を先に適用。
--
-- 目的: Stage 1 の tasks 粗粒度ポリシー（app_can_access_space のみ）を、
--   ロール精密な可視性へ細粒度化し、第三者ベンダーへの越境露出(V3)を閉じる。
--
-- 確定した可視性マトリクス（2026-07-03 サインオフ済み）:
--   内部(owner/admin/member) : スペース内全タスク（現状維持・無影響）
--   クライアント(外部/非vendor): client_scope='deliverable' のみ（全ball＝client-ball も見える）
--   ベンダー(space role=vendor): client_scope='deliverable' かつ ball <> 'client'（client対応は機密）
--   ※ NULL client_scope は '= deliverable' の三値論理で外部に非表示（fail-closed）。
--
-- 範囲: 本 migration は tasks の SELECT/UPDATE/DELETE と補助ヘルパのみ。
--   task_pricing（利益率/売値）・task_comments 等の子テーブル、関連 RPC、
--   NULL バックフィルは後続グループ（spec §5）。INSERT は現状維持（漏洩なし）。
--
-- 対象ロール: authenticated（ベンダー/クライアントポータルは JWT 経由でここに該当）。
--   service_role(API routes) は RLS バイパス＝無影響。
-- 冪等: create or replace / drop policy if exists → create。再実行安全。
-- 可逆: 末尾ロールバック節（Stage 1 の粗粒度ポリシーへ復帰）。破壊的操作なし。
-- =============================================================================

-- 補助ヘルパ: 呼び出し元が当該スペースの vendor ロールか。
--   SECURITY DEFINER で space_memberships を直接参照（RLS バイパス・再帰回避）。
create or replace function public.app_is_space_vendor(p_space uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from space_memberships s
    where s.space_id = p_space
      and s.user_id = auth.uid()
      and s.role = 'vendor'
  );
$$;

comment on function public.app_is_space_vendor(uuid) is
  'RLS補助: 呼び出しユーザーが当該スペースの vendor ロールか（V3 ベンダー可視範囲細粒度化）';

-- 可視性判定を1箇所に集約（SELECT/UPDATE の USING/WITH CHECK で共用）。
--   内部メンバーは全件、外部は deliverable のみ、vendor はさらに client-ball 除外。
create or replace function public.app_task_visible_to_caller(
  p_space uuid,
  p_org uuid,
  p_client_scope text,
  p_ball text
)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select
    public.app_can_access_space(p_space, p_org)
    and (
      public.app_is_org_internal(p_org)                        -- 内部: 全件
      or (
        p_client_scope = 'deliverable'                         -- 外部共通: deliverable のみ（NULL は fail-closed）
        and (
          not public.app_is_space_vendor(p_space)              -- クライアント: 全ball
          or p_ball is distinct from 'client'                  -- ベンダー: client-ball 除外
        )
      )
    );
$$;

comment on function public.app_task_visible_to_caller(uuid, uuid, text, text) is
  'RLS補助: tasks 行の可視性（内部=全件 / クライアント=deliverable / ベンダー=deliverable かつ非client-ball）';

-- SELECT: 可視性マトリクスで narrowing
drop policy if exists tasks_select_member on public.tasks;
create policy tasks_select_member
  on public.tasks
  for select
  to authenticated
  using ( public.app_task_visible_to_caller(space_id, org_id, client_scope, ball) );

-- UPDATE: 見える行のみ更新可、かつ更新後も見える範囲に留まること
--   （不可視タスクの改変・client_scope/ball を使った可視性の悪用を防ぐ）
drop policy if exists tasks_update_member on public.tasks;
create policy tasks_update_member
  on public.tasks
  for update
  to authenticated
  using ( public.app_task_visible_to_caller(space_id, org_id, client_scope, ball) )
  with check ( public.app_task_visible_to_caller(space_id, org_id, client_scope, ball) );

-- DELETE: 見える行のみ削除可
drop policy if exists tasks_delete_member on public.tasks;
create policy tasks_delete_member
  on public.tasks
  for delete
  to authenticated
  using ( public.app_task_visible_to_caller(space_id, org_id, client_scope, ball) );

-- INSERT は現状維持（20260703_002 の tasks_insert_member: app_can_access_space）。
-- 列レベル書換ガード（vendor が client_scope/ball/pricing を改変不可）は後続グループ。

-- =============================================================================
-- 検証（ローカルDBでドライラン: scripts/apply-migration.sh <file> ／本番前に検証ゲート）:
--   1) 内部ユーザー(owner/admin/member): 従来通りスペース内全タスクが見える。
--   2) ベンダー: client_scope='internal' / NULL / ball='client' のタスクは 0 件。
--      deliverable かつ 非client-ball のみ見える。
--   3) クライアント: client_scope='deliverable' は client-ball 含め見える。internal は 0 件。
--   4) ベンダーが不可視タスクIDを update/delete → 0 行（拒否）。
--   5) service_role(API routes): 全件（無影響）。
--   6) 主要動線スモーク: 内部タスク一覧/作成/更新/削除、ベンダーポータル一覧、クライアントポータル。
--
-- ロールバック（Stage 1 粗粒度へ復帰。RLS 自体は無効化しない）:
--   drop policy if exists tasks_select_member on public.tasks;
--   create policy tasks_select_member on public.tasks for select to authenticated
--     using ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists tasks_update_member on public.tasks;
--   create policy tasks_update_member on public.tasks for update to authenticated
--     using ( public.app_can_access_space(space_id, org_id) )
--     with check ( public.app_can_access_space(space_id, org_id) );
--   drop policy if exists tasks_delete_member on public.tasks;
--   create policy tasks_delete_member on public.tasks for delete to authenticated
--     using ( public.app_can_access_space(space_id, org_id) );
--   drop function if exists public.app_task_visible_to_caller(uuid, uuid, text, text);
--   drop function if exists public.app_is_space_vendor(uuid);
-- =============================================================================
