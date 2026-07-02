-- =============================================================================
-- RLS Rollout Stage 1 — tasks テーブル単体の RLS 有効化＋ポリシー
-- 詳細: docs/spec/RLS_ROLLOUT_SPEC.md（1-b space スコープ / 1-c 適用順 #3）
-- 依存: 20260703_001_rls_helpers.sql（app_can_access_space 等）を先に適用。
--
-- 目的: 動線が最も濃い tasks を最初に RLS 化し、越境(IDOR)を閉じつつ
--       主要機能スモークで安全性を確認する（残りテーブルは後続グループで）。
--
-- 適用範囲: この migration は tasks のみ。membership テーブル自体の RLS は
--   まだ有効化しない。ヘルパは SECURITY DEFINER で membership を読むため、
--   tasks 単体でも正しくスコープ判定でき、tasks の検証を先行できる。
--
-- 対象ロール: authenticated（ブラウザ hooks / Server Components の JWT 経由）。
--   service_role（API routes）は RLS をバイパスするため対象外・影響なし。
--   anon は Stage 0 で権限剥奪済みのため対象外。
--
-- 判定: app_can_access_space(space_id, org_id)
--   = 内部メンバー(owner/admin/member) は org 内全スペース可、
--     client/vendor は自スペースのみ可。
--
-- 粒度に関する注記（後続で細分化）:
--   本ポリシーは client/vendor の書込を「アクセス可能スペースなら可」の
--   粗粒度で許可する（SPEC 1-b「client/vendor の write 制限」= 要件確認事項）。
--   他者タスクの改変不可などの細粒度制御は後続 migration で締める。
--
-- 冪等: enable RLS は再実行安全。ポリシーは drop policy if exists → create。
-- 可逆: 末尾のロールバック節参照（disable RLS / drop policy）。破壊的操作なし。
-- =============================================================================

alter table public.tasks enable row level security;

-- SELECT: 自分がアクセス可能なスペースの行のみ閲覧可
drop policy if exists tasks_select_member on public.tasks;
create policy tasks_select_member
  on public.tasks
  for select
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- INSERT: 自分がアクセス可能なスペースにのみ作成可
drop policy if exists tasks_insert_member on public.tasks;
create policy tasks_insert_member
  on public.tasks
  for insert
  to authenticated
  with check ( public.app_can_access_space(space_id, org_id) );

-- UPDATE: アクセス可能なスペースの行のみ、かつ更新後もそのスペース内に留まること
drop policy if exists tasks_update_member on public.tasks;
create policy tasks_update_member
  on public.tasks
  for update
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) )
  with check ( public.app_can_access_space(space_id, org_id) );

-- DELETE: アクセス可能なスペースの行のみ削除可
drop policy if exists tasks_delete_member on public.tasks;
create policy tasks_delete_member
  on public.tasks
  for delete
  to authenticated
  using ( public.app_can_access_space(space_id, org_id) );

-- =============================================================================
-- 検証（検証ゲート#2 / SPEC 5-2）:
--   1) 内部ユーザー(owner/admin/member) で `select ... from tasks` すると
--      org 内全スペースのタスクが見える。
--   2) client/vendor では space_memberships にある自スペースのタスクのみ見え、
--      他 org / 他 space のタスクは 0 件（越境が消える）。
--   3) 別 org のユーザーで対象 org の task を select/update/delete しても
--      0 行（IDOR 不成立）。
--   4) service_role(API routes) は従来通り全件操作可能（RLS バイパス）。
--   5) 主要動線スモーク: ログイン→タスク一覧→作成→更新→削除、portal 表示。
--   ドライラン: apply-migration.sh の BEGIN→ROLLBACK で構文/依存を先行検証。
--
-- ロールバック（1グループでも破綻したら即実行）:
--   drop policy if exists tasks_delete_member on public.tasks;
--   drop policy if exists tasks_update_member on public.tasks;
--   drop policy if exists tasks_insert_member on public.tasks;
--   drop policy if exists tasks_select_member on public.tasks;
--   alter table public.tasks disable row level security;
--   ※ RLS 無効化のみでも即時に従来挙動へ戻る（ポリシーは残っていても無効化で不適用）。
-- =============================================================================
