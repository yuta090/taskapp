-- =============================================================================
-- RLS Rollout Stage 1 — membership テーブル（org_memberships / space_memberships）
-- 詳細: docs/spec/RLS_ROLLOUT_SPEC.md（1-b membership / 1-c 適用順 #2）
-- 依存: 20260703_001_rls_helpers.sql（app_is_org_member / app_is_space_member）を先に適用。
--
-- 目的: メンバーシップ表そのものを RLS 化し、他テナントのメンバー構成が
--       authenticated から見えないようにする（越境の可視化を閉じる）。
--
-- ★ 再帰(42P17)回避の肝（必読）:
--   本ファイルの SELECT ポリシーはヘルパ app_is_org_member / app_is_space_member を
--   呼ぶが、これらは SECURITY DEFINER（定義者=postgres・RLS バイパス）で
--   ★同じ membership 表を直接読む★ため、
--     policy(org_memberships) → app_is_org_member → org_memberships を「RLS無しで」読む
--   となり、policy が再び policy を発火させる循環は生じない。→ 無限再帰にならない。
--   （ヘルパの定義とバイパス根拠は 20260703_001_rls_helpers.sql のヘッダ参照。）
--
-- 対象ロール: authenticated（ブラウザ hooks / Server Components の JWT 経由）。
--   service_role（API routes）は RLS をバイパスするため対象外・影響なし。
--   anon は Stage 0 で権限剥奪済みのため対象外。
--
-- ★ 書込ポリシーを「あえて作らない」設計:
--   INSERT / UPDATE / DELETE ポリシーは本ファイルで一切作成しない。
--   RLS 有効かつ該当コマンドのポリシーが 0 件 = そのコマンドは authenticated から
--   常に拒否される（＝より安全側）。membership の書込は RPC / service_role 経由
--   （RLS バイパス）でのみ行われる前提（SPEC: authenticated 直接書込は存在しない）。
--   将来 authenticated から直接メンバー追加/削除が必要になった場合にのみ、
--   内部管理者限定の write ポリシーを別 migration で追加する。
--
-- 冪等: enable RLS は再実行安全。ポリシーは drop policy if exists → create。
-- 可逆: 末尾のロールバック節参照（disable RLS / drop policy）。破壊的操作なし。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- org_memberships
-- -----------------------------------------------------------------------------
alter table public.org_memberships enable row level security;

-- SELECT: 自分自身の所属行、または「自分が属する org」のメンバー行のみ閲覧可
--   user_id = auth.uid()      … 自分の membership（他 org のものも含め自分の行）
--   app_is_org_member(org_id) … 自分が同じ org のメンバーなら同僚の行も見える
drop policy if exists org_memberships_select_member on public.org_memberships;
create policy org_memberships_select_member
  on public.org_memberships
  for select
  to authenticated
  using ( user_id = auth.uid() or public.app_is_org_member(org_id) );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。
--   書込は RPC / service_role（RLS バイパス）経由のみ。

-- -----------------------------------------------------------------------------
-- space_memberships
-- -----------------------------------------------------------------------------
alter table public.space_memberships enable row level security;

-- SELECT: 自分自身の所属行、または「自分が属する space」のメンバー行のみ閲覧可
--   user_id = auth.uid()        … 自分の membership
--   app_is_space_member(space_id) … 同じ space のメンバーなら同僚の行も見える
--   （内部メンバーが org 内全 space のメンバー一覧を見る必要が出た場合は
--     app_is_org_internal を OR 追加する余地あり。現時点では最小権限で自 space に限定。）
drop policy if exists space_memberships_select_member on public.space_memberships;
create policy space_memberships_select_member
  on public.space_memberships
  for select
  to authenticated
  using ( user_id = auth.uid() or public.app_is_space_member(space_id) );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。
--   書込は RPC / service_role（RLS バイパス）経由のみ。

-- =============================================================================
-- 検証（検証ゲート#1 / SPEC 5-1）:
--   1) authenticated として `select * from space_memberships;` および
--      `select * from org_memberships;` を実行し、無限再帰(42P17)が出ないこと。
--   2) 自分の所属 org/space のメンバー行のみ返り、他テナントの行が 0 件であること。
--   3) authenticated から insert/update/delete が全て拒否されること
--      （ポリシー 0 件 → 常に不許可）。
--   4) service_role（RPC 経由の招待受諾・メンバー追加等）が従来通り動作すること。
--   ドライラン: apply-migration.sh の BEGIN→ROLLBACK で構文/依存/再帰を先行検証。
--
-- ロールバック（1グループでも破綻したら即実行）:
--   drop policy if exists space_memberships_select_member on public.space_memberships;
--   alter table public.space_memberships disable row level security;
--   drop policy if exists org_memberships_select_member on public.org_memberships;
--   alter table public.org_memberships disable row level security;
--   ※ RLS 無効化のみでも即時に従来挙動へ戻る。
-- =============================================================================
