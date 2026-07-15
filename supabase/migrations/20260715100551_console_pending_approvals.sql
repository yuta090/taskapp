-- =============================================================================
-- Stage 2.7-B §5: コンソール「確認待ち」トレイの取得（認可ファースト）
--
-- 承認/却下 RPC と同じ _digest_actor_can_approve を *取得側にも* 適用する。
-- requested_to = 本人 で絞るだけでは不十分: 責任者交代・space外し・退職の後に、
-- 旧承認者が自分宛だった候補のタイトル/期限/担当ヒントを閲覧できてしまう（LINE経路で
-- 塞いだのと同じ漏洩）。よって「*現在も* 承認権限を持つ」候補だけを返す。
--
-- 【RLS読取に関する既知の受容事項（Fable判断・2026-07-15）】
-- channel_digest_tasks は Stage 2.5 以来 org内部メンバーに SELECT を grant している
-- （申し送りは事務所内で共有する内部成果物。秘書コンソールのタイムライン等が前提）。
-- よって「承認権限を持たない org内部メンバー」や「責任者交代後も org に残る旧承認者」は、
-- Supabaseクライアントで pending 行のコンテンツを直接読める。これは 2.7-B が新設した漏洩では
-- なく既存の可視性モデルの範囲内で、信頼境界は org 在籍（app_is_org_internal）で正しく切れている。
-- 承認ACTION（tasks化）と外部チャネル(LINE 1:1)への送出のみが機微であり、そちらは全て
-- service_role専用RPC＋_digest_actor_can_approve で認可ファーストに gate 済み。
-- 読取をさらに締める（authenticated への SELECT grant 自体を revoke し全読取をAPIへ一本化）
-- のは任意ハードニングとして別ストリーム security/rls-digest-read で扱う（今回はブロッカーでない）。
-- =============================================================================

create or replace function public.rpc_list_pending_approvals(
  p_org_id uuid,
  p_actor_user_id uuid
)
returns table (
  task_id uuid,
  title text,
  due_date date,
  due_time time,
  assignee_hint text,
  group_id uuid,
  group_name text,
  requested_at timestamptz,
  approval_notified_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- returns table の OUT 名（title 等）とテーブル列名の衝突を避けるため全列を別名修飾する。
  select
    d.id, d.title, d.due_date, d.due_time, d.assignee_hint,
    d.group_id, g.display_name, d.requested_at, d.approval_notified_at
  from public.channel_digest_tasks d
  join public.channel_groups g on g.id = d.group_id
  where d.org_id = p_org_id
    and d.requested_to_user_id = p_actor_user_id
    and d.promotion_state = 'pending'
    -- 承認/却下と同一述語: 現責任者・org在籍・space admin/editor でなければ結果に出さない
    and public._digest_actor_can_approve(d, p_actor_user_id)
  order by d.requested_at asc;
$$;

revoke execute on function public.rpc_list_pending_approvals(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_list_pending_approvals(uuid, uuid) to service_role;

-- =============================================================================
-- 検証（scratch）:
--   1) 現責任者かつspace editor: 自分宛pendingが返る
--   2) 責任者交代(group.approver変更)後: 旧承認者には返らない
--   3) space外し(editor剥奪)後: 返らない
--   4) 他人宛(requested_to != 本人): 返らない
-- ロールバック: drop function rpc_list_pending_approvals(uuid, uuid);
-- =============================================================================
