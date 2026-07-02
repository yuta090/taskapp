-- =============================================================================
-- RLS Rollout Stage 1 — org スコープ・テーブル群
-- 詳細: docs/spec/RLS_ROLLOUT_SPEC.md（1-b org スコープ / 1-c 適用順 #5）
-- 依存: 20260703_001_rls_helpers.sql（app_is_org_member / app_is_org_internal）を先に適用。
--
-- 対象テーブルと採用ポリシー（src の書込経路調査に基づく）:
--   organizations       … SELECT: app_is_org_member(id) / UPDATE: app_is_org_internal(id)
--                          （browser client の .update({name}) が存在＝authenticated 更新あり。
--                           作成/削除は signup RPC・admin(service_role) 経由のため
--                           INSERT/DELETE ポリシーは作らない＝authenticated 拒否）
--   org_billing         … SELECT のみ: app_is_org_member(org_id)
--                          （書込は Stripe webhook / admin=service_role のみ。バイパスで動作）
--   discussion_comments … SELECT のみ: app_is_org_member(org_id)
--                          （src に browser/server の直接書込なし。書込は RPC/トリガ/service_role）
--   onboarding_progress … SELECT のみ（自己スコープ）: user_id = auth.uid()
--                          （src に authenticated 直接書込なし。他人の進捗を見せない）
--   llm_runs            … SELECT のみ（自己スコープ）: user_id = auth.uid()
--                          （書込はサーバ想定=service_role。他人の実行ログを見せない）
--
-- スコープ列（実測・DDL 確認済み）:
--   organizations は id を org_id とみなす。org_billing は org_id が PK。
--   discussion_comments は org_id を持つ（space_id は無く discussion_items 経由）。
--   onboarding_progress / llm_runs は org_id + user_id を持つが、機微な個人データの
--   ため org ではなく user_id で自己スコープに限定する（SPEC 制約: 他人の行を見せない）。
--
-- 対象ロール: authenticated（ブラウザ hooks / Server Components の JWT 経由）。
--   service_role（API routes / Stripe webhook / サーバ集計）は RLS をバイパスするため
--   対象外・影響なし。anon は Stage 0 で権限剥奪済みのため対象外。
--
-- ★ SELECT のみ設計の意味:
--   RLS 有効かつ INSERT/UPDATE/DELETE ポリシーが 0 件 = そのコマンドは authenticated
--   から常に拒否される（＝安全側）。書込はバイパス経路（service_role/DEFINER RPC）で動く。
--
-- 冪等: enable RLS は再実行安全。ポリシーは drop policy if exists → create。
-- 可逆: 末尾のロールバック節参照（disable RLS / drop policy）。破壊的操作なし。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- organizations（id を org_id とみなす。更新のみ authenticated 許可＝内部管理者）
-- -----------------------------------------------------------------------------
alter table public.organizations enable row level security;

-- SELECT: 自分が属する org のみ閲覧可
drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member
  on public.organizations
  for select
  to authenticated
  using ( public.app_is_org_member(id) );

-- UPDATE: 内部メンバー(owner/admin/member) のみ。org 名変更等（settings/organization）。
--   with check も同条件（更新後も自 org のままであること）。
drop policy if exists organizations_update_internal on public.organizations;
create policy organizations_update_internal
  on public.organizations
  for update
  to authenticated
  using ( public.app_is_org_internal(id) )
  with check ( public.app_is_org_internal(id) );

-- INSERT / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。
--   org 作成は signup フロー（RPC/service_role）、削除は admin(service_role) 経由。

-- -----------------------------------------------------------------------------
-- org_billing（課金。SELECT のみ。書込は Stripe webhook / admin=service_role）
-- -----------------------------------------------------------------------------
alter table public.org_billing enable row level security;

-- SELECT: 自分が属する org の課金情報のみ閲覧可
drop policy if exists org_billing_select_member on public.org_billing;
create policy org_billing_select_member
  on public.org_billing
  for select
  to authenticated
  using ( public.app_is_org_member(org_id) );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。
--   課金レコードの生成/更新は Stripe webhook・admin(service_role) が RLS バイパスで実施。

