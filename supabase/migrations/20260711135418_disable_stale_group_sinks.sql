-- =============================================================================
-- AI秘書 Stage 3 PR-2: グループ再リンク(新世代)時の旧世代sink無効化
-- (docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §10 受け入れ条件12)
--
-- channel_groups は世代方式(20260711073329_channel_groups_digest.sql)。誤紐付けの
-- 是正は unlink→再リンクで新世代を作る運用のため、旧世代(status='left')のgroup_idを
-- 指す integration_sinks は新しいdigestタスクのenqueue対象から無音で外れる
-- (channel_digest_tasksトリガーのsink解決は new.group_id 一致のみ・PR-1実装)。
-- 無音の配達停止を防ぐため、新世代への紐付け成立時に旧世代向けsinkを明示的に
-- disableし、返り値を使って呼び出し側(webhookHandler)でorg owner/adminへ通知する。
-- =============================================================================

-- OUT列名(returns table)をテーブル列名と衝突させない(PR-1の教訓: 同名だとPL/pgSQL変数
-- が暗黙宣言され、SQL内の非修飾列参照が曖昧衝突になる)。本関数はすべてisk./old_g.で
-- 修飾しているため実害は無いが、将来の変更でも安全なようにOUT列名を明確に区別する。
create or replace function public.rpc_disable_stale_group_sinks(p_new_group_id uuid)
returns table (
  out_sink_id uuid,
  out_org_id uuid,
  out_display_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_external_group_id text;
begin
  select cg.account_id, cg.external_group_id
    into v_account_id, v_external_group_id
  from channel_groups cg
  where cg.id = p_new_group_id;

  -- 未知のgroup_id: 何もせず0行
  if v_account_id is null then
    return;
  end if;

  return query
  update integration_sinks isk
  set status = 'disabled'
  from channel_groups old_g
  where isk.group_id = old_g.id
    and old_g.account_id = v_account_id
    and old_g.external_group_id = v_external_group_id
    and old_g.id <> p_new_group_id
    and old_g.status = 'left'
    and isk.status = 'active'
  returning isk.id, isk.org_id, isk.display_name;
end;
$$;

-- service role のみ実行可（暗黙のPUBLIC grantをrevokeするため、明示grantが必須）
revoke execute on function public.rpc_disable_stale_group_sinks(uuid) from public, anon, authenticated;
grant execute on function public.rpc_disable_stale_group_sinks(uuid) to service_role;

-- =============================================================================
-- 検証（適用後にservice roleで実施。docker使い捨てPostgresでの検証手順は
-- Stage3実装ログ参照。共有DBには直接検証を行わないこと）:
--   1) 旧世代(status='left', 同一account_id/external_group_id)のgroup_idを指す
--      status='active'のsinkが、新世代のp_new_group_idで呼び出すとdisabledになり、
--      (sink_id, org_id, display_name)の行が返る
--   2) org全体スコープ(group_id is null)のsinkは対象にならない
--   3) 既にdisabled/errorのsinkは対象にならない(status='active'のみが遷移)
--   4) 旧世代が存在しない(初回リンク)場合は0行
--   5) 別account_id・別external_group_idの旧世代は対象にならない
--   6) 未知のp_new_group_idを渡しても例外にならず0行
-- ロールバック:
--   drop function public.rpc_disable_stale_group_sinks(uuid);
-- =============================================================================
