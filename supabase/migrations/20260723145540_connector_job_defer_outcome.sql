-- =============================================================================
-- connector job outbox: 「defer」outcome の追加（インフラ一時障害を attempt 予算から除外する）
--
-- 【背景 / Fable 裁定 2026-07-23】
-- sink outbox(20260723145539)と同じ穴が connector_jobs にもある。平文トークン是正(#376)以降、
-- トークン復号 RPC/vault の一時障害は transient_error として dispatch の temporary_fail(予算消費)に
-- 載る。「主DBは健全だが復号 RPC/vault だけが一時的に落ちる」障害では、配達を試みる前の失敗
-- (自分のDB/秘密が読めない)で attempt 予算(バックオフ 5段+1=最大6試行)を食い、最終的に job が
-- dead になり得る。これを attempt を消費しない 'defer' として入れる。
--
-- 【この migration の内容】
-- rpc_complete_connector_job を create or replace で差し替え、**シグネチャは不変**
-- (uuid, bigint, text, text)。既存の 'done'/'temporary_fail'/'permanent_fail'・version 不一致時の
-- 「lease だけ解いて attempt を消費しない」挙動は一切変えず、'defer' 分岐だけを足す。
--
-- 【'defer' の挙動】(version 不一致の lease-release 前例に倣う)
--   - attempt を **増やさない**・status は 'pending' のまま(終端にしない)。
--   - leased_until = null(リース解放)・next_attempt_at = now() + interval '5 minutes'(固定短ディレイ)。
--   - last_error 記録。
--
-- 【⚠ 回路遮断は RPC に持たせない】
-- connector job には sink の 20連続自動停止に相当する circuit breaker が無い。無限 defer を防ぐ
-- 経過時間キャップ(created_at から 72h 超は temporary_fail に降格)は **dispatch コード側**
-- (src/lib/connectors/dispatch.ts の INFRA_DEFER_MAX_AGE_MS)に置く。RPC は単純に保つ。
--
-- 【冪等・可逆】create or replace のみ。ロールバックは 20260720125427 の定義を再適用すれば戻る
--   (dispatch が 'defer' を渡さなくなるだけで既存 outcome は不変)。
--
-- 【適用】本番未適用(このPRでは作成のみ)。
-- =============================================================================

create or replace function public.rpc_complete_connector_job(
  p_job_id uuid,
  p_version bigint,
  p_outcome text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt int;
  v_version bigint;
  v_status text;
  v_backoff constant int[] := array[1, 5, 30, 120, 360];  -- 分
  v_delay int;
begin
  select attempt, version, status into v_attempt, v_version, v_status
    from public.connector_jobs where id = p_job_id for update;
  if not found then return; end if;
  if v_status <> 'pending' then return; end if;  -- done/dead は終端・不変

  if v_version <> p_version then
    -- 処理中に fold された(この worker が処理したのは古い op)。最新 op は既に pending
    -- (attempt=0, next_attempt_at=now()) で入っている。lease だけ解いて即再配達可能にする。
    update public.connector_jobs
      set leased_until = null, updated_at = now()
      where id = p_job_id;
    return;
  end if;

  -- version 一致: この worker の処理結果を確定する。どの分岐でも lease を解く。
  if p_outcome = 'done' then
    update public.connector_jobs
      set status = 'done', last_error = null, leased_until = null, updated_at = now()
      where id = p_job_id;
  elsif p_outcome = 'permanent_fail' then
    update public.connector_jobs
      set status = 'dead', last_error = p_error, leased_until = null, updated_at = now()
      where id = p_job_id;
  elsif p_outcome = 'defer' then
    -- インフラ一時障害: attempt を増やさず(予算を消費しない)、status='pending' のまま lease を解いて
    -- 5分後に再試行する(version 不一致の lease-release と同型だが、こちらは next_attempt_at を進める)。
    -- 無限 defer の歯止め(72h キャップ)は dispatch コード側にある。
    update public.connector_jobs
      set next_attempt_at = now() + interval '5 minutes',
          last_error = p_error, leased_until = null, updated_at = now()
      where id = p_job_id;
  else  -- temporary_fail
    if v_attempt + 1 >= array_length(v_backoff, 1) + 1 then
      update public.connector_jobs
        set status = 'dead', attempt = v_attempt + 1, last_error = p_error,
            leased_until = null, updated_at = now()
        where id = p_job_id;
    else
      v_delay := v_backoff[v_attempt + 1];
      update public.connector_jobs
        set attempt = v_attempt + 1,
            next_attempt_at = now() + make_interval(mins => v_delay),
            last_error = p_error, leased_until = null, updated_at = now()
        where id = p_job_id;
    end if;
  end if;
end;
$$;

-- service role のみ実行可（create or replace は権限を保持するが、シグネチャ不変を明示するため再宣言する）。
revoke all on function public.rpc_complete_connector_job(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.rpc_complete_connector_job(uuid, bigint, text, text) to service_role;

-- =============================================================================
-- 検証(service role):
--   1) version 一致で 'defer' を渡すと attempt が不変・status='pending'・leased_until=null・
--      next_attempt_at ≒ now()+5min になることを確認(バックオフ表を進めない)。
--   2) version 不一致時の lease-release、'done'/'temporary_fail'/'permanent_fail' の挙動が
--      20260720125427 と一致すること(回帰なし)。
--   3) 72h キャップは dispatch 側テスト(connectors/dispatch.test.ts)で担保
--      (created_at 超過で temporary_fail に降格し最終的に dead へ収束=無限 defer しない)。
-- ロールバック: 20260720125427 の rpc_complete_connector_job 定義を create or replace で再適用する。
-- =============================================================================
