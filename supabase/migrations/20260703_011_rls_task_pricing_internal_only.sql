-- =============================================================================
-- RLS ステージ: ベンダー可視範囲の細粒度化 — Group 2 (task_pricing)
-- 詳細/確定設計: docs/spec/RLS_vendor_scope_STAGE.md（V3 / UXレビュー #90）
-- 依存: 20260703_001_rls_helpers.sql, 20260703_004_rls_space_scoped.sql を先に適用。
--
-- 問題(最優先): task_pricing は原価(cost_*)に加え、代理店の margin_rate と
--   クライアント提示額 sell_total を保持する。現状 SELECT ポリシーは
--   app_can_access_space のみ＝ベンダー(制作会社)が自スペースの pricing 行を
--   直接 REST API で読め、**利益率・売値が第三者に露出**する（重大な商業的漏洩）。
--
-- 確定方針(サインオフ済): task_pricing は代理店の内部財務データ。
--   base table は **内部メンバー(owner/admin/member) のみ** SELECT/INSERT/UPDATE/DELETE 可。
--   クライアント/ベンダーは base table への直接アクセス不可。
--
-- 既存動線への影響(調査済み・無影響):
--   - 内部アプリ: useTaskPricing(TaskInspector) は authenticated JWT・内部メンバー → 従来通り全列可。
--   - クライアントポータル: pricing はサーバAPI(service_role, RLSバイパス)経由 → 無影響。
--   - ベンダー: /vendor-portal/estimates は未実装(404)＝現状 base table を読む動線なし → 破壊なし。
--
-- 後続(spec §5): ベンダーの原価提出(cost_* のみ)とクライアントの売値表示(sell_total のみ)は、
--   列を限定した security-barrier VIEW / RPC / service_role 経由の専用パスで別途提供する
--   （列レベル機密のため base table の粗い共有はしない）。
--
-- 対象ロール: authenticated。service_role は RLS バイパス＝無影響。
-- 冪等: drop policy if exists → create。可逆: 末尾ロールバック節（Stage の space スコープへ復帰）。
-- =============================================================================

-- SELECT: 内部メンバーのみ（クライアント/ベンダーは 0 行）
drop policy if exists task_pricing_select_member on public.task_pricing;
create policy task_pricing_select_member
  on public.task_pricing
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

-- INSERT: 内部メンバーのみ
drop policy if exists task_pricing_insert_member on public.task_pricing;
create policy task_pricing_insert_member
  on public.task_pricing
  for insert
  to authenticated
  with check ( public.app_is_org_internal(org_id) );

-- UPDATE: 内部メンバーのみ（更新後も内部 org に留まること）
drop policy if exists task_pricing_update_member on public.task_pricing;
create policy task_pricing_update_member
  on public.task_pricing
  for update
  to authenticated
  using ( public.app_is_org_internal(org_id) )
  with check ( public.app_is_org_internal(org_id) );

-- DELETE: 内部メンバーのみ
drop policy if exists task_pricing_delete_member on public.task_pricing;
create policy task_pricing_delete_member
  on public.task_pricing
  for delete
  to authenticated
  using ( public.app_is_org_internal(org_id) );

-- =============================================================================
-- 検証（scratch DB / dev DB ドライラン）:
--   1) 内部メンバー: 自 org の pricing 行が従来通り全列見える。
--   2) ベンダー: 自スペースのタスクに紐づく pricing でも 0 行（margin/sell 非露出）。
--   3) クライアント: base table は 0 行（売値はサーバAPI経由で別途提供）。
--   4) service_role: 全件（無影響）。
--
-- ロールバック（Stage の space スコープへ復帰）:
--   drop policy if exists task_pricing_select_member on public.task_pricing;
--   create policy task_pricing_select_member on public.task_pricing for select to authenticated
--     using ( public.app_can_access_space(space_id, org_id) );
--   （insert/update/delete も同様に app_can_access_space へ戻す）
-- =============================================================================
