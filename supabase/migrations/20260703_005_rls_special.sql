-- =============================================================================
-- RLS Rollout Stage 1 — 特殊スコープ（notifications / mcp_confirm_tokens）
-- 詳細: docs/spec/RLS_ROLLOUT_SPEC.md（1-b special / 1-c 適用順 #4）
-- 依存: 20260703_001_rls_helpers.sql（本ファイルは notifications で auth.uid() のみ
--       使用、mcp_confirm_tokens はポリシー無し）。
--
-- 対象ロール: authenticated（ブラウザ hooks / Server Components の JWT 経由）。
--   service_role（API routes / 通知生成・MCP 確認）は RLS をバイパスするため対象外。
--   anon は Stage 0 で権限剥奪済みのため対象外。
--
-- 冪等: enable RLS は再実行安全。ポリシーは drop policy if exists → create。
-- 可逆: 末尾のロールバック節参照（disable RLS / drop policy）。破壊的操作なし。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- notifications（ユーザースコープ: 他人宛の通知は一切見えない）
--   space スコープではなく to_user_id（宛先ユーザー）で絞る。内部メンバーでも
--   他人宛の通知は見せない（通知は個人の受信箱であり越境の可視化を防ぐ）。
--   INSERT ポリシーは作らない（＝authenticated からの作成を全拒否）。通知は
--   サーバ/service_role が生成する前提。
-- -----------------------------------------------------------------------------
alter table public.notifications enable row level security;

-- SELECT: 自分宛の通知のみ
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications
  for select
  to authenticated
  using ( to_user_id = auth.uid() );

-- UPDATE: 自分宛の通知のみ（既読化 read_at など）。宛先の付け替えを防ぐため
--   with check も同条件（更新後も自分宛のままであること）。
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications
  for update
  to authenticated
  using ( to_user_id = auth.uid() )
  with check ( to_user_id = auth.uid() );

-- DELETE: 自分宛の通知のみ削除可
drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own
  on public.notifications
  for delete
  to authenticated
  using ( to_user_id = auth.uid() );

-- INSERT: authenticated 向けポリシーは作らない（＝全拒否）。
--   通知はサーバ/service_role（RLS バイパス）が生成する。

-- -----------------------------------------------------------------------------
-- mcp_confirm_tokens（service_role 専用: authenticated は全拒否）
--   破壊的操作の2段階確認トークン。org_id 列を持たず space_id のみ、かつ
--   token_hash など機微値を含むため、authenticated からの直接アクセスは一切
--   認めない。RLS を有効化し、かつ authenticated 向けポリシーを 1 つも作らない
--   ことで「RLS 有効 × ポリシー0件 = 常に拒否」となる。
--   発行・検証・クリーンアップは全て service_role（RLS バイパス）経由で行う前提。
-- -----------------------------------------------------------------------------
alter table public.mcp_confirm_tokens enable row level security;

-- （意図的にポリシーを作成しない。authenticated からの SELECT/INSERT/UPDATE/DELETE は
--   全て拒否される。service_role のみアクセス可。）

-- =============================================================================
-- 検証（検証ゲート#2 / SPEC 5-2）:
--   1) authenticated として自分宛の通知のみ SELECT でき、他人宛は 0 件。
--   2) authenticated が他人宛通知を update/delete しても 0 行（越境不成立）。
--   3) authenticated からの notifications への insert が拒否されること。
--   4) authenticated からの mcp_confirm_tokens への全コマンドが拒否されること
--      （ポリシー0件 → 常に不許可）。
--   5) service_role は通知生成・MCP 確認トークンの発行/検証/削除が従来通り可能。
--   6) 主要動線スモーク: 通知一覧表示・既読化、MCP 破壊的操作の2段階確認フロー。
--   ドライラン: apply-migration.sh の BEGIN→ROLLBACK で構文/依存を先行検証。
--
-- ロールバック（破綻したら即実行）:
--   alter table public.mcp_confirm_tokens disable row level security;
--   drop policy if exists notifications_delete_own on public.notifications;
--   drop policy if exists notifications_update_own on public.notifications;
--   drop policy if exists notifications_select_own on public.notifications;
--   alter table public.notifications disable row level security;
--   ※ RLS 無効化のみでも即時に従来挙動へ戻る。
-- =============================================================================