-- -----------------------------------------------------------------------------
-- discussion_comments（org スコープ。SELECT のみ。書込は RPC/トリガ/service_role）
--   space_id を持たず org_id で判定（親 discussion_items 経由で space に紐づくが、
--   当面は SPEC 通り org 粒度で安全側に anchor。将来 space 粒度に締める余地あり）。
-- -----------------------------------------------------------------------------
alter table public.discussion_comments enable row level security;

-- SELECT: 自分が属する org のコメントのみ閲覧可
drop policy if exists discussion_comments_select_member on public.discussion_comments;
create policy discussion_comments_select_member
  on public.discussion_comments
  for select
  to authenticated
  using ( public.app_is_org_member(org_id) );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。
--   コメント投稿は RPC / service_role 経由（src に browser/server 直接書込なし）。

-- -----------------------------------------------------------------------------
-- onboarding_progress（個人データ。自己スコープ SELECT のみ）
--   org ではなく user_id で絞り、他人のオンボーディング進捗を見せない。
-- -----------------------------------------------------------------------------
alter table public.onboarding_progress enable row level security;

-- SELECT: 自分の進捗行のみ
drop policy if exists onboarding_progress_select_own on public.onboarding_progress;
create policy onboarding_progress_select_own
  on public.onboarding_progress
  for select
  to authenticated
  using ( user_id = auth.uid() );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。
--   進捗更新は src に authenticated 直接書込なし＝サーバ(service_role)/RPC 経由想定。
--   ※将来ブラウザから自分の進捗を直接 upsert する必要が出た場合は、
--     user_id = auth.uid() を with check とする自己スコープ write ポリシーを追加。

-- -----------------------------------------------------------------------------
-- llm_runs（実行ログ・課金原価。自己スコープ SELECT のみ。書込はサーバ想定）
-- -----------------------------------------------------------------------------
alter table public.llm_runs enable row level security;

-- SELECT: 自分の実行ログのみ
drop policy if exists llm_runs_select_own on public.llm_runs;
create policy llm_runs_select_own
  on public.llm_runs
  for select
  to authenticated
  using ( user_id = auth.uid() );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。
--   実行ログの記録は AI 機能のサーバ側(service_role) が RLS バイパスで実施。

-- =============================================================================
-- 検証（検証ゲート#2 / SPEC 5-2）:
--   1) 内部ユーザーが自 org の organizations を SELECT でき、org 名 UPDATE が成功する。
--      client/vendor ロールは UPDATE が 0 行（内部限定）。他 org は SELECT 0 件。
--   2) org_billing: 自 org の課金のみ SELECT でき、他 org は 0 件。
--      authenticated からの INSERT/UPDATE/DELETE は全拒否。Stripe webhook(service_role) は従来通り。
--   3) discussion_comments: 自 org のコメントのみ SELECT。他 org は 0 件。書込は全拒否。
--   4) onboarding_progress / llm_runs: 自分の行のみ SELECT、他ユーザーの行は 0 件。書込は全拒否。
--   5) service_role（API routes / Stripe / サーバ集計）は全テーブル従来通り操作可能。
--   ドライラン: apply-migration.sh の BEGIN→ROLLBACK で構文/依存を先行検証。
--
-- ロールバック（1グループでも破綻したら該当テーブルだけ即実行）:
--   drop policy if exists llm_runs_select_own on public.llm_runs;
--   alter table public.llm_runs disable row level security;
--   drop policy if exists onboarding_progress_select_own on public.onboarding_progress;
--   alter table public.onboarding_progress disable row level security;
--   drop policy if exists discussion_comments_select_member on public.discussion_comments;
--   alter table public.discussion_comments disable row level security;
--   drop policy if exists org_billing_select_member on public.org_billing;
--   alter table public.org_billing disable row level security;
--   drop policy if exists organizations_update_internal on public.organizations;
--   drop policy if exists organizations_select_member on public.organizations;
--   alter table public.organizations disable row level security;
--   ※ RLS 無効化のみでも即時に従来挙動へ戻る。
-- =============================================================================
